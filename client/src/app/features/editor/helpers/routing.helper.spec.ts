import { EXIT_STUB, MIN_STUB } from '../shared/constants/canvas.constants';
import type { Box, Point } from '../models/geometry.model';
import { segmentHitsBox } from './route.helper';
import { cleanElbow, routeOrthogonal, routeThroughWaypoints } from './routing.helper';

const box = (x0: number, y0: number, w = 200, h = 100): Box => ({ x0, y0, x1: x0 + w, y1: y0 + h });
const RIGHT = 1;
const LEFT = -1;

/** Every segment is horizontal or vertical. */
const isOrthogonal = (route: readonly Point[]): boolean =>
   route.every((p, i) => i === 0 || p.x === route[i - 1].x || p.y === route[i - 1].y);
const hits = (route: readonly Point[], b: Box): boolean =>
   route.some((p, i) => i > 0 && segmentHitsBox(route[i - 1], p, b));

describe('cleanElbow', () => {
   it('puts the vertical channel midway between facing anchors', () => {
      // Source right edge at 200, target left edge at 400.
      const a = { x: 200, y: 50 };
      const b = { x: 400, y: 250 };
      const route = cleanElbow(a, b, RIGHT, LEFT, box(0, 0), box(400, 200));
      expect(route).toEqual([a, { x: 300, y: 50 }, { x: 300, y: 250 }, b]);
   });

   it('collapses to a straight line when facing anchors share a row', () => {
      const a = { x: 200, y: 50 };
      const b = { x: 400, y: 50 };
      expect(cleanElbow(a, b, RIGHT, LEFT, box(0, 0), box(400, 0))).toEqual([a, b]);
   });

   it('runs same-side anchors out past the further table and back', () => {
      const a = { x: 200, y: 50 };
      const b = { x: 500, y: 250 };
      const route = cleanElbow(a, b, RIGHT, RIGHT, box(0, 0), box(300, 200));
      const extent = 500 + EXIT_STUB;
      expect(route).toEqual([a, { x: extent, y: 50 }, { x: extent, y: 250 }, b]);
   });

   it('clamps the same-side detour to the frame bounds', () => {
      const route = cleanElbow({ x: 200, y: 50 }, { x: 500, y: 250 }, RIGHT, RIGHT, box(0, 0), box(300, 200), {
         x0: 0,
         y0: 0,
         x1: 510,
         y1: 400,
      });
      expect(Math.max(...route.map((p) => p.x))).toBe(510);
   });

   it('wraps through the vertical gap when opposite-side anchors face away from each other', () => {
      // Right exit from a table that sits to the right of the target's left entry.
      const sBox = box(400, 0);
      const tBox = box(0, 300);
      const a = { x: 600, y: 50 };
      const b = { x: 0, y: 350 };
      const route = cleanElbow(a, b, RIGHT, LEFT, sBox, tBox);
      expect(isOrthogonal(route)).toBe(true);
      expect(route).toContainEqual({ x: 600 + EXIT_STUB, y: 200 }); // midY between 100 and 300
      expect(hits(route, sBox)).toBe(false);
      expect(hits(route, tBox)).toBe(false);
   });

   it('wraps around the outside when the tables overlap vertically', () => {
      const sBox = box(400, 0);
      const tBox = box(0, 50);
      const route = cleanElbow({ x: 600, y: 50 }, { x: 0, y: 100 }, RIGHT, LEFT, sBox, tBox);
      const ys = route.map((p) => p.y);
      expect(Math.max(...ys) > 150 || Math.min(...ys) < 0).toBe(true);
   });

   it('treats anchors closer than two minimum stubs as not facing', () => {
      const route = cleanElbow(
         { x: 200, y: 50 },
         { x: 200 + 2 * MIN_STUB - 1, y: 300 },
         RIGHT,
         LEFT,
         box(0, 0),
         box(219, 250)
      );
      expect(route.length).toBeGreaterThan(4);
   });
});

