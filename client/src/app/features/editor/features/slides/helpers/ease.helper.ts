import type { SlideEasing } from '@devdesigner/shared';

/** CSS cubic-bezier control points per easing name. */
const BEZIER: Record<SlideEasing, [number, number, number, number] | null> = {
   linear: null,
   ease: [0.25, 0.1, 0.25, 1],
   'ease-in': [0.42, 0, 1, 1],
   'ease-out': [0, 0, 0.58, 1],
   'ease-in-out': [0.42, 0, 0.58, 1],
};

/** Map linear progress 0..1 through a named CSS easing curve. */
export function ease(name: SlideEasing, t: number): number {
   const p = BEZIER[name];
   if (!p || t <= 0 || t >= 1) {
      return Math.min(1, Math.max(0, t));
   }
   const [x1, y1, x2, y2] = p;
   const bx = (s: number): number => 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
   const by = (s: number): number => 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
   let lo = 0;
   let hi = 1;
   for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (bx(mid) < t) {
         lo = mid;
      } else {
         hi = mid;
      }
   }
   return by((lo + hi) / 2);
}
