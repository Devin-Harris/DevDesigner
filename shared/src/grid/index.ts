import type { TextAlign, VerticalAlign } from '../enums';
import type { CanvasElementModel } from '../models';

/** Per-cell overrides of the table's text styling (absent keys inherit the element's). */
export interface GridCellStyle {
  align?: TextAlign;
  vAlign?: VerticalAlign;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  fill?: string;
}

export const gridCellKey = (r: number, c: number): string => `${r},${c}`;

/** A merged block: origin cell (r, c) spanning `rs` rows and `cs` columns. */
export interface GridCellMerge {
  r: number;
  c: number;
  rs: number;
  cs: number;
}

/**
 * Content of a `grid` element (a spreadsheet/Word-style table, unrelated to the
 * ERD tables). Persisted as JSON in the element's `text` column so it rides the
 * existing element pipeline (REST, realtime, undo, export/import) unchanged.
 *
 * `cols`/`rows` are relative weights: the element's width/height is the source of
 * truth and is split across them proportionally, so resizing the whole element
 * (or scaling a slide) scales every column and row with it.
 */
export interface GridData {
  cols: number[];
  rows: number[];
  /** cells[row][col] — plain text, may contain newlines. */
  cells: string[][];
  /** Draw the first row as a bold header row. */
  header: boolean;
  /** Per-cell style overrides keyed by `row,col`. */
  styles?: Record<string, GridCellStyle>;
  /** Merged cell blocks (non-overlapping; text/style live on the origin cell). */
  merges?: GridCellMerge[];
}

/** Smallest a column/row may be dragged to (world px). */
export const GRID_MIN_CELL = 24;
/** Padding inside each cell (world px), shared by renderer and cell editor. */
export const GRID_CELL_PAD = 8;
export const GRID_DEFAULT_COL_W = 120;
export const GRID_DEFAULT_ROW_H = 36;

export function defaultGrid(rows = 3, cols = 3): GridData {
  return {
    cols: Array(cols).fill(GRID_DEFAULT_COL_W),
    rows: Array(rows).fill(GRID_DEFAULT_ROW_H),
    cells: Array.from({ length: rows }, () => Array(cols).fill('')),
    header: true,
  };
}

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** Parse a grid element's stored JSON, repairing anything malformed into a valid grid. */
export function parseGrid(text: string | undefined): GridData {
  let raw: Partial<GridData> | null = null;
  try {
    raw = text ? (JSON.parse(text) as Partial<GridData>) : null;
  } catch {
    raw = null;
  }
  if (!raw || !Array.isArray(raw.cols) || !Array.isArray(raw.rows)) {
    return defaultGrid();
  }
  const cols = raw.cols.map((c) => (positive(c) ? c : GRID_DEFAULT_COL_W));
  const rows = raw.rows.map((r) => (positive(r) ? r : GRID_DEFAULT_ROW_H));
  if (!cols.length || !rows.length) {
    return defaultGrid();
  }
  const src = Array.isArray(raw.cells) ? raw.cells : [];
  const cells = rows.map((_, r) =>
    cols.map((_, c) => {
      const v = Array.isArray(src[r]) ? src[r][c] : '';
      return typeof v === 'string' ? v : v == null ? '' : String(v);
    }),
  );
  const styles: Record<string, GridCellStyle> = {};
  if (raw.styles && typeof raw.styles === 'object') {
    for (const [k, v] of Object.entries(raw.styles)) {
      if (/^\d+,\d+$/.test(k) && v && typeof v === 'object') {
        styles[k] = v as GridCellStyle;
      }
    }
  }
  const merges = cleanMerges(Array.isArray(raw.merges) ? raw.merges : [], rows.length, cols.length);
  return { cols, rows, cells, header: raw.header !== false, styles, merges };
}

/** Keep only in-bounds, multi-cell, non-overlapping merges. */
function cleanMerges(list: unknown[], nRows: number, nCols: number): GridCellMerge[] {
  const out: GridCellMerge[] = [];
  for (const m of list as Partial<GridCellMerge>[]) {
    if (!m || ![m.r, m.c, m.rs, m.cs].every((n) => Number.isInteger(n))) continue;
    const r = Math.max(0, m.r!);
    const c = Math.max(0, m.c!);
    const rs = Math.min(m.rs!, nRows - r);
    const cs = Math.min(m.cs!, nCols - c);
    if (rs < 1 || cs < 1 || (rs === 1 && cs === 1)) continue;
    const next = { r, c, rs, cs };
    if (out.some((o) => overlaps(o, next))) continue;
    out.push(next);
  }
  return out;
}

