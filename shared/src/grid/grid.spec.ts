import { gridApplyOps, gridFromRows, gridSummary, parseGrid, serializeGrid } from './index';

const build = (rows: string[][]) => {
  const e = gridFromRows(rows);
  return { text: serializeGrid(e.grid), width: e.width, height: e.height, fontSize: 14 };
};

describe('grid tables', () => {
  it('builds from rows with a header and padded columns', () => {
    const e = gridFromRows([['Name', 'Status'], ['Login page']]);
    expect(e.grid.cells).toEqual([['Name', 'Status'], ['Login page', '']]);
    expect(e.grid.header).toBe(true);
    expect(e.width).toBe(e.grid.cols.reduce((a, b) => a + b, 0));
  });

  it('applies inserts, merges and styles in order', () => {
    const el = build([['A', 'B'], ['1', '2']]);
    const out = gridApplyOps(el, [
      { op: 'insertRows', at: 2, values: [['3', '4']] },
      { op: 'merge', r0: 0, c0: 0, r1: 0, c1: 1 },
      { op: 'style', r0: 1, c0: 0, r1: 2, c1: 0, style: { bold: true } },
    ]);
    expect(out.grid.cells.map((r) => r.join('|'))).toEqual(['A\nB|', '1|2', '3|4']);
    expect(out.grid.merges).toEqual([{ r: 0, c: 0, rs: 1, cs: 2 }]);
    expect(out.grid.styles?.['2,0']).toEqual({ bold: true });
    expect(out.height).toBeGreaterThan(el.height);
  });

  it('keeps a merge origin text when its row is deleted', () => {
    const el = build([['T', ''], ['', ''], ['x', 'y']]);
    const merged = gridApplyOps(el, [{ op: 'merge', r0: 0, c0: 0, r1: 1, c1: 1 }]);
    const out = gridApplyOps(
      { text: serializeGrid(merged.grid), width: merged.width, height: merged.height },
      [{ op: 'deleteRows', at: 0 }],
    );
    expect(out.grid.cells[0][0]).toBe('T');
    expect(out.grid.merges).toEqual([{ r: 0, c: 0, rs: 1, cs: 2 }]);
  });

  it('rejects out-of-range ops and drops bad stored merges', () => {
    const el = build([['a']]);
    expect(() => gridApplyOps(el, [{ op: 'merge', r0: 0, c0: 0, r1: 3, c1: 0 }])).toThrow(/outside/);
    const g = parseGrid(JSON.stringify({ cols: [1, 1], rows: [1], cells: [['a', 'b']], merges: [{ r: 0, c: 0, rs: 5, cs: 1 }] }));
    expect(g.merges).toEqual([]);
    expect(gridSummary(serializeGrid(g))).toBe('1x2 table: a | b');
  });
});
