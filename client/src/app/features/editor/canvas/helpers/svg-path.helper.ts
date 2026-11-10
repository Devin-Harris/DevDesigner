import { CORNER_RADIUS } from '../constants/canvas.constants';
import type { Point } from '../models/geometry.model';
import { dedupe, manhattanRoute, orthogonalize } from './route.helper';

/*
 * SVG path building. Connectors are drawn as a single rounded orthogonal
 * polyline: straight runs with a quadratic curve easing each 90-degree corner.
 * A horizontal run hops over any connector vertical it crosses with a small
 * semicircular bridge (line-jump), so overlapping lines stay readable.
 */

function distance(a: Point, b: Point): number {
   return Math.hypot(b.x - a.x, b.y - a.y) || 1;
}

/** Point `r` along p towards q. */
function towards(p: Point, q: Point, r: number): Point {
   const len = distance(p, q);
   return { x: p.x + ((q.x - p.x) / len) * r, y: p.y + ((q.y - p.y) / len) * r };
}

/** SVG path through the points with rounded corners at each vertex. */
export function roundedPath(rawPoints: readonly Point[], radius = CORNER_RADIUS): string {
   // Guarantee the drawn line is strictly rectilinear: dedupe may merge near
   // corners, so re-square any diagonal it leaves behind before rendering.
   const points = orthogonalize(dedupe(rawPoints));
   if (points.length < 2) {
      return '';
   }
   if (points.length === 2) {
      return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
   }
   let d = `M ${points[0].x} ${points[0].y}`;
   for (let i = 1; i < points.length - 1; i += 1) {
      const p = points[i];
      const rPrev = Math.min(radius, distance(p, points[i - 1]) / 2);
      const rNext = Math.min(radius, distance(p, points[i + 1]) / 2);
      const c0 = towards(p, points[i - 1], rPrev);
      const c1 = towards(p, points[i + 1], rNext);
      d += ` L ${c0.x} ${c0.y} Q ${p.x} ${p.y} ${c1.x} ${c1.y}`;
   }
   const last = points[points.length - 1];
   d += ` L ${last.x} ${last.y}`;
   return d;
}

/** Rounded orthogonal elbow between two points (used for live endpoint dragging). */
export function elbowPath(a: Point, b: Point): string {
   return roundedPath(manhattanRoute(a, b, []));
}

/** A vertical run of a route, for line-jump crossing detection. */
export interface VerticalSegment {
   x: number;
   y0: number;
   y1: number;
}

/** Extract the vertical segments of an orthogonal route. */
export function verticalSegments(route: readonly Point[]): VerticalSegment[] {
   const out: VerticalSegment[] = [];
   for (let i = 0; i < route.length - 1; i += 1) {
      const a = route[i];
      const b = route[i + 1];
      if (a.x === b.x && a.y !== b.y) {
         out.push({ x: a.x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) });
      }
   }
   return out;
}

/**
 * Rounded orthogonal path where each horizontal segment i bridges over the
 * crossing x values in `hops[i]` with a small semicircular arc (the line-jump).
 * `points` must already be rectilinear and deduped; `hops` is aligned to route
 * segments so a hop lands on the correct run.
 */
export function buildConnectorPath(
   points: readonly Point[],
   hops: readonly number[][],
   radius = CORNER_RADIUS,
   hopR = 6
): string {
   const pts = orthogonalize(dedupe(points));
   if (pts.length < 2) {
      return '';
   }
   const cStart: Point[] = [];
   const cEnd: Point[] = [];
   for (let i = 0; i < pts.length; i += 1) {
      if (i === 0 || i === pts.length - 1) {
         cStart[i] = pts[i];
         cEnd[i] = pts[i];
         continue;
      }
      const p = pts[i];
      const rp = Math.min(radius, distance(p, pts[i - 1]) / 2);
      const rn = Math.min(radius, distance(p, pts[i + 1]) / 2);
      cStart[i] = towards(p, pts[i - 1], rp);
      cEnd[i] = towards(p, pts[i + 1], rn);
   }
   let d = `M ${pts[0].x} ${pts[0].y}`;
   for (let i = 0; i < pts.length - 1; i += 1) {
      const from = i === 0 ? pts[0] : cEnd[i];
      const to = i === pts.length - 2 ? pts[pts.length - 1] : cStart[i + 1];
      const segHops = hops[i] ?? [];
      if (from.y === to.y && segHops.length) {
         const dir = to.x >= from.x ? 1 : -1;
         const sweep = dir > 0 ? 0 : 1;
         const xs = segHops
            .filter((x) => (x - from.x) * dir > hopR && (to.x - x) * dir > hopR)
            .sort((p, q) => (p - q) * dir);
         for (const hx of xs) {
            d += ` L ${hx - hopR * dir} ${from.y}`;
            d += ` A ${hopR} ${hopR} 0 0 ${sweep} ${hx + hopR * dir} ${from.y}`;
         }
      }
      d += ` L ${to.x} ${to.y}`;
      if (i < pts.length - 2) {
         const v = pts[i + 1];
         d += ` Q ${v.x} ${v.y} ${cEnd[i + 1].x} ${cEnd[i + 1].y}`;
      }
   }
   return d;
}