function overlaps(a: GridCellMerge, b: GridCellMerge): boolean {
  return a.r < b.r + b.rs && b.r < a.r + a.rs && a.c < b.c + b.cs && b.c < a.c + a.cs;
}

/** The merge containing a cell, if any. */
export function gridMergeAt(g: GridData, r: number, c: number): GridCellMerge | null {
  return g.merges?.find((m) => r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs) ?? null;
}

/** The merge origin standing for a cell (the cell itself when unmerged). */
export function gridCellOrigin(g: GridData, r: number, c: number): { row: number; col: number } {
  const m = gridMergeAt(g, r, c);
  return m ? { row: m.r, col: m.c } : { row: r, col: c };
}

/** Grow a cell block until it fully contains every merge it touches. */
export function gridExpandToMerges(
  g: GridData,
  b: { r0: number; c0: number; r1: number; c1: number },
): { r0: number; c0: number; r1: number; c1: number } {
  const out = { ...b };
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of g.merges ?? []) {
      const hit = m.r <= out.r1 && m.r + m.rs - 1 >= out.r0 && m.c <= out.c1 && m.c + m.cs - 1 >= out.c0;
      if (!hit) continue;
      const n = {
        r0: Math.min(out.r0, m.r),
        c0: Math.min(out.c0, m.c),
        r1: Math.max(out.r1, m.r + m.rs - 1),
        c1: Math.max(out.c1, m.c + m.cs - 1),
      };
      if (n.r0 !== out.r0 || n.c0 !== out.c0 || n.r1 !== out.r1 || n.c1 !== out.c1) {
        Object.assign(out, n);
        changed = true;
      }
    }
  }
  return out;
}

/** Merge a block into one cell: texts join (top-left first) into the origin, merges inside are absorbed. */
export function gridMergeBlock(
  g: GridData,
  b: { r0: number; c0: number; r1: number; c1: number },
): GridData {
  const block = gridExpandToMerges(g, b);
  const cells = g.cells.map((row) => [...row]);
  const texts: string[] = [];
  for (let r = block.r0; r <= block.r1; r += 1) {
    for (let c = block.c0; c <= block.c1; c += 1) {
      if (cells[r][c].trim()) texts.push(cells[r][c]);
      cells[r][c] = '';
    }
  }
  cells[block.r0][block.c0] = texts.join('\n');
  const merges = (g.merges ?? []).filter(
    (m) => !overlaps(m, { r: block.r0, c: block.c0, rs: block.r1 - block.r0 + 1, cs: block.c1 - block.c0 + 1 }),
  );
  if (block.r1 > block.r0 || block.c1 > block.c0) {
    merges.push({ r: block.r0, c: block.c0, rs: block.r1 - block.r0 + 1, cs: block.c1 - block.c0 + 1 });
  }
  return { ...g, cells, merges };
}

/** Split every merge touching a block back into single cells. */
export function gridUnmergeBlock(
  g: GridData,
  b: { r0: number; c0: number; r1: number; c1: number },
): GridData {
  const box = { r: b.r0, c: b.c0, rs: b.r1 - b.r0 + 1, cs: b.c1 - b.c0 + 1 };
  return { ...g, merges: (g.merges ?? []).filter((m) => !overlaps(m, box)) };
}

/** Shift merges for a row/column inserted at `at` (a merge spanning it grows). */
function insertIntoMerges(g: GridData, axis: 'r' | 'c', at: number): void {
  const span = axis === 'r' ? 'rs' : 'cs';
  g.merges = (g.merges ?? []).map((m) => {
    const n = { ...m };
    if (n[axis] >= at) n[axis] += 1;
    else if (n[axis] + n[span] > at) n[span] += 1;
    return n;
  });
}

/** Shift/shrink merges for a row/column deleted at `at`. */
function deleteFromMerges(g: GridData, axis: 'r' | 'c', at: number): void {
  const span = axis === 'r' ? 'rs' : 'cs';
  g.merges = (g.merges ?? [])
    .map((m) => {
      const n = { ...m };
      if (n[axis] > at) n[axis] -= 1;
      else if (n[axis] + n[span] > at) n[span] -= 1;
      return n;
    })
    .filter((m) => m.rs >= 1 && m.cs >= 1 && !(m.rs === 1 && m.cs === 1));
}

