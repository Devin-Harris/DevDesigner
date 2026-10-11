import type { RelationshipModel, TableModel } from '@dbdesigner/shared';
import { OBSTACLE_GAP, OBSTACLE_SEARCH_MARGIN } from '../constants/canvas.constants';
import type { Box, Point, Side } from '../models/geometry.model';
import type { Connector, RouteSegment } from '../models/connector.model';
import {
  buildColumnLocations,
  columnAnchor,
  sideDir,
  tableBox,
  tableWidth,
} from './node-metrics.helper';
import {
  bendCount,
  boxesIntersect,
  crossings,
  inflate,
  manhattanRoute,
  orthogonalize,
  pointInside,
  routeLength,
  simplifyRoute,
} from './route.helper';
import { cleanElbow, routeOrthogonal, routeThroughWaypoints } from './routing.helper';
import { buildConnectorPath, verticalSegments } from './svg-path.helper';

function markerFor(kind: 'one' | 'many'): string {
  return kind === 'many' ? 'url(#dbd-many)' : 'url(#dbd-one)';
}

interface Resolved {
  a: Point;
  b: Point;
  route: Point[];
}

/**
 * Per-connector route cache. Recomputing every connector's A* on every drag
 * frame was the source of the lag; keying the resolved route on its geometric
 * inputs lets untouched connectors skip the search entirely. Bounded so it never
 * grows without limit.
 */
const routeCache = new Map<string, Resolved>();
const ROUTE_CACHE_LIMIT = 800;

function boxKey(box: Box): string {
  return `${Math.round(box.x0)},${Math.round(box.y0)},${Math.round(box.x1)},${Math.round(box.y1)}`;
}

function cacheKey(
  sBox: Box,
  sIndex: number,
  tBox: Box,
  tIndex: number,
  obstacles: readonly Box[],
  waypoints: readonly Point[],
  bounds?: Box,
): string {
  const obs = obstacles.map(boxKey).sort().join(';');
  const wps = waypoints.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(';');
  return `${boxKey(sBox)}#${sIndex}|${boxKey(tBox)}#${tIndex}|${obs}|${wps}|${bounds ? boxKey(bounds) : ''}`;
}

function remember(key: string, value: Resolved): Resolved {
  routeCache.set(key, value);
  if (routeCache.size > ROUTE_CACHE_LIMIT) {
    const oldest = routeCache.keys().next().value;
    if (oldest !== undefined) {
      routeCache.delete(oldest);
    }
  }
  return value;
}

/**
 * Pick the source/target side pairing that gives the cleanest route. Each combo
 * is scored on its direct elbow (cheap); the winner only escalates to the A*
 * router when that elbow is actually blocked by another table. This keeps the
 * common case search-free and stops adjacent tables from being routed around.
 */
