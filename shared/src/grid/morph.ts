/**
 * Hand-made morph pairings inside a grid table (rows, columns and single cells),
 * set in the refine window by dragging from part of one table to part of another.
 * Like an element's `morphIn` / `morphOut`, a part carries split tags: the slide
 * before speaks with `out`, the slide after with `in`, and two parts pair when
 * those tags are equal. The whole table still pairs through the element's own tags.
 *
 * Stored in the grid JSON keyed by index (`"3"` for row/column 3, `"r,c"` for a
 * cell) and re-keyed by the structural edits, like cell styles.
 */
export interface GridMorphTag {
  in?: string;
  out?: string;
}

export interface GridMorphTags {
  rows?: Record<string, GridMorphTag>;
  cols?: Record<string, GridMorphTag>;
  cells?: Record<string, GridMorphTag>;
}

/** A row, a column or a single cell of a grid. */
export type GridPart = { kind: 'row'; i: number } | { kind: 'col'; i: number } | { kind: 'cell'; r: number; c: number };

type Bucket = keyof GridMorphTags;
const BUCKETS = ['rows', 'cols', 'cells'] as const;

const bucketOf = (p: GridPart): Bucket => (p.kind === 'row' ? 'rows' : p.kind === 'col' ? 'cols' : 'cells');
const keyOf = (p: GridPart): string => (p.kind === 'cell' ? `${p.r},${p.c}` : String(p.i));

function cleanTag(v: unknown): GridMorphTag | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const out: GridMorphTag = {};
  if (typeof o['in'] === 'string' && o['in']) out.in = o['in'];
  if (typeof o['out'] === 'string' && o['out']) out.out = o['out'];
  return out.in || out.out ? out : null;
}

function prune(m: GridMorphTags): GridMorphTags | undefined {
  const out: GridMorphTags = {};
  for (const b of BUCKETS) {
    if (m[b] && Object.keys(m[b]!).length) out[b] = m[b];
  }
  return Object.keys(out).length ? out : undefined;
}

/** Validate stored morph tags against the grid's size (anything malformed is dropped). */
export function cleanGridMorph(raw: unknown, nRows: number, nCols: number): GridMorphTags | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const src = raw as Record<string, unknown>;
  const out: GridMorphTags = {};
  const take = (b: Bucket, ok: (k: string) => boolean): void => {
    const rec = src[b];
    if (!rec || typeof rec !== 'object') return;
    for (const [k, v] of Object.entries(rec as Record<string, unknown>)) {
      const t = cleanTag(v);
      if (t && ok(k)) (out[b] ??= {})[k] = t;
    }
  };
  const idx = (n: number) => (k: string) => /^\d+$/.test(k) && Number(k) < n;
  take('rows', idx(nRows));
  take('cols', idx(nCols));
  take('cells', (k) => {
    const m = /^(\d+),(\d+)$/.exec(k);
    return !!m && Number(m[1]) < nRows && Number(m[2]) < nCols;
  });
  return prune(out);
}

/** Re-key tags after a row (`'r'`) or column (`'c'`) was inserted / deleted (`map` null = drop). */
export function remapGridMorph(
  m: GridMorphTags | undefined,
  axis: 'r' | 'c',
  map: (i: number) => number | null,
): GridMorphTags | undefined {
  if (!m) return undefined;
  const out: GridMorphTags = { ...m };
  const line = axis === 'r' ? 'rows' : 'cols';
  if (m[line]) {
    const rec: Record<string, GridMorphTag> = {};
    for (const [k, v] of Object.entries(m[line]!)) {
      const to = map(Number(k));
      if (to !== null) rec[String(to)] = v;
    }
    out[line] = rec;
  }
  if (m.cells) {
    const rec: Record<string, GridMorphTag> = {};
    for (const [k, v] of Object.entries(m.cells)) {
      const [r, c] = k.split(',').map(Number);
      const to = map(axis === 'r' ? r : c);
      if (to !== null) rec[axis === 'r' ? `${to},${c}` : `${r},${to}`] = v;
    }
    out.cells = rec;
  }
  return prune(out);
}

/** The tag a part speaks with on one side of a transition. */
export function gridPartTag(g: { morph?: GridMorphTags }, part: GridPart, dir: 'in' | 'out'): string | undefined {
  return g.morph?.[bucketOf(part)]?.[keyOf(part)]?.[dir];
}