export function serializeGrid(g: GridData): string {
  const round = (n: number): number => Math.round(n * 100) / 100;
  return JSON.stringify({
    cols: g.cols.map(round),
    rows: g.rows.map(round),
    cells: g.cells,
    header: g.header,
    ...(g.merges?.length ? { merges: g.merges } : {}),
    ...(g.styles && Object.keys(g.styles).length ? { styles: g.styles } : {}),
  });
}

/** Pixel sizes of each column/row for an element of the given box size. */
export function gridSizes(g: GridData, width: number, height: number): { cols: number[]; rows: number[] } {
  const scale = (weights: number[], total: number): number[] => {
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    return weights.map((w) => (w / sum) * total);
  };
  return { cols: scale(g.cols, width), rows: scale(g.rows, height) };
}

/** Cumulative gridEdges: [0, w0, w0+w1, ..., total]. */
export function gridEdges(sizes: number[]): number[] {
  const out = [0];
  for (const s of sizes) {
    out.push(out[out.length - 1] + s);
  }
  return out;
}

/** The cell under a world point, or null when outside the grid (unrotated grids). */
export function gridCellAt(
  el: CanvasElementModel,
  world: { x: number; y: number },
): { row: number; col: number } | null {
  const g = parseGrid(el.text);
  const { cols, rows } = gridSizes(g, el.width, el.height);
  const lx = world.x - el.x;
  const ly = world.y - el.y;
  if (lx < 0 || ly < 0 || lx > el.width || ly > el.height) {
    return null;
  }
  const find = (e: number[], v: number): number => {
    for (let i = 1; i < e.length; i += 1) {
      if (v <= e[i]) {
        return i - 1;
      }
    }
    return e.length - 2;
  };
  return gridCellOrigin(g, find(gridEdges(rows), ly), find(gridEdges(cols), lx));
}

/**
 * Structural edits. Each returns the new grid plus the element's new width/height
 * (inserting grows the table, deleting shrinks it), with weights rewritten as the
 * current pixel sizes so nothing else shifts.
 */
export interface GridEdit {
  grid: GridData;
  width: number;
  height: number;
}

function pixelGrid(el: CanvasElementModel): GridData {
  const g = parseGrid(el.text);
  const { cols, rows } = gridSizes(g, el.width, el.height);
  return {
    ...g,
    cols,
    rows,
    cells: g.cells.map((r) => [...r]),
    styles: { ...g.styles },
    merges: (g.merges ?? []).map((m) => ({ ...m })),
  };
}

/** Re-key cell styles after a structural edit (`map` returns the new position, or null to drop). */
function remapStyles(g: GridData, map: (r: number, c: number) => [number, number] | null): void {
  const out: Record<string, GridCellStyle> = {};
  for (const [k, v] of Object.entries(g.styles ?? {})) {
    const [r, c] = k.split(',').map(Number);
    const to = map(r, c);
    if (to) {
      out[gridCellKey(to[0], to[1])] = v;
    }
  }
  g.styles = out;
}

function finish(g: GridData): GridEdit {
  return {
    grid: g,
    width: g.cols.reduce((a, b) => a + b, 0),
    height: g.rows.reduce((a, b) => a + b, 0),
  };
}

export function gridInsertRow(el: CanvasElementModel, at: number): GridEdit {
  const g = pixelGrid(el);
  const i = Math.max(0, Math.min(at, g.rows.length));
  const ref = g.rows[Math.min(i, g.rows.length - 1)] ?? GRID_DEFAULT_ROW_H;
  g.rows.splice(i, 0, Math.max(GRID_MIN_CELL, Math.min(ref, GRID_DEFAULT_ROW_H * 1.5)));
  g.cells.splice(i, 0, Array(g.cols.length).fill(''));
  remapStyles(g, (r, c) => [r >= i ? r + 1 : r, c]);
  insertIntoMerges(g, 'r', i);
  return finish(g);
}

export function gridInsertCol(el: CanvasElementModel, at: number): GridEdit {
  const g = pixelGrid(el);
  const i = Math.max(0, Math.min(at, g.cols.length));
  const ref = g.cols[Math.min(i, g.cols.length - 1)] ?? GRID_DEFAULT_COL_W;
  g.cols.splice(i, 0, ref);
  g.cells.forEach((r) => r.splice(i, 0, ''));
  remapStyles(g, (r, c) => [r, c >= i ? c + 1 : c]);
  insertIntoMerges(g, 'c', i);
  return finish(g);
}

