import type { Point } from '../../../models/geometry.model';
/** Resample a polyline so consecutive points are at most `step` apart. */
export function densify(
   pts: readonly { x: number; y: number }[],
   step: number,
   near: (a: { x: number; y: number }, b: { x: number; y: number }) => boolean
): { x: number; y: number }[] {
   const out: { x: number; y: number }[] = [];
   for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      out.push(a);
      const b = pts[i + 1];
      if (!b) break;
      if (!Number.isFinite(a.x) || !Number.isFinite(b.x) || !near(a, b)) continue;
      const n = Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / step);
      for (let k = 1; k < n; k += 1) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
   }
   return out;
}

export function distanceToSegment(
   p: { x: number; y: number },
   a: { x: number; y: number },
   b: { x: number; y: number }
): number {
   const dx = b.x - a.x;
   const dy = b.y - a.y;
   const len = dx * dx + dy * dy;
   const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
   return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Shortest distance between segments ab and cd. */
export function segDistance(
   a: { x: number; y: number },
   b: { x: number; y: number },
   c: { x: number; y: number },
   d: { x: number; y: number }
): number {
   const cross = (o: { x: number; y: number }, p: { x: number; y: number }, q: { x: number; y: number }) =>
      (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
   const d1 = cross(c, d, a);
   const d2 = cross(c, d, b);
   const d3 = cross(a, b, c);
   const d4 = cross(a, b, d);
   if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
   return Math.min(
      distanceToSegment(a, c, d),
      distanceToSegment(b, c, d),
      distanceToSegment(c, a, b),
      distanceToSegment(d, a, b)
   );
}