function autoRoute(
  source: TableModel,
  sIndex: number,
  target: TableModel,
  tIndex: number,
  sBox: Box,
  tBox: Box,
  obstacles: readonly Box[],
  bounds?: Box,
): Resolved {
  const sCenter = source.x + tableWidth(source) / 2;
  const tCenter = target.x + tableWidth(target) / 2;
  const srcNear: Side = tCenter >= sCenter ? 'right' : 'left';
  const tgtNear: Side = sCenter >= tCenter ? 'right' : 'left';

  const combos: readonly [Side, Side][] = [
    ['right', 'left'],
    ['left', 'right'],
    ['right', 'right'],
    ['left', 'left'],
  ];

  let best: { a: Point; b: Point; ss: Side; ts: Side; elbow: Point[]; blocked: number } | null =
    null;
  let bestScore = Infinity;
  for (const [ss, ts] of combos) {
    const a = columnAnchor(source, sIndex, ss);
    const b = columnAnchor(target, tIndex, ts);
    const elbow = cleanElbow(a, b, sideDir(ss), sideDir(ts), sBox, tBox, bounds);

    // How much this elbow cuts through: its own nodes (dir-violating combos) and
    // any other table. A tight inset on obstacles means even a slight graze routes
    // the winner around with A* (which keeps full clearance) instead of drawing
    // the naive elbow under the table.
    const self = crossings(elbow, sBox) + crossings(elbow, tBox);
    let blocked = 0;
    for (const box of obstacles) {
      blocked += crossings(elbow, box, 1);
    }
    // An elbow that strays outside the shared frame counts as blocked too, so the
    // bounded A* search takes over.
    if (bounds && elbow.some((p) => p.x < bounds.x0 || p.x > bounds.x1 || p.y < bounds.y0 || p.y > bounds.y1)) {
      blocked += 1;
    }

    // Priority: never cross a node, then fewest elbows, then face the near side,
    // then shortest. Each tier dominates the next.
    const score =
      (self + blocked) * 1e7 +
      bendCount(elbow) * 1000 +
      (ss !== srcNear ? 10 : 0) +
      (ts !== tgtNear ? 40 : 0) +
      routeLength(elbow) * 0.01;
    if (score < bestScore) {
      bestScore = score;
      best = { a, b, ss, ts, elbow, blocked };
    }
  }

  const winner = best as NonNullable<typeof best>; // combos is non-empty
  if (winner.blocked === 0) {
    return { a: winner.a, b: winner.b, route: winner.elbow };
  }
  // A table sits in the way: route around it with the A* search.
  const route = routeOrthogonal(
    winner.a,
    winner.b,
    sideDir(winner.ss),
    sideDir(winner.ts),
    [...obstacles, sBox, tBox],
    OBSTACLE_GAP,
    bounds,
  );
  return { a: winner.a, b: winner.b, route };
}

/** Resolve one relationship to its anchors + route, using the cache when possible. */
function resolveConnector(
  rel: RelationshipModel,
  source: TableModel,
  sIndex: number,
  target: TableModel,
  tIndex: number,
  obstacles: readonly Box[],
  bounds?: Box,
): Resolved {
  const sBox = tableBox(source);
  const tBox = tableBox(target);
  const waypoints = rel.waypoints ?? [];
  const key = cacheKey(sBox, sIndex, tBox, tIndex, obstacles, waypoints, bounds);
  const cached = routeCache.get(key);
  if (cached) {
    return cached;
  }

  // With manual waypoints the connector follows them (dodging tables) but never
  // auto-optimizes. Waypoints a table now covers are ignored; if none remain
  // usable, or there are none, fall back to the clean auto route with proper
  // side selection.
  const obstaclesWithEnds = [...obstacles, sBox, tBox];
  const usable = waypoints.filter(
    (w) => !obstaclesWithEnds.some((box) => pointInside(w, inflate(box, OBSTACLE_GAP))),
  );

  let resolved: Resolved;
  if (usable.length) {
    const first = usable[0];
    const last = usable[usable.length - 1];
    const ss: Side = first.x >= source.x + tableWidth(source) / 2 ? 'right' : 'left';
    const ts: Side = last.x >= target.x + tableWidth(target) / 2 ? 'right' : 'left';
    const a = columnAnchor(source, sIndex, ss);
    const b = columnAnchor(target, tIndex, ts);
    const route = routeThroughWaypoints(
      a,
      b,
      sideDir(ss),
      sideDir(ts),
      usable,
      obstaclesWithEnds,
      OBSTACLE_GAP,
      bounds,
    );
    resolved = { a, b, route };
  } else {
    resolved = autoRoute(source, sIndex, target, tIndex, sBox, tBox, obstacles, bounds);
  }
  return remember(key, resolved);
}

/** Distance the route keeps from the frame edge so the line stays visibly inside. */
const FRAME_INSET = 8;

/**
 * Bounds a connector is confined to: the smallest frame fully containing both
 * tables, pulled in slightly. Null when the tables don't share a frame.
 */