/**
 * Before deleting the origin row/column of a merge that continues past it, move
 * the origin's text and style to the next cell so they survive. Must run before
 * the row/column is spliced out.
 */
function rescueMergeOrigin(g: GridData, axis: 'r' | 'c', at: number): void {
  for (const m of g.merges ?? []) {
    const span = axis === 'r' ? m.rs : m.cs;
    if (m[axis] !== at || span < 2) continue;
    const [nr, nc] = axis === 'r' ? [m.r + 1, m.c] : [m.r, m.c + 1];
    g.cells[nr][nc] = g.cells[m.r][m.c];
    const style = g.styles?.[gridCellKey(m.r, m.c)];
    if (style && g.styles) g.styles[gridCellKey(nr, nc)] = style;
  }
}

export function gridDeleteRow(el: CanvasElementModel, at: number): GridEdit | null {
  const g = pixelGrid(el);
  if (g.rows.length <= 1 || at < 0 || at >= g.rows.length) {
    return null;
  }
  rescueMergeOrigin(g, 'r', at);
  g.rows.splice(at, 1);
  g.cells.splice(at, 1);
  remapStyles(g, (r, c) => (r === at ? null : [r > at ? r - 1 : r, c]));
  deleteFromMerges(g, 'r', at);
  return finish(g);
}

export function gridDeleteCol(el: CanvasElementModel, at: number): GridEdit | null {
  const g = pixelGrid(el);
  if (g.cols.length <= 1 || at < 0 || at >= g.cols.length) {
    return null;
  }
  rescueMergeOrigin(g, 'c', at);
  g.cols.splice(at, 1);
  g.cells.forEach((r) => r.splice(at, 1));
  remapStyles(g, (r, c) => (c === at ? null : [r, c > at ? c - 1 : c]));
  deleteFromMerges(g, 'c', at);
  return finish(g);
}

/** Move the border after column/row `index` by `delta` world px (last border grows the table). */
export function gridDragBorder(
  start: GridData,
  axis: 'col' | 'row',
  index: number,
  delta: number,
): GridEdit {
  const g: GridData = { ...start, cols: [...start.cols], rows: [...start.rows] };
  const sizes = axis === 'col' ? g.cols : g.rows;
  if (index >= sizes.length - 1) {
    sizes[index] = Math.max(GRID_MIN_CELL, sizes[index] + delta);
  } else {
    const d = Math.max(
      GRID_MIN_CELL - sizes[index],
      Math.min(delta, sizes[index + 1] - GRID_MIN_CELL),
    );
    sizes[index] += d;
    sizes[index + 1] -= d;
  }
  return finish(g);
}

/** The grid with its weights rewritten as pixel sizes (for drag gestures). */
export function gridInPixels(el: CanvasElementModel): GridData {
  return pixelGrid(el);
}

// --- Programmatic building / editing (MCP tools, imports) ---------------------------

/** Rough glyph width in px for a font size (no DOM; matches estimateTextSize's 0.58em). */
const charW = (fontSize: number): number => fontSize * 0.58;

/** Wrapped line count of `text` in a cell `width` px wide (approximation without fonts). */
function estimateLines(text: string, width: number, fontSize: number): number {
  const perLine = Math.max(1, Math.floor((width - GRID_CELL_PAD * 2) / charW(fontSize)));
  return text.split('\n').reduce((n, para) => {
    let lines = 1;
    let used = 0;
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const len = word.length;
      if (used && used + 1 + len > perLine) {
        lines += 1;
        used = 0;
      }
      used += (used ? 1 : 0) + len;
      while (used > perLine) {
        lines += 1;
        used -= perLine;
      }
    }
    return n + lines;
  }, 0);
}

/** Estimated height each row needs for its text (merged blocks included), never below its current height. */
export function gridEstimateRowHeights(g: GridData, fontSize: number, lineHeight = 1.25): number[] {
  const lineH = fontSize * lineHeight;
  const need = (r: number, c: number, width: number): number =>
    estimateLines(g.cells[r][c], width, fontSize) * lineH + GRID_CELL_PAD * 2;
  const out = g.rows.map((h, r) => {
    let best = h;
    g.cells[r].forEach((_, c) => {
      const m = gridMergeAt(g, r, c);
      if (m && (m.r !== r || m.c !== c || m.rs > 1)) return;
      const width = m ? g.cols.slice(c, c + m.cs).reduce((a, b) => a + b, 0) : g.cols[c];
      best = Math.max(best, need(r, c, width));
    });
    return best;
  });
  for (const m of g.merges ?? []) {
    if (m.rs < 2) continue;
    const width = g.cols.slice(m.c, m.c + m.cs).reduce((a, b) => a + b, 0);
    const others = out.slice(m.r, m.r + m.rs - 1).reduce((a, b) => a + b, 0);
    const last = m.r + m.rs - 1;
    out[last] = Math.max(out[last], need(m.r, m.c, width) - others);
  }
  return out;
}