/** A copy of the morph tags with one part's `in` / `out` tag set (null clears it). */
export function setGridPartTag(
  m: GridMorphTags | undefined,
  part: GridPart,
  dir: 'in' | 'out',
  tag: string | null,
): GridMorphTags | undefined {
  const b = bucketOf(part);
  const k = keyOf(part);
  const rec = { ...(m?.[b] ?? {}) };
  const next: GridMorphTag = { ...rec[k] };
  if (tag) next[dir] = tag;
  else delete next[dir];
  if (next.in || next.out) rec[k] = next;
  else delete rec[k];
  return prune({ ...m, [b]: rec });
}

/** A copy with every `dir` tag equal to `tag` removed (a stale half of an old pairing). */
export function clearGridTag(m: GridMorphTags | undefined, dir: 'in' | 'out', tag: string): GridMorphTags | undefined {
  if (!m) return undefined;
  const out: GridMorphTags = {};
  for (const b of BUCKETS) {
    if (!m[b]) continue;
    const rec: Record<string, GridMorphTag> = {};
    for (const [k, v] of Object.entries(m[b]!)) {
      const next = { ...v };
      if (next[dir] === tag) delete next[dir];
      if (next.in || next.out) rec[k] = next;
    }
    out[b] = rec;
  }
  return prune(out);
}

export interface GridMorphPairs {
  rows: Array<[number, number]>;
  cols: Array<[number, number]>;
  cells: Array<[[number, number], [number, number]]>;
}

/**
 * Parts of grid `a` (slide before) and `b` (slide after) paired by hand: equal
 * `a.out` / `b.in` tags (`in` / `out` swapped when `reversed`, where `a` is the
 * later slide).
 */
export function gridMorphPairs(
  a: { morph?: GridMorphTags },
  b: { morph?: GridMorphTags },
  reversed = false,
): GridMorphPairs {
  const da = reversed ? 'in' : 'out';
  const db = reversed ? 'out' : 'in';
  const match = (bk: Bucket): Array<[string, string]> => {
    const byTag = new Map<string, string>();
    for (const [k, v] of Object.entries(b.morph?.[bk] ?? {})) if (v[db]) byTag.set(v[db]!, k);
    const out: Array<[string, string]> = [];
    for (const [k, v] of Object.entries(a.morph?.[bk] ?? {})) {
      const j = v[da] ? byTag.get(v[da]!) : undefined;
      if (j !== undefined) out.push([k, j]);
    }
    return out;
  };
  const num = (p: Array<[string, string]>): Array<[number, number]> =>
    p.map(([x, y]) => [Number(x), Number(y)] as [number, number]).sort((x, y) => x[0] - y[0]);
  const cell = (k: string): [number, number] => k.split(',').map(Number) as [number, number];
  return {
    rows: num(match('rows')),
    cols: num(match('cols')),
    cells: match('cells').map(([x, y]) => [cell(x), cell(y)]),
  };
}

/**
 * Hand-made pairings resolved to single cells: paired cells first, then the cells
 * of paired rows (across paired columns, else column by column), then those of
 * paired columns. Each cell is used once, so a cell pairing beats its row's.
 */
export function gridCellPairs(
  a: { morph?: GridMorphTags; rows: number[]; cols: number[] },
  b: { morph?: GridMorphTags; rows: number[]; cols: number[] },
  reversed = false,
): Array<[[number, number], [number, number]]> {
  const p = gridMorphPairs(a, b, reversed);
  const out: Array<[[number, number], [number, number]]> = [];
  const usedA = new Set<string>();
  const usedB = new Set<string>();
  const add = (ra: number, ca: number, rb: number, cb: number): void => {
    if (ra >= a.rows.length || ca >= a.cols.length || rb >= b.rows.length || cb >= b.cols.length) return;
    const ka = `${ra},${ca}`;
    const kb = `${rb},${cb}`;
    if (usedA.has(ka) || usedB.has(kb)) return;
    usedA.add(ka);
    usedB.add(kb);
    out.push([
      [ra, ca],
      [rb, cb],
    ]);
  };
  for (const [[ra, ca], [rb, cb]] of p.cells) add(ra, ca, rb, cb);
  const across = (pairs: Array<[number, number]>, nA: number, nB: number): Array<[number, number]> =>
    pairs.length ? pairs : Array.from({ length: Math.min(nA, nB) }, (_v, i) => [i, i] as [number, number]);
  for (const [ra, rb] of p.rows) {
    for (const [ca, cb] of across(p.cols, a.cols.length, b.cols.length)) add(ra, ca, rb, cb);
  }
  for (const [ca, cb] of p.cols) {
    for (const [ra, rb] of across(p.rows, a.rows.length, b.rows.length)) add(ra, ca, rb, cb);
  }
  return out;
}