function sharedFrameBounds(sBox: Box, tBox: Box, frames: readonly Box[]): Box | undefined {
  let best: Box | undefined;
  for (const f of frames) {
    const holds = (b: Box): boolean => b.x0 >= f.x0 && b.x1 <= f.x1 && b.y0 >= f.y0 && b.y1 <= f.y1;
    if (!holds(sBox) || !holds(tBox)) {
      continue;
    }
    if (!best || (f.x1 - f.x0) * (f.y1 - f.y0) < (best.x1 - best.x0) * (best.y1 - best.y0)) {
      best = f;
    }
  }
  return best && {
    x0: best.x0 + FRAME_INSET,
    y0: best.y0 + FRAME_INSET,
    x1: best.x1 - FRAME_INSET,
    y1: best.y1 - FRAME_INSET,
  };
}

/** Spacing between parallel lines that would otherwise share a channel. */
const LANE_GAP = 8;
const MAX_LANES = 3;

interface LaneRoute {
  /** Mutated in place: interior runs are nudged sideways into free lanes. */
  route: Point[];
  /** Anchor the line ends at. Lines sharing one may merge; others must not overlap. */
  destination: string;
  /** User-routed (waypoints): never moved, but others avoid it. */
  locked: boolean;
}

interface Run {
  owner: number;
  index: number;
  /** Position across the run (x for vertical runs, y for horizontal). */
  pos: number;
}

function runExtent(route: readonly Point[], index: number, vertical: boolean): [number, number] {
  const p = route[index];
  const q = route[index + 1];
  const a = vertical ? p.y : p.x;
  const b = vertical ? q.y : q.x;
  return [Math.min(a, b), Math.max(a, b)];
}

/**
 * Lane assignment: connectors that head to different destinations but share a
 * channel (same column of x for vertical runs, same y for horizontal runs, with
 * overlapping extent) are offset by LANE_GAP so each stays distinguishable.
 * Only interior runs move, so anchors and their exit stubs never change, and a
 * nudge is rejected if it would reverse a neighbouring run or push the line
 * further into a table than it already was.
 */
function spreadOverlaps(lines: readonly LaneRoute[], obstacles: readonly Box[]): void {
  for (const vertical of [true, false]) {
    // Buckets of already-settled runs, keyed by position / LANE_GAP.
    const placed = new Map<number, Run[]>();
    const settle = (run: Run): void => {
      const key = Math.floor(run.pos / LANE_GAP);
      const bucket = placed.get(key);
      if (bucket) {
        bucket.push(run);
      } else {
        placed.set(key, [run]);
      }
    };
    const conflicts = (run: Run, pos: number): boolean => {
      const line = lines[run.owner];
      const [lo, hi] = runExtent(line.route, run.index, vertical);
      const key = Math.floor(pos / LANE_GAP);
      for (let k = key - 1; k <= key + 1; k += 1) {
        for (const other of placed.get(k) ?? []) {
          if (other.owner === run.owner || Math.abs(other.pos - pos) >= LANE_GAP / 2) {
            continue;
          }
          const o = lines[other.owner];
          if (o.destination === line.destination) {
            continue;
          }
          const [olo, ohi] = runExtent(o.route, other.index, vertical);
          if (lo < ohi - 1 && olo < hi - 1) {
            return true;
          }
        }
      }
      return false;
    };

    // Interior runs only (the first and last run belong to the anchors).
    const runs: Run[] = [];
    lines.forEach((line, owner) => {
      for (let i = 1; i < line.route.length - 2; i += 1) {
        const p = line.route[i];
        const q = line.route[i + 1];
        if (vertical ? p.x === q.x && p.y !== q.y : p.y === q.y && p.x !== q.x) {
          runs.push({ owner, index: i, pos: vertical ? p.x : p.y });
        }
      }
    });
    // Locked lines claim their channel first; the rest are placed around them.
    runs.sort((r, s) => Number(lines[s.owner].locked) - Number(lines[r.owner].locked));

    for (const run of runs) {
      const line = lines[run.owner];
      if (line.locked || !conflicts(run, run.pos)) {
        settle(run);
        continue;
      }
      for (let step = 1; step <= MAX_LANES * 2; step += 1) {
        const lane = Math.ceil(step / 2) * (step % 2 === 1 ? 1 : -1);
        const pos = run.pos + lane * LANE_GAP;
        if (!conflicts(run, pos) && nudge(line.route, run.index, vertical, pos, obstacles)) {
          run.pos = pos;
          break;
        }
      }
      settle(run);
    }
  }
}