/**
 * A grid built from rows of cell text: columns sized to their longest line
 * (within limits), rows tall enough for their wrapped text.
 */
export function gridFromRows(
  rows: string[][],
  opts: { header?: boolean; fontSize?: number; columnWidths?: number[]; maxColumnWidth?: number } = {},
): GridEdit {
  const fontSize = opts.fontSize ?? 14;
  const nCols = Math.max(1, ...rows.map((r) => r.length));
  const body = rows.length ? rows : [Array<string>(nCols).fill('')];
  const cells = body.map((r) => Array.from({ length: nCols }, (_, c) => r[c] ?? ''));
  const maxW = opts.maxColumnWidth ?? 320;
  const cols = Array.from({ length: nCols }, (_, c) => {
    const given = opts.columnWidths?.[c];
    if (given && given > 0) return Math.max(GRID_MIN_CELL, given);
    const longest = Math.max(0, ...cells.map((r) => Math.max(...r[c].split('\n').map((l) => l.length))));
    return Math.round(Math.min(maxW, Math.max(80, longest * charW(fontSize) + GRID_CELL_PAD * 2 + 4)));
  });
  const lineH = fontSize * 1.25;
  const g: GridData = {
    cols,
    rows: cells.map(() => Math.max(GRID_DEFAULT_ROW_H * (fontSize / 14), lineH + GRID_CELL_PAD * 2)),
    cells,
    header: opts.header !== false,
    styles: {},
    merges: [],
  };
  g.rows = gridEstimateRowHeights(g, fontSize);
  return finish(g);
}

/** One step of a programmatic grid edit (see gridApplyOps). */
export type GridOp =
  | { op: 'setCells'; row: number; col: number; values: string[][] }
  | { op: 'insertRows'; at: number; count?: number; values?: string[][] }
  | { op: 'deleteRows'; at: number; count?: number }
  | { op: 'insertColumns'; at: number; count?: number; values?: string[][] }
  | { op: 'deleteColumns'; at: number; count?: number }
  | { op: 'merge'; r0: number; c0: number; r1: number; c1: number }
  | { op: 'unmerge'; r0: number; c0: number; r1: number; c1: number }
  | {
      op: 'style';
      r0: number;
      c0: number;
      r1: number;
      c1: number;
      style: { [K in keyof GridCellStyle]?: GridCellStyle[K] | null };
    }
  | { op: 'header'; on: boolean }
  | { op: 'columnWidths'; widths: (number | null)[] }
  | { op: 'rowHeights'; heights: (number | null)[] };

/** A pseudo element carrying a pixel grid, so the structural helpers can run on it. */
function asElement(g: GridData): CanvasElementModel {
  return {
    text: serializeGrid(g),
    width: g.cols.reduce((a, b) => a + b, 0),
    height: g.rows.reduce((a, b) => a + b, 0),
  } as CanvasElementModel;
}

/**
 * Apply edits to a grid element's content in order. Indices are 0-based and refer
 * to the grid as it is at that step. Rows grow to fit new text (estimated);
 * nothing shrinks unless sizes are set explicitly. Throws an Error with a
 * readable message on an out-of-range op.
 */
