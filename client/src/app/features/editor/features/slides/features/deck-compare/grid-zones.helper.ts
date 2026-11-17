import type { GridPart } from '@devdesigner/shared';

/** Screen px of the strips along a grid's top / left edge that pick a column / row. */
export const GRID_EDGE_PX = 10;

/** Cumulative edges (0..1) of relative weights: n + 1 values. */
export function gridEdges01(weights: readonly number[]): number[] {
   const sum = weights.reduce((x, y) => x + y, 0) || 1;
   const out = [0];
   for (const w of weights) out.push(out[out.length - 1] + w / sum);
   return out;
}

const indexAt = (edges: readonly number[], f: number): number => {
   const n = edges.length - 1;
   for (let i = 0; i < n; i += 1) if (f < edges[i + 1]) return i;
   return n - 1;
};

/**
 * The part of a grid under the pointer, `fx` / `fy` being its position in the grid's
 * box (0..1; outside = the band around the table) and `w` / `h` the box in screen px.
 *
 * Without a `level` (starting a drag) the zone decides: the band outside the table is
 * the whole table (null), a strip along the top edge a column, along the left edge a
 * row, anywhere else a cell (`cellOnly`, e.g. Alt held, skips the strips). With a
 * `level` (the other end of a drag that started on a part) the part of that kind
 * nearest the pointer is picked anywhere over the table.
 */
export function gridZoneAt(
   rows: readonly number[],
   cols: readonly number[],
   fx: number,
   fy: number,
   w: number,
   h: number,
   opts: { level?: GridPart['kind']; cellOnly?: boolean } = {}
): GridPart | null {
   const re = gridEdges01(rows);
   const ce = gridEdges01(cols);
   const cx = Math.min(1, Math.max(0, fx));
   const cy = Math.min(1, Math.max(0, fy));
   const r = indexAt(re, cy);
   const c = indexAt(ce, cx);
   if (opts.level === 'row') return { kind: 'row', i: r };
   if (opts.level === 'col') return { kind: 'col', i: c };
   if (opts.level === 'cell') return { kind: 'cell', r, c };
   if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
   if (!opts.cellOnly) {
      const top = fy * h;
      const left = fx * w;
      // In the corner where both strips meet, the nearer edge wins.
      // A small table keeps most of itself for cells: a strip is at most a fifth of it.
      const edgeY = Math.min(GRID_EDGE_PX, h * 0.2);
      const edgeX = Math.min(GRID_EDGE_PX, w * 0.2);
      if (top < edgeY && top / edgeY <= left / edgeX) return { kind: 'col', i: c };
      if (left < edgeX) return { kind: 'row', i: r };
   }
   return { kind: 'cell', r, c };
}

/** A part's box as fractions (0..1) of the grid's box. */
export function gridPartBox(
   rows: readonly number[],
   cols: readonly number[],
   p: GridPart
): { x: number; y: number; w: number; h: number } {
   const re = gridEdges01(rows);
   const ce = gridEdges01(cols);
   const span = (e: number[], i: number) => ({ a: e[Math.min(i, e.length - 2)], b: e[Math.min(i, e.length - 2) + 1] });
   if (p.kind === 'row') {
      const s = span(re, p.i);
      return { x: 0, y: s.a, w: 1, h: s.b - s.a };
   }
   if (p.kind === 'col') {
      const s = span(ce, p.i);
      return { x: s.a, y: 0, w: s.b - s.a, h: 1 };
   }
   const sr = span(re, p.r);
   const sc = span(ce, p.c);
   return { x: sc.a, y: sr.a, w: sc.b - sc.a, h: sr.b - sr.a };
}

/** "Row 2", "Column B", "Cell B2" (what the drag tip and pairs list call a part). */
export function gridPartLabel(p: GridPart | null): string {
   if (!p) return 'Table';
   const col = (i: number): string => {
      let s = '';
      let n = i + 1;
      while (n > 0) {
         const m = (n - 1) % 26;
         s = String.fromCharCode(65 + m) + s;
         n = Math.floor((n - 1) / 26);
      }
      return s;
   };
   if (p.kind === 'row') return `Row ${p.i + 1}`;
   if (p.kind === 'col') return `Column ${col(p.i)}`;
   return `Cell ${col(p.c)}${p.r + 1}`;
}

export const samePart = (x: GridPart | null | undefined, y: GridPart | null | undefined): boolean =>
   JSON.stringify(x ?? null) === JSON.stringify(y ?? null);

/**
 * The part of grid `to` at the same spot as `p` of grid `from` (same kind; by the
 * part's centre as a fraction of each table).
 */
export function gridMirrorPart(
   from: { rows: readonly number[]; cols: readonly number[] },
   to: { rows: readonly number[]; cols: readonly number[] },
   p: GridPart
): GridPart {
   const b = gridPartBox(from.rows, from.cols, p);
   const at = gridZoneAt(to.rows, to.cols, b.x + b.w / 2, b.y + b.h / 2, 1, 1, { level: p.kind });
   return at ?? p;
}