describe('routeOrthogonal', () => {
   const source = box(0, 0);
   const target = box(800, 0);
   const a = { x: 200, y: 50 };
   const b = { x: 800, y: 50 };

   it('draws a straight line when nothing is in the way', () => {
      expect(routeOrthogonal(a, b, RIGHT, LEFT, [source, target])).toEqual([a, b]);
   });

   it('detours around a table between the anchors', () => {
      const blocker = box(400, -50, 100, 200);
      const route = routeOrthogonal(a, b, RIGHT, LEFT, [source, target, blocker]);
      expect(route[0]).toEqual(a);
      expect(route[route.length - 1]).toEqual(b);
      expect(isOrthogonal(route)).toBe(true);
      expect(hits(route, blocker)).toBe(false);
   });

   it('keeps the obstacle gap around the blocker', () => {
      const blocker = box(400, -50, 100, 200);
      const route = routeOrthogonal(a, b, RIGHT, LEFT, [source, target, blocker], 16);
      const inflated = { x0: 384, y0: -66, x1: 516, y1: 166 };
      // Only the boundary may be touched, never the inside of the inflated box.
      expect(hits(route, { x0: inflated.x0 + 1, y0: inflated.y0 + 1, x1: inflated.x1 - 1, y1: inflated.y1 - 1 })).toBe(
         false
      );
   });

   it('falls back to a plain elbow when the anchors are boxed in', () => {
      const walls = [box(-1000, -1000, 3000, 900), box(-1000, 150, 3000, 900), box(260, -100, 40, 300)];
      const route = routeOrthogonal(a, { x: 800, y: 80 }, RIGHT, LEFT, [source, target, ...walls]);
      expect(isOrthogonal(route)).toBe(true);
      expect(route[0]).toEqual(a);
      expect(route[route.length - 1]).toEqual({ x: 800, y: 80 });
   });

   it('stays inside the bounds it is confined to', () => {
      const bounds = { x0: -50, y0: -100, x1: 1100, y1: 300 };
      const blocker = box(400, -50, 100, 200);
      const route = routeOrthogonal(a, b, RIGHT, LEFT, [source, target, blocker], 16, bounds);
      for (const p of route) {
         expect(p.x).toBeGreaterThanOrEqual(bounds.x0);
         expect(p.x).toBeLessThanOrEqual(bounds.x1);
         expect(p.y).toBeGreaterThanOrEqual(bounds.y0);
         expect(p.y).toBeLessThanOrEqual(bounds.y1);
      }
   });
});

describe('routeThroughWaypoints', () => {
   const source = box(0, 0);
   const target = box(800, 0);
   const a = { x: 200, y: 50 };
   const b = { x: 800, y: 50 };

   it('passes through every usable waypoint in order', () => {
      const waypoints = [
         { x: 400, y: 300 },
         { x: 600, y: 300 },
      ];
      const route = routeThroughWaypoints(a, b, RIGHT, LEFT, waypoints, [source, target]);
      // Collinear waypoints are simplified away as corners, so look for the segment that contains each one.
      const segmentIndexOf = (w: Point): number =>
         route.findIndex(
            (p, i) =>
               i > 0 &&
               Math.min(p.x, route[i - 1].x) <= w.x &&
               w.x <= Math.max(p.x, route[i - 1].x) &&
               Math.min(p.y, route[i - 1].y) <= w.y &&
               w.y <= Math.max(p.y, route[i - 1].y)
         );
      expect(segmentIndexOf(waypoints[0])).toBeGreaterThan(0);
      expect(segmentIndexOf(waypoints[1])).toBeGreaterThanOrEqual(segmentIndexOf(waypoints[0]));
      expect(isOrthogonal(route)).toBe(true);
   });

   it('ignores waypoints that a table now covers', () => {
      const blocker = box(400, 200, 100, 100);
      const covered = { x: 450, y: 250 };
      expect(routeThroughWaypoints(a, b, RIGHT, LEFT, [covered], [source, target, blocker])).toEqual(
         routeOrthogonal(a, b, RIGHT, LEFT, [source, target, blocker])
      );
   });
});