export function gridApplyOps(
  el: Pick<CanvasElementModel, 'text' | 'width' | 'height' | 'fontSize' | 'lineHeight'>,
  ops: GridOp[],
): GridEdit {
  let g = pixelGrid(el as CanvasElementModel);
  const nR = (): number => g.rows.length;
  const nC = (): number => g.cols.length;
  const block = (o: { r0: number; c0: number; r1: number; c1: number }, i: number) => {
    const b = {
      r0: Math.min(o.r0, o.r1),
      r1: Math.max(o.r0, o.r1),
      c0: Math.min(o.c0, o.c1),
      c1: Math.max(o.c0, o.c1),
    };
    if (b.r0 < 0 || b.c0 < 0 || b.r1 >= nR() || b.c1 >= nC()) {
      throw new Error(
        `ops[${i}]: cells ${b.r0},${b.c0}..${b.r1},${b.c1} are outside the ${nR()}x${nC()} table.`,
      );
    }
    return b;
  };
  ops.forEach((o, i) => {
    switch (o.op) {
      case 'setCells': {
        if (o.row < 0 || o.col < 0) throw new Error(`ops[${i}]: row/col must be >= 0.`);
        // Writing past the edge grows the table.
        const needR = o.row + o.values.length;
        const needC = o.col + Math.max(0, ...o.values.map((r) => r.length));
        while (nR() < needR) g = pixelGrid(asElement(gridInsertRow(asElement(g), nR()).grid));
        while (nC() < needC) g = pixelGrid(asElement(gridInsertCol(asElement(g), nC()).grid));
        o.values.forEach((row, dr) =>
          row.forEach((v, dc) => {
            const at = gridCellOrigin(g, o.row + dr, o.col + dc);
            g.cells[at.row][at.col] = v;
          }),
        );
        break;
      }
      case 'insertRows':
      case 'insertColumns': {
        const rowsOp = o.op === 'insertRows';
        const limit = rowsOp ? nR() : nC();
        if (o.at < 0 || o.at > limit) throw new Error(`ops[${i}]: at must be 0..${limit}.`);
        const count = Math.max(1, o.count ?? o.values?.length ?? 1);
        for (let k = 0; k < count; k += 1) {
          const edit = rowsOp
            ? gridInsertRow(asElement(g), o.at + k)
            : gridInsertCol(asElement(g), o.at + k);
          g = pixelGrid(asElement(edit.grid));
        }
        o.values?.forEach((vals, k) =>
          vals.forEach((v, j) => {
            const [r, c] = rowsOp ? [o.at + k, j] : [j, o.at + k];
            if (r < nR() && c < nC()) g.cells[r][c] = v;
          }),
        );
        break;
      }
      case 'deleteRows':
      case 'deleteColumns': {
        const rowsOp = o.op === 'deleteRows';
        const count = Math.max(1, o.count ?? 1);
        const limit = rowsOp ? nR() : nC();
        const what = rowsOp ? 'rows' : 'columns';
        if (o.at < 0 || o.at + count > limit) {
          throw new Error(`ops[${i}]: ${what} ${o.at}..${o.at + count - 1} do not exist (have ${limit}).`);
        }
        if (count >= limit) throw new Error(`ops[${i}]: a table needs at least one ${what.slice(0, -1)}.`);
        for (let k = 0; k < count; k += 1) {
          const edit = rowsOp ? gridDeleteRow(asElement(g), o.at) : gridDeleteCol(asElement(g), o.at);
          if (edit) g = pixelGrid(asElement(edit.grid));
        }
        break;
      }
      case 'merge':
        g = gridMergeBlock(g, block(o, i));
        break;
      case 'unmerge':
        g = gridUnmergeBlock(g, block(o, i));
        break;
      case 'style': {
        const b = block(o, i);
        const styles = { ...(g.styles ?? {}) };
        for (let r = b.r0; r <= b.r1; r += 1) {
          for (let c = b.c0; c <= b.c1; c += 1) {
            const k = gridCellKey(r, c);
            const next: Record<string, unknown> = { ...styles[k] };
            for (const [key, v] of Object.entries(o.style)) {
              if (v === null || v === undefined) delete next[key];
              else next[key] = v;
            }
            if (Object.keys(next).length) styles[k] = next as GridCellStyle;
            else delete styles[k];
          }
        }
        g.styles = styles;
        break;
      }
      case 'header':
        g.header = o.on;
        break;
      case 'columnWidths':
        o.widths.forEach((w, c) => {
          if (w != null && c < nC()) g.cols[c] = Math.max(GRID_MIN_CELL, w);
        });
        break;
      case 'rowHeights':
        o.heights.forEach((h, r) => {
          if (h != null && r < nR()) g.rows[r] = Math.max(GRID_MIN_CELL, h);
        });
        break;
    }
  });
  g.rows = gridEstimateRowHeights(g, el.fontSize ?? 14, el.lineHeight ?? 1.25);
  return finish(g);
}

/** One-line description of a grid element's content, e.g. "3x4 table: Name | Status". */
export function gridSummary(text: string | undefined, max = 80): string {
  const g = parseGrid(text);
  const first = g.cells[0].filter(Boolean).join(' | ');
  const s = `${g.rows.length}x${g.cols.length} table${first ? `: ${first}` : ''}`;
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}
