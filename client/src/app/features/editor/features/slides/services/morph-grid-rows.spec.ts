import { defaultGrid, type GridData } from '@devdesigner/shared';
import { blendGridAxis, blendGridRows, gridLineMap } from '../helpers/morph/morph-grid.helper';

const grid = (cells: string[][]): GridData => ({
   ...defaultGrid(cells.length, cells[0].length),
   cells,
   header: false,
});
const box = (rows: number) => ({ x: 0, y: 0, width: 100, height: rows * 10 });

describe('blendGridRows', () => {
   const a = grid([['x'], ['y'], ['z']]);
   const b = grid([['y'], ['q'], ['z'], ['w']]);

   it('pairs rows by content when nothing is paired by hand', () => {
      // y and z line up by content, so the main table spans b's rows 0..2 at the end.
      const [main] = blendGridRows(a, b, box(3), box(4), 1);
      expect(main.box.y).toBeCloseTo(0);
      expect(main.box.height).toBeCloseTo(30);
   });

   it('anchors on rows paired by hand instead', () => {
      // a row 0 -> b row 3: the paired span starts and ends at b's last row.
      const [main] = blendGridRows(a, b, box(3), box(4), 1, [[0, 3]]);
      expect(main.box.y).toBeCloseTo(30);
      expect(main.box.height).toBeCloseTo(10);
   });
});

describe('gridLineMap', () => {
   it('follows hand pairs, then shared cells, then position', () => {
      const a = grid([['Name', 'Q1'], ['Alpha', '10'], ['Beta', '30']]);
      const b = grid([['Name', 'Q1'], ['Beta', '31'], ['Gamma', '5'], ['Alpha', '11']]);
      expect([...gridLineMap(a, b).entries()].sort((x, y) => x[0] - y[0])).toEqual([
         [0, 0],
         [1, 3],
         [2, 1],
      ]);
      expect(gridLineMap(a, b, [[1, 2]]).get(1)).toBe(2);
   });
});

describe('blendGridAxis', () => {
   it('glides paired lines and grows / shrinks the rest in place', () => {
      // a: 2 rows; b: an extra row in between. Halfway the new row is half grown.
      const mid = blendGridAxis([1, 1], [1, 1, 1], [[0, 0], [1, 2]], 0.5);
      expect(mid.src).toEqual([{ a: 0, b: 0 }, { b: 1 }, { a: 1, b: 2 }]);
      expect(mid.sizes.map((x) => Math.round(x))).toEqual([417, 167, 417]);
      const end = blendGridAxis([1, 1], [1, 1, 1], [[0, 0], [1, 2]], 1);
      expect(end.sizes.map((x) => Math.round(x))).toEqual([333, 333, 333]);
   });
});

describe('gridLineMap with a line added in front', () => {
   it('follows the content when everything shifts by one', () => {
      // A blank row / column was added above / left of the table.
      const a = grid([['asdf', '', ''], ['', 'asdf', 'sdfg'], ['', 'asdf', '']]);
      const b = grid([
         ['', '', '', ''],
         ['', '', '', ''],
         ['', '', 'asdf', 'sdfg'],
         ['', '', 'asdf', ''],
      ]);
      const sorted = (m: Map<number, number>) => [...m.entries()].sort((x, y) => x[0] - y[0]);
      // Row 0 shares nothing: it takes the nearest free row (b's first).
      expect(sorted(gridLineMap(a, b))).toEqual([
         [0, 0],
         [1, 2],
         [2, 3],
      ]);
   });
});
