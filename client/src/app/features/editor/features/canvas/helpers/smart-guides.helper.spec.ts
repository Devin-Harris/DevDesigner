import type { Box } from '../../../models/geometry.model';
import { smartSnap, smartSnapEdges, snapTargets } from './smart-guides.helper';

const box = (x0: number, y0: number, w = 100, h = 50): Box => ({ x0, y0, x1: x0 + w, y1: y0 + h });

describe('smartSnap', () => {
   it('does not snap when nothing is within reach', () => {
      const result = smartSnap(box(0, 0), [box(500, 500)], 1);
      expect(result).toEqual({ ox: 0, oy: 0, snappedX: false, snappedY: false, guides: [], gaps: [] });
   });

   it.each([
      ['left edge to left edge', box(203, 300), 200, -3],
      ['right edge to right edge', box(196, 300), 200, 4],
      ['center to center', box(201, 300), 200, -1],
   ])('snaps %s on x', (_label, moving, targetX0, expectedOx) => {
      const result = smartSnap(moving, [box(targetX0, 0)], 1);
      expect(result.snappedX).toBe(true);
      expect(result.ox).toBeCloseTo(expectedOx);
   });

   it('draws a guide spanning both boxes along the cross axis', () => {
      const result = smartSnap(box(202, 300), [box(200, 0)], 1);
      const guide = result.guides.find((g) => g.axis === 'x' && g.pos === 200);
      expect(guide).toEqual({ axis: 'x', pos: 200, from: 0, to: 350 });
   });

   it('shrinks the snap reach as the zoom increases', () => {
      // 5px away: inside the 6px screen reach at zoom 1, outside it at zoom 2 (3 world px).
      expect(smartSnap(box(205, 300), [box(200, 0)], 1).snappedX).toBe(true);
      expect(smartSnap(box(205, 300), [box(200, 0)], 2).snappedX).toBe(false);
   });

   it('prefers the closest candidate', () => {
      const result = smartSnap(box(103, 300), [box(100, 0), box(105, 600)], 1);
      // 100 is 3 px to the left, 105 is 2 px to the right: the nearer one wins.
      expect(result.ox).toBeCloseTo(2);
   });

   it('centers the box between two neighbours in the same row and marks both gaps', () => {
      // Neighbours at x 0..100 and 300..400; a 100-wide box centred between them starts at 150.
      const left = box(0, 0);
      const right = box(300, 0);
      const result = smartSnap(box(152, 0), [left, right], 1);
      expect(result.ox).toBeCloseTo(-2);
      expect(result.gaps).toEqual(
         expect.arrayContaining([
            expect.objectContaining({ axis: 'x', a: 100, b: 150 }),
            expect.objectContaining({ axis: 'x', a: 250, b: 300 }),
         ])
      );
   });

   it('repeats an existing gap in the row (lists of cards)', () => {
      // Two cards 20 apart; the third snaps 20 after the second.
      const result = smartSnap(box(242, 500), [box(0, 500), box(120, 500)], 1);
      expect(result.ox).toBeCloseTo(-2);
      expect(result.gaps.filter((g) => g.axis === 'x').map((g) => g.b - g.a)).toEqual([20, 20]);
   });

   it('ignores spacing references from other rows', () => {
      const result = smartSnap(box(242, 500), [box(0, 0), box(120, 0)], 1);
      expect(result.gaps).toEqual([]);
   });
});

describe('smartSnapEdges', () => {
   it('snaps only the moving edge positions, not the whole box', () => {
      const result = smartSnapEdges(box(0, 0), [102], [], [box(100, 200)], 1);
      expect(result).toMatchObject({ ox: -2, oy: 0, snappedX: true, snappedY: false });
      expect(result.guides).toEqual([{ axis: 'x', pos: 100, from: 0, to: 250 }]);
   });

   it('returns no correction when no edge is in reach', () => {
      const result = smartSnapEdges(box(0, 0), [50], [50], [box(400, 400)], 1);
      expect(result).toMatchObject({ ox: 0, oy: 0, snappedX: false, snappedY: false, guides: [] });
   });
});

describe('snapTargets', () => {
   it('drops off-screen targets and orders the rest by distance', () => {
      const near = box(150, 0);
      const far = box(600, 0);
      const offscreen = box(5000, 5000);
      expect(snapTargets(box(0, 0), [far, offscreen, near], box(-100, -100, 1000, 1000))).toEqual([near, far]);
   });

   it('keeps every target when there is no view', () => {
      expect(snapTargets(box(0, 0), [box(5000, 5000)], null)).toHaveLength(1);
   });

   it('caps the number of competing targets at 40', () => {
      const many = Array.from({ length: 60 }, (_, i) => box(i * 10, 0));
      expect(snapTargets(box(0, 0), many, null)).toHaveLength(40);
   });
});
