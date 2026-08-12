import type { Box, Point } from '../models/geometry.model';

/**
 * Pure geometry utilities shared by the router and the path builder. Everything
 * here operates on plain points and boxes with no knowledge of tables, SVG, or
 * Angular.
 */

// Sub-pixel tolerance for obstacle hit-tests. It MUST stay tiny: any slack here
// lets a connector graze that many pixels into a table, which reads as a line
// running under the node. Table clearance is provided separately by inflating
// obstacles (OBSTACLE_GAP), not by this epsilon.
const EPSILON = 0.001;
// Tight tolerance for merging coincident route points. Routes are integer
// rounded before dedupe, so this must stay sub-pixel: a larger merge would
// swallow real corners and fold the line.
const COINCIDENT = 0.5;

/** Drop consecutive duplicate points so degenerate elbows stop wiggling. */
export function dedupe(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) >= COINCIDENT || Math.abs(last.y - p.y) >= COINCIDENT) {
      out.push({ x: p.x, y: p.y });
    }
  }
  return out;
}

/** Round, dedupe, and drop collinear midpoints so a route has no redundant bends. */
export function simplifyRoute(points: readonly Point[]): Point[] {
  const rounded = points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  const d = dedupe(rounded);
  const out: Point[] = [];
  for (let i = 0; i < d.length; i += 1) {
    if (i > 0 && i < d.length - 1) {
      const a = out[out.length - 1];
      const b = d[i];
      const c = d[i + 1];
      const collinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
      if (collinear) {
        continue;
      }
    }
    out.push(d[i]);
  }
  return out;
}

/** Total manhattan length of a route. */
export function routeLength(points: readonly Point[]): number {
  let d = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    d += Math.abs(points[i + 1].x - points[i].x) + Math.abs(points[i + 1].y - points[i].y);
  }
  return d;
}

/** Number of corners (direction changes) in an orthogonal route. */
export function bendCount(points: readonly Point[]): number {
  let n = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const inH = Math.abs(points[i].x - points[i - 1].x) >= Math.abs(points[i].y - points[i - 1].y);
    const outH = Math.abs(points[i + 1].x - points[i].x) >= Math.abs(points[i + 1].y - points[i].y);
    if (inH !== outH) {
      n += 1;
    }
  }
  return n;
}

/**
 * Orthogonal (manhattan) route from a to b through the given guide points.
 * Every segment is horizontal or vertical; the line exits the source and enters
 * the target horizontally to match the side connect points.
 */
export function manhattanRoute(a: Point, b: Point, guides: readonly Point[]): Point[] {
  if (guides.length === 0) {
    const midX = (a.x + b.x) / 2;
    return [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b];
  }
  const points = [a, ...guides, b];
  const route: Point[] = [a];
  let dir: 'h' | 'v' = 'h';
  for (let i = 1; i < points.length; i += 1) {
    const prev = route[route.length - 1];
    const cur = points[i];
    const isLast = i === points.length - 1;
    if (prev.x === cur.x || prev.y === cur.y) {
      route.push(cur);
      dir = prev.x === cur.x ? 'v' : 'h';
      continue;
    }
    if (isLast) {
      route.push({ x: prev.x, y: cur.y }, cur);
    } else if (dir === 'h') {
      route.push({ x: cur.x, y: prev.y }, cur);
      dir = 'v';
    } else {
      route.push({ x: prev.x, y: cur.y }, cur);
      dir = 'h';
    }
  }
  return route;
}

/**
 * Force a polyline to be strictly rectilinear: wherever two consecutive points
 * differ on both axes (a diagonal), insert an L-corner so the run becomes a
 * horizontal segment followed by a vertical one. Uses exact comparison, so the
 * output is guaranteed to contain only horizontal and vertical segments no
 * matter how the points were produced or merged upstream.
 */
export function orthogonalize(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    if (out.length === 0) {
      out.push({ x: p.x, y: p.y });
      continue;
    }
    const prev = out[out.length - 1];
    if (prev.x !== p.x && prev.y !== p.y) {
      out.push({ x: p.x, y: prev.y });
    }
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

// --- box helpers -----------------------------------------------------------

export function inflate(box: Box, gap: number): Box {
  return { x0: box.x0 - gap, y0: box.y0 - gap, x1: box.x1 + gap, y1: box.y1 + gap };
}

/** Strictly inside the box (boundary excluded). */
export function pointInside(p: Point, box: Box): boolean {
  return (
    p.x > box.x0 + EPSILON &&
    p.x < box.x1 - EPSILON &&
    p.y > box.y0 + EPSILON &&
    p.y < box.y1 - EPSILON
  );
}

/** Two boxes overlap or touch. */
export function boxesIntersect(a: Box, b: Box): boolean {
  return a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
}

/**
 * True if an axis-aligned segment crosses a box interior. Running exactly on the
 * box boundary is allowed, which matters because routing coordinates are placed
 * directly on inflated obstacle edges.
 */
export function segmentHitsBox(p: Point, q: Point, box: Box): boolean {
  if (p.x === q.x) {
    if (p.x <= box.x0 || p.x >= box.x1) {
      return false;
    }
    const lo = Math.min(p.y, q.y);
    const hi = Math.max(p.y, q.y);
    return lo < box.y1 - EPSILON && hi > box.y0 + EPSILON;
  }
  if (p.y === q.y) {
    if (p.y <= box.y0 || p.y >= box.y1) {
      return false;
    }
    const lo = Math.min(p.x, q.x);
    const hi = Math.max(p.x, q.x);
    return lo < box.x1 - EPSILON && hi > box.x0 + EPSILON;
  }
  return true;
}

/** An orthogonal segment is clear when it crosses no obstacle interior. */
export function segmentClear(p: Point, q: Point, obstacles: readonly Box[]): boolean {
  if (p.x !== q.x && p.y !== q.y) {
    return false;
  }
  return !obstacles.some((box) => segmentHitsBox(p, q, box));
}

/** How many segments of a route cut through a box interior (inset ignores edge touches). */
export function crossings(points: readonly Point[], box: Box, inset = 3): number {
  const b: Box = { x0: box.x0 + inset, y0: box.y0 + inset, x1: box.x1 - inset, y1: box.y1 - inset };
  if (b.x1 <= b.x0 || b.y1 <= b.y0) {
    return 0;
  }
  let c = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p = points[i];
    const q = points[i + 1];
    const xa = Math.min(p.x, q.x);
    const xb = Math.max(p.x, q.x);
    const ya = Math.min(p.y, q.y);
    const yb = Math.max(p.y, q.y);
    if (xa < b.x1 && xb > b.x0 && ya < b.y1 && yb > b.y0) {
      c += 1;
    }
  }
  return c;
}
