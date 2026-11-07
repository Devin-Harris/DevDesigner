/**
 * Line diff for code blocks (git-style): the original `text` on the left, the
 * changed `diffText` on the right. Render-only; never persisted.
 */

export type DiffOp = 'equal' | 'removed' | 'added';

/** One line of a unified (inline) diff, with its index on each side (-1 when absent). */
export interface DiffLine {
  op: DiffOp;
  /** Index into the original lines, or -1 for an added line. */
  a: number;
  /** Index into the changed lines, or -1 for a removed line. */
  b: number;
}

/** One aligned row of a side-by-side diff; a side is -1 where it has no line (filler). */
export interface SplitRow {
  a: number;
  b: number;
  /** equal = same on both sides; change = a replaced/removed/added line. */
  op: 'equal' | 'change';
}

/** Above this many cells the LCS table is skipped and the middle is shown as replaced. */
const MAX_CELLS = 4_000_000;

export function splitLines(text: string): string[] {
  return (text || '').replace(/\r\n?/g, '\n').split('\n');
}

/**
 * Unified line diff of `a` → `b`: removals listed before additions within each change.
 * With `ignoreWhitespace`, lines that differ only in whitespace count as equal (git diff -w).
 */
export function diffLines(
  rawA: readonly string[],
  rawB: readonly string[],
  ignoreWhitespace = false,
): DiffLine[] {
  const key = (l: string): string => (ignoreWhitespace ? l.replace(/\s+/g, '') : l);
  const a = rawA.map(key);
  const b = rawB.map(key);
  // Trim the common prefix/suffix so the LCS table only covers the changed middle.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ op: 'equal', a: i, b: i });

  const n = endA - start;
  const m = endB - start;
  if (n * m > MAX_CELLS) {
    for (let i = start; i < endA; i++) out.push({ op: 'removed', a: i, b: -1 });
    for (let j = start; j < endB; j++) out.push({ op: 'added', a: -1, b: j });
  } else {
    // lcs[i][j] = LCS length of a[start+i..endA) and b[start+j..endB).
    const w = m + 1;
    const lcs = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * w + j] =
          a[start + i] === b[start + j]
            ? lcs[(i + 1) * w + j + 1] + 1
            : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    const flush = (): void => {
      out.push(...removed, ...added);
      removed.length = 0;
      added.length = 0;
    };
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) {
        flush();
        out.push({ op: 'equal', a: start + i, b: start + j });
        i++;
        j++;
      } else if (j < m && (i >= n || lcs[i * w + j + 1] >= lcs[(i + 1) * w + j])) {
        added.push({ op: 'added', a: -1, b: start + j });
        j++;
      } else {
        removed.push({ op: 'removed', a: start + i, b: -1 });
        i++;
      }
    }
    flush();
  }
  for (let k = 0; endA + k < a.length; k++) out.push({ op: 'equal', a: endA + k, b: endB + k });
  return out;
}

/** Side-by-side rows: each change block pairs removals with additions line by line. */
export function splitRows(lines: readonly DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let k = 0;
  while (k < lines.length) {
    if (lines[k].op === 'equal') {
      rows.push({ a: lines[k].a, b: lines[k].b, op: 'equal' });
      k++;
      continue;
    }
    const removed: number[] = [];
    const added: number[] = [];
    while (k < lines.length && lines[k].op !== 'equal') {
      if (lines[k].op === 'removed') removed.push(lines[k].a);
      else added.push(lines[k].b);
      k++;
    }
    for (let r = 0; r < Math.max(removed.length, added.length); r++) {
      rows.push({ a: removed[r] ?? -1, b: added[r] ?? -1, op: 'change' });
    }
  }
  return rows;
}

/**
 * The differing middle of two paired lines (columns, end-exclusive) after trimming
 * their common prefix and suffix; null when either side is unchanged or empty.
 */
export function changedSpan(
  a: string,
  b: string,
  ignoreWhitespace = false,
): { a: [number, number]; b: [number, number] } | null {
  if (a === b) return null;
  const ws = (c: string | undefined): boolean => ignoreWhitespace && c !== undefined && /\s/.test(c);
  // Common prefix (whitespace on either side skipped when ignoring it).
  let i = 0;
  let j = 0;
  for (;;) {
    while (ws(a[i])) i++;
    while (ws(b[j])) j++;
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i++;
      j++;
    } else break;
  }
  // Common suffix, not crossing the prefix.
  let x = a.length;
  let y = b.length;
  for (;;) {
    while (x > i && ws(a[x - 1])) x--;
    while (y > j && ws(b[y - 1])) y--;
    if (x > i && y > j && a[x - 1] === b[y - 1]) {
      x--;
      y--;
    } else break;
  }
  // Nothing but whitespace differs, or nothing in common: no word-level emphasis.
  if (x <= i && y <= j) return null;
  if (i === 0 && j === 0 && x === a.length && y === b.length) return null;
  return { a: [i, x], b: [j, y] };
}
