import { gridMirrorPart, gridPartBox, gridPartLabel, gridZoneAt } from './grid-zones.helper';

// A 3x3 table drawn 300x90 px: rows 30 px, columns 100 px.
const rows = [1, 1, 1];
const cols = [1, 1, 1];
const at = (x: number, y: number, opts = {}) => gridZoneAt(rows, cols, x / 300, y / 90, 300, 90, opts);

describe('grid snap zones', () => {
   it('picks the whole table outside, columns on the top strip, rows on the left strip, cells inside', () => {
      expect(at(-4, 40)).toBeNull();
      expect(at(150, 95)).toBeNull();
      expect(at(150, 4)).toEqual({ kind: 'col', i: 1 });
      expect(at(4, 70)).toEqual({ kind: 'row', i: 2 });
      expect(at(250, 50)).toEqual({ kind: 'cell', r: 1, c: 2 });
      // Corner: the nearer edge wins.
      expect(at(3, 6)).toEqual({ kind: 'row', i: 0 });
      expect(at(8, 2)).toEqual({ kind: 'col', i: 0 });
   });

   it('keeps most of a small table for cells', () => {
      // 60x27 px on screen: strips shrink to a fifth (5.4 px tall, 10 px wide).
      expect(gridZoneAt(rows, cols, 0.5, 8 / 27, 60, 27)).toEqual({ kind: 'cell', r: 0, c: 1 });
      expect(gridZoneAt(rows, cols, 0.5, 3 / 27, 60, 27)).toEqual({ kind: 'col', i: 1 });
   });

   it('skips the strips when only cells are wanted', () => {
      expect(at(150, 4, { cellOnly: true })).toEqual({ kind: 'cell', r: 0, c: 1 });
   });

   it('snaps to the nearest part of the dragged level anywhere over the table', () => {
      expect(at(250, 50, { level: 'row' })).toEqual({ kind: 'row', i: 1 });
      expect(at(-20, 50, { level: 'col' })).toEqual({ kind: 'col', i: 0 });
      expect(at(400, 200, { level: 'cell' })).toEqual({ kind: 'cell', r: 2, c: 2 });
   });

   it('measures and names parts', () => {
      expect(gridPartBox([1, 3], cols, { kind: 'row', i: 1 })).toEqual({ x: 0, y: 0.25, w: 1, h: 0.75 });
      expect(gridPartLabel({ kind: 'cell', r: 1, c: 27 })).toBe('Cell AB2');
      expect(gridPartLabel({ kind: 'col', i: 0 })).toBe('Column A');
      expect(gridPartLabel(null)).toBe('Table');
   });
});

describe('gridMirrorPart', () => {
   it('finds the part at the same spot of the other table', () => {
      const four = { rows: [1, 1, 1, 1], cols: [1, 1, 1, 1] };
      expect(gridMirrorPart(four, { rows, cols }, { kind: 'cell', r: 3, c: 3 })).toEqual({ kind: 'cell', r: 2, c: 2 });
      expect(gridMirrorPart(four, { rows, cols }, { kind: 'row', i: 1 })).toEqual({ kind: 'row', i: 1 });
   });
});