/** Move one run to `pos` if its neighbours keep their direction and no new table is cut. */
function nudge(
  route: Point[],
  index: number,
  vertical: boolean,
  pos: number,
  obstacles: readonly Box[],
): boolean {
  const before = route[index - 1];
  const after = route[index + 2];
  const p = route[index];
  const q = route[index + 1];
  const old = vertical ? p.x : p.y;
  const dirOk = (neighbour: Point): boolean => {
    const axis = vertical ? neighbour.x : neighbour.y;
    return Math.sign(old - axis) === Math.sign(pos - axis) && pos !== axis;
  };
  if (!dirOk(before) || !dirOk(after)) {
    return false;
  }
  const moved: Point[] = vertical
    ? [before, { x: pos, y: p.y }, { x: pos, y: q.y }, after]
    : [before, { x: p.x, y: pos }, { x: q.x, y: pos }, after];
  const original = [before, p, q, after];
  for (const box of obstacles) {
    const fat = inflate(box, 2);
    if (crossings(moved, fat, 0) > crossings(original, fat, 0)) {
      return false;
    }
  }
  p[vertical ? 'x' : 'y'] = pos;
  q[vertical ? 'x' : 'y'] = pos;
  return true;
}

/** Build the SVG connectors for the current schema. */
export function computeConnectors(
  tables: readonly TableModel[],
  relationships: readonly RelationshipModel[],
  selectedIds: ReadonlySet<string>,
  frames: readonly Box[] = [],
): Connector[] {
  const locations = buildColumnLocations(tables);
  const boxes = new Map<string, Box>();
  for (const table of tables) {
    boxes.set(table.id, tableBox(table));
  }

  // First pass: resolve each relationship to its anchors and rectilinear route.
  const pending: {
    rel: RelationshipModel;
    a: Point;
    b: Point;
    route: Point[];
  }[] = [];
  for (const rel of relationships) {
    const source = locations.get(rel.sourceColumnId);
    const target = locations.get(rel.targetColumnId);
    if (!source || !target) {
      continue;
    }

    // Only tables near this connector count as obstacles (fast + keeps routes local).
    const sBox = boxes.get(source.table.id) as Box;
    const tBox = boxes.get(target.table.id) as Box;
    const region: Box = {
      x0: Math.min(sBox.x0, tBox.x0) - OBSTACLE_SEARCH_MARGIN,
      y0: Math.min(sBox.y0, tBox.y0) - OBSTACLE_SEARCH_MARGIN,
      x1: Math.max(sBox.x1, tBox.x1) + OBSTACLE_SEARCH_MARGIN,
      y1: Math.max(sBox.y1, tBox.y1) + OBSTACLE_SEARCH_MARGIN,
    };
    const obstacles: Box[] = [];
    for (const table of tables) {
      if (table.id === source.table.id || table.id === target.table.id) {
        continue;
      }
      const box = boxes.get(table.id) as Box;
      if (boxesIntersect(box, region)) {
        obstacles.push(box);
      }
    }

    const resolved = resolveConnector(
      rel,
      source.table,
      source.index,
      target.table,
      target.index,
      obstacles,
      sharedFrameBounds(sBox, tBox, frames),
    );
    // Final guard: every segment stored and drawn is strictly horizontal/vertical.
    const route = orthogonalize(resolved.route);
    pending.push({ rel, a: resolved.a, b: resolved.b, route });
  }

  // Keep lines headed to different destinations from running on top of each other.
  spreadOverlaps(
    pending.map((pc) => ({
      route: pc.route,
      destination: `${pc.b.x},${pc.b.y}`,
      locked: !!pc.rel.waypoints?.length,
    })),
    [...boxes.values()],
  );

  // Second pass: draw each route, hopping its horizontal runs over other
  // connectors' vertical runs so overlapping lines stay readable (line-jumps).
  const verticalsPer = pending.map((pc) => verticalSegments(pc.route));
  const result: Connector[] = [];
  for (let k = 0; k < pending.length; k += 1) {
    const { rel, a, b, route } = pending[k];

    const hops: number[][] = [];
    for (let i = 0; i < route.length - 1; i += 1) {
      const p = route[i];
      const q = route[i + 1];
      if (p.y !== q.y) {
        hops[i] = [];
        continue;
      }
      const xa = Math.min(p.x, q.x);
      const xb = Math.max(p.x, q.x);
      const xs: number[] = [];
      for (let j = 0; j < pending.length; j += 1) {
        if (j === k) {
          continue;
        }
        for (const v of verticalsPer[j]) {
          if (v.x > xa && v.x < xb && p.y > v.y0 && p.y < v.y1) {
            xs.push(v.x);
          }
        }
      }
      hops[i] = xs;
    }

    const segments: RouteSegment[] = [];
    for (let i = 0; i < route.length - 1; i += 1) {
      const s = route[i];
      const e = route[i + 1];
      segments.push({
        index: i,
        mid: { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 },
        orient: s.y === e.y ? 'h' : 'v',
      });
    }
    const midSeg = segments[Math.floor(segments.length / 2)] ?? segments[0];

    result.push({
      id: rel.id,
      d: buildConnectorPath(route, hops),
      ax: a.x,
      ay: a.y,
      bx: b.x,
      by: b.y,
      mx: midSeg?.mid.x ?? a.x,
      my: midSeg?.mid.y ?? a.y,
      markerStart: markerFor(rel.type === 'MANY_TO_MANY' ? 'many' : 'one'),
      markerEnd: markerFor(rel.type === 'ONE_TO_MANY' || rel.type === 'MANY_TO_MANY' ? 'many' : 'one'),
      selected: selectedIds.has(rel.id),
      routePoints: route,
      segments,
    });
  }
  return result;
}

