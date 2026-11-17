import {
  clearGridTag,
  gridCellPairs,
  gridDeleteRow,
  gridInsertCol,
  gridInsertRow,
  gridMorphPairs,
  parseGrid,
  serializeGrid,
  setGridPartTag,
  defaultGrid,
  type GridData,
} from './index';
import type { CanvasElementModel } from '../models';

const el = (g: GridData) => ({ text: serializeGrid(g), width: 360, height: 108 }) as CanvasElementModel;

describe('grid morph tags', () => {
  it('round-trips through the grid JSON and drops malformed entries', () => {
    const g = parseGrid(
      JSON.stringify({
        ...defaultGrid(),
        morph: { rows: { '1': { out: 'p1' }, '9': { in: 'x' } }, cells: { '0,2': { in: 'c' }, bad: { in: 'y' } } },
      }),
    );
    expect(g.morph).toEqual({ rows: { '1': { out: 'p1' } }, cells: { '0,2': { in: 'c' } } });
    expect(parseGrid(serializeGrid(g)).morph).toEqual(g.morph);
    expect(serializeGrid(defaultGrid())).not.toContain('morph');
  });

  it('follows rows and columns through inserts and deletes', () => {
    let g: GridData = { ...defaultGrid(), morph: { rows: { '1': { out: 'r' } }, cells: { '2,1': { out: 'c' } } } };
    g = gridInsertRow(el(g), 0).grid;
    expect(g.morph).toEqual({ rows: { '2': { out: 'r' } }, cells: { '3,1': { out: 'c' } } });
    g = gridInsertCol(el(g), 0).grid;
    expect(g.morph?.cells).toEqual({ '3,2': { out: 'c' } });
    g = gridDeleteRow(el(g), 2)!.grid;
    expect(g.morph).toEqual({ cells: { '2,2': { out: 'c' } } });
  });

  it('sets, clears and pairs part tags', () => {
    let a = setGridPartTag(undefined, { kind: 'row', i: 0 }, 'out', 't1');
    a = setGridPartTag(a, { kind: 'cell', r: 1, c: 1 }, 'out', 't2');
    let b = setGridPartTag(undefined, { kind: 'row', i: 2 }, 'in', 't1');
    b = setGridPartTag(b, { kind: 'cell', r: 0, c: 0 }, 'in', 't2');
    expect(gridMorphPairs({ morph: a }, { morph: b })).toEqual({
      rows: [[0, 2]],
      cols: [],
      cells: [[[1, 1], [0, 0]]],
    });
    // Played backwards the in / out sides swap, so nothing pairs here.
    expect(gridMorphPairs({ morph: a }, { morph: b }, true).rows).toEqual([]);
    expect(clearGridTag(a, 'out', 't1')).toEqual({ cells: { '1,1': { out: 't2' } } });
    expect(setGridPartTag(clearGridTag(a, 'out', 't1'), { kind: 'cell', r: 1, c: 1 }, 'out', null)).toBeUndefined();
  });

  it('resolves rows and columns to cells, a cell pairing winning over its row', () => {
    const g = defaultGrid(3, 3);
    const a = { ...g, morph: { rows: { '0': { out: 'r' } }, cells: { '0,0': { out: 'c' } } } };
    const b = { ...g, morph: { rows: { '2': { in: 'r' } }, cells: { '1,1': { in: 'c' } } } };
    expect(gridCellPairs(a, b)).toEqual([
      [[0, 0], [1, 1]],
      [[0, 1], [2, 1]],
      [[0, 2], [2, 2]],
    ]);
    const cols = {
      a: { ...g, morph: { cols: { '0': { out: 'k' } } } },
      b: { ...defaultGrid(2, 3), morph: { cols: { '2': { in: 'k' } } } },
    };
    expect(gridCellPairs(cols.a, cols.b)).toEqual([
      [[0, 0], [0, 2]],
      [[1, 0], [1, 2]],
    ]);
  });
});
