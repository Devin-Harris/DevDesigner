import { BEND_PENALTY, EXIT_STUB, MIN_STUB, OBSTACLE_GAP } from '../constants/canvas.constants';
import type { Box, Point } from '../models/geometry.model';
import {
  inflate,
  manhattanRoute,
  pointInside,
  segmentClear,
  simplifyRoute,
} from './route.helper';

/*
 * Obstacle-avoiding orthogonal routing.
 *
 * A route is found on a small "visibility graph": a rectilinear path only needs
 * to turn on coordinates induced by obstacle edges and the two endpoints, so we
 * place graph nodes at those grid intersections (skipping any inside a table)
 * and run A* with a bend penalty. Two things keep it fast: obstacles are first
 * filtered to those near the connector, and the search uses a binary heap plus a
 * coordinate index rather than linear scans.
 */

/**
 * Horizontal exit point. Normally two grid spaces out, but the stub is shortened
 * so it never overshoots a nearby facing endpoint (which would loop back) and
 * never pushes into a table sitting just ahead (which would strand the search
 * inside an obstacle). When a table is right against the anchor the stub can
 * shrink to nothing and the line simply turns immediately.
 */
function exitStub(from: Point, dir: number, toward: Point, obstacles: readonly Box[], gap: number): Point {
  const sign = dir >= 0 ? 1 : -1;
  let dist = EXIT_STUB;

  // Facing clamp: stop around the gap midpoint so the stub does not cross past
  // the target and fold back.
  if (Math.sign(toward.x - from.x) === sign) {
    dist = Math.min(dist, Math.max(MIN_STUB, Math.abs(toward.x - from.x) / 2));
  }

  // Obstacle clamp: stop at the inflated near edge of any table straddling this
  // row directly ahead, so the exit point stays outside every obstacle.
  for (const box of obstacles) {
    const b = inflate(box, gap);
    if (from.y <= b.y0 || from.y >= b.y1) {
      continue;
    }
    const edge = sign > 0 ? b.x0 : b.x1;
    const ahead = sign * (edge - from.x);
    if (ahead > 0) {
      dist = Math.min(dist, ahead);
    }
  }

  return { x: from.x + sign * Math.max(0, dist), y: from.y };
}

/**
 * The natural obstacle-free elbow between two anchors, respecting exit sides.
 * Facing anchors get a vertical channel in the gap between them; same-side
 * anchors run out past the further edge and back. This is the common case and
 * needs no search: the caller only escalates to A* when this elbow actually
 * crosses another table.
 */
export function cleanElbow(
  a: Point,
  b: Point,
  dirA: number,
  dirB: number,
  sBox: Box,
  tBox: Box,
): Point[] {
  if (Math.sign(dirA) === Math.sign(dirB)) {
    const dir = dirA >= 0 ? 1 : -1;
    const extentX =
      dir > 0
        ? Math.max(sBox.x1, tBox.x1) + EXIT_STUB
        : Math.min(sBox.x0, tBox.x0) - EXIT_STUB;
    return simplifyRoute([a, { x: extentX, y: a.y }, { x: extentX, y: b.y }, b]);
  }
  const gap = Math.abs(b.x - a.x);
  const off = Math.min(EXIT_STUB, Math.max(MIN_STUB, gap / 2));
  const sx = a.x + Math.sign(dirA) * off;
  const tx = b.x + Math.sign(dirB) * off;
  const midX = (sx + tx) / 2;
  return simplifyRoute([a, { x: midX, y: a.y }, { x: midX, y: b.y }, b]);
}

interface Edge {
  to: number;
  cost: number;
  dir: 0 | 1; // 0 = horizontal, 1 = vertical
}

interface Graph {
  points: Point[];
  edges: Edge[][];
  start: number;
  goal: number;
}

function pushUnique(values: number[], value: number): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function buildGraph(start: Point, goal: Point, obstacles: readonly Box[], gap: number): Graph {
  const inflated = obstacles.map((box) => inflate(box, gap));
  const xs: number[] = [start.x, goal.x];
  const ys: number[] = [start.y, goal.y];
  for (const box of inflated) {
    pushUnique(xs, box.x0);
    pushUnique(xs, box.x1);
    pushUnique(ys, box.y0);
    pushUnique(ys, box.y1);
  }

  const points: Point[] = [];
  const index = new Map<string, number>();
  const add = (p: Point): number => {
    const key = `${p.x},${p.y}`;
    let i = index.get(key);
    if (i === undefined) {
      i = points.length;
      points.push(p);
      index.set(key, i);
    }
    return i;
  };

  for (const x of xs) {
    for (const y of ys) {
      const p = { x, y };
      if (!inflated.some((box) => pointInside(p, box))) {
        add(p);
      }
    }
  }
  const startIndex = add(start); // kept even if on an inflated boundary
  const goalIndex = add(goal);

  const edges: Edge[][] = points.map(() => []);
  const connect = (axis: 'x' | 'y'): void => {
    const lines = new Map<number, number[]>();
    points.forEach((p, i) => {
      const key = axis === 'x' ? p.x : p.y;
      const bucket = lines.get(key);
      if (bucket) {
        bucket.push(i);
      } else {
        lines.set(key, [i]);
      }
    });
    for (const indices of lines.values()) {
      indices.sort((i, j) =>
        axis === 'x' ? points[i].y - points[j].y : points[i].x - points[j].x,
      );
      for (let i = 0; i < indices.length - 1; i += 1) {
        const from = indices[i];
        const to = indices[i + 1];
        if (!segmentClear(points[from], points[to], inflated)) {
          continue;
        }
        const cost =
          Math.abs(points[to].x - points[from].x) + Math.abs(points[to].y - points[from].y);
        const dir: 0 | 1 = axis === 'x' ? 1 : 0;
        edges[from].push({ to, cost, dir });
        edges[to].push({ to: from, cost, dir });
      }
    }
  };
  connect('x');
  connect('y');

  return { points, edges, start: startIndex, goal: goalIndex };
}