/**
 * Slide one straight segment of a route perpendicular to itself, keeping the
 * endpoints fixed and all segments axis-aligned. Anchor-adjacent horizontal
 * segments grow a short stub so the source/target still exit horizontally.
 * Returns the new interior corner list (the relationship's waypoints).
 */
export function segmentDrag(
  a: Point,
  b: Point,
  route: readonly Point[],
  segIndex: number,
  cursor: Point,
  stub = 28,
): Point[] {
  if (segIndex < 0 || segIndex >= route.length - 1) {
    return route.slice(1, route.length - 1).map((p) => ({ ...p }));
  }
  const p = route[segIndex];
  const q = route[segIndex + 1];
  const orient: 'h' | 'v' = p.y === q.y ? 'h' : 'v';
  const leftAnchor = segIndex === 0;
  const rightAnchor = segIndex + 1 === route.length - 1;
  const out: Point[] = [];

  if (orient === 'v') {
    const x = cursor.x;
    for (let k = 0; k < route.length; k += 1) {
      out.push(k === segIndex || k === segIndex + 1 ? { x, y: route[k].y } : { ...route[k] });
    }
  } else {
    const y = cursor.y;
    const dirA = Math.sign((route[1]?.x ?? a.x) - a.x) || 1;
    const dirB = Math.sign((route[route.length - 2]?.x ?? b.x) - b.x) || 1;
    for (let k = 0; k < segIndex; k += 1) {
      out.push({ ...route[k] });
    }
    if (leftAnchor) {
      const sx = a.x + dirA * stub;
      out.push({ ...a }, { x: sx, y: a.y }, { x: sx, y });
    } else {
      out.push({ x: p.x, y });
    }
    if (rightAnchor) {
      const sx = b.x + dirB * stub;
      out.push({ x: sx, y }, { x: sx, y: b.y }, { ...b });
    } else {
      out.push({ x: q.x, y });
    }
    for (let k = segIndex + 2; k < route.length; k += 1) {
      out.push({ ...route[k] });
    }
  }

  const guides = out.slice(1, out.length - 1);
  const clean = simplifyRoute(manhattanRoute(a, b, guides));
  return clean.slice(1, clean.length - 1);
}
