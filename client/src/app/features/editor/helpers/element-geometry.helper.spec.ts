import { sameBoxes } from './element-geometry.helper';

describe('sameBoxes', () => {
   const box = (x0: number) => ({ x0, y0: 0, x1: x0 + 10, y1: 10 });

   it('treats freshly built boxes with the same coordinates as equal', () => {
      expect(sameBoxes([box(0), box(20)], [box(0), box(20)])).toBe(true);
   });

   it('notices a moved, added or reordered box', () => {
      expect(sameBoxes([box(0)], [box(1)])).toBe(false);
      expect(sameBoxes([box(0)], [box(0), box(20)])).toBe(false);
      expect(sameBoxes([box(0), box(20)], [box(20), box(0)])).toBe(false);
   });
});