/** Tiny binary min-heap over [priority, stateKey] pairs. */
class MinHeap {
  private readonly heap: { f: number; key: number }[] = [];

  get size(): number {
    return this.heap.length;
  }

  push(f: number, key: number): void {
    const h = this.heap;
    h.push({ f, key });
    let i = h.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (h[parent].f <= h[i].f) {
        break;
      }
      [h[parent], h[i]] = [h[i], h[parent]];
      i = parent;
    }
  }

  pop(): number {
    const h = this.heap;
    const top = h[0];
    const last = h.pop() as { f: number; key: number };
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < h.length && h[l].f < h[smallest].f) {
          smallest = l;
        }
        if (r < h.length && h[r].f < h[smallest].f) {
          smallest = r;
        }
        if (smallest === i) {
          break;
        }
        [h[smallest], h[i]] = [h[i], h[smallest]];
        i = smallest;
      }
    }
    return top.key;
  }
}

function heuristic(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

// State = node index and the direction used to arrive (0 h, 1 v, 2 none/start),
// so a turn can be penalized without penalizing the graph node uniformly.
const NONE = 2;

/** A* over the visibility graph. Returns the corner points, or null if unreachable. */
function search(graph: Graph): Point[] | null {
  const { points, edges, start, goal } = graph;
  if (start < 0 || goal < 0) {
    return null;
  }
  const startKey = start * 3 + NONE;
  const gScore = new Map<number, number>([[startKey, 0]]);
  const cameFrom = new Map<number, number>();
  const open = new MinHeap();
  open.push(heuristic(points[start], points[goal]), startKey);

  while (open.size) {
    const key = open.pop();
    const node = Math.floor(key / 3);
    const dir = key % 3;
    const g = gScore.get(key);
    if (g === undefined) {
      continue;
    }
    if (node === goal) {
      const out: Point[] = [];
      let k: number | undefined = key;
      while (k !== undefined) {
        out.push(points[Math.floor(k / 3)]);
        k = cameFrom.get(k);
      }
      return simplifyRoute(out.reverse());
    }
    for (const edge of edges[node]) {
      const bend = dir !== NONE && dir !== edge.dir ? BEND_PENALTY : 0;
      const tentative = g + edge.cost + bend;
      const nextKey = edge.to * 3 + edge.dir;
      const known = gScore.get(nextKey);
      if (known !== undefined && tentative >= known) {
        continue;
      }
      gScore.set(nextKey, tentative);
      cameFrom.set(nextKey, key);
      open.push(tentative + heuristic(points[edge.to], points[goal]), nextKey);
    }
  }
  return null;
}

/**
 * Collision-free orthogonal route between two horizontal-facing anchors.
 * dirA/dirB are +1 for a right-side exit, -1 for left. Endpoint tables must be
 * included in `obstacles` by the caller so the line cannot turn back through a
 * node it just left. Returned route includes a and b.
 */
export function routeOrthogonal(
  a: Point,
  b: Point,
  dirA: number,
  dirB: number,
  obstacles: readonly Box[],
  gap = OBSTACLE_GAP,
): Point[] {
  const startStub = exitStub(a, dirA, b, obstacles, gap);
  const endStub = exitStub(b, dirB, a, obstacles, gap);
  const routed = search(buildGraph(startStub, endStub, obstacles, gap));
  if (routed) {
    return simplifyRoute([a, ...routed, b]);
  }
  // No graph path (e.g. anchors boxed in): a clean orthogonal elbow beats a
  // diagonal fallback, even if it grazes an obstacle.
  return simplifyRoute(manhattanRoute(a, b, []));
}

/** One obstacle-avoiding orthogonal leg between two free points (plain elbow if blocked). */
function routeLeg(from: Point, to: Point, obstacles: readonly Box[], gap: number): Point[] {
  return search(buildGraph(from, to, obstacles, gap)) ?? simplifyRoute(manhattanRoute(from, to, []));
}

/**
 * Route that follows the user's manual waypoints, in order, while still dodging
 * tables. Each leg (anchor stub -> waypoint -> ... -> anchor stub) is routed
 * around obstacles, and the exit stubs are clamped to table edges, so the line
 * never runs under a node and always leaves with whatever horizontal room
 * exists. It is never discarded for being suboptimal: the user keeps the shape,
 * the router only bends it around tables that are in the way.
 */
export function routeThroughWaypoints(
  a: Point,
  b: Point,
  dirA: number,
  dirB: number,
  waypoints: readonly Point[],
  obstacles: readonly Box[],
  gap = OBSTACLE_GAP,
): Point[] {
  // Ignore any waypoint that a table now covers: routing to a point under a node
  // would force the line under it. Skipped waypoints stay in the store, so they
  // apply again if the table later moves off them.
  const usable = waypoints.filter(
    (w) => !obstacles.some((box) => pointInside(w, inflate(box, gap))),
  );
  if (usable.length === 0) {
    return routeOrthogonal(a, b, dirA, dirB, obstacles, gap);
  }
  const first = usable[0];
  const last = usable[usable.length - 1];
  const fixed = [
    exitStub(a, dirA, first, obstacles, gap),
    ...usable,
    exitStub(b, dirB, last, obstacles, gap),
  ];
  const route: Point[] = [a];
  for (let i = 0; i < fixed.length - 1; i += 1) {
    route.push(...routeLeg(fixed[i], fixed[i + 1], obstacles, gap));
  }
  route.push(b);
  return simplifyRoute(route);
}
