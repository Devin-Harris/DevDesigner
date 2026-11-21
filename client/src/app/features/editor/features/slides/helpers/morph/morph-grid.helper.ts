import { serializeGrid } from '@devdesigner/shared';
import { gridMorphPairs } from '@devdesigner/shared';
import type { Side } from './morph.model';
import { SVG_NS } from './morph.model';
import type { Pair } from './morph.model';
import type { Offset } from './morph.model';
import type { MorphContext } from './morph.model';
import type { GridMorph } from './morph.model';
import type { CanvasElementModel } from '@devdesigner/shared';
import { type GridData, gridMergeAt, parseGrid } from '@devdesigner/shared';
import { fadeIn, fadeOut, lerp } from './morph-geometry.helper';
import { lcsPairs } from './morph-text.helper';

/** One drawn grid cell: its position in the grid and its text. */
export interface GridCellRef {
   r: number;
   c: number;
   text: string;
}

/** The cells a grid draws, in the order the renderer emits their `<text>` (non-empty merge origins). */
export function gridDrawnCells(text: string | undefined): GridCellRef[] {
   const g = parseGrid(text);
   const out: GridCellRef[] = [];
   g.cells.forEach((row, r) =>
      row.forEach((cell, c) => {
         const m = gridMergeAt(g, r, c);
         if ((m && (m.r !== r || m.c !== c)) || !cell) {
            return;
         }
         out.push({ r, c, text: cell });
      })
   );
   return out;
}

export interface GridBox {
   x: number;
   y: number;
   width: number;
   height: number;
}

/** One live piece of a morphing grid: a table drawn at `box` with `opacity` (0..1). */
export interface GridPiece {
   key: string;
   box: GridBox;
   grid: GridData;
   opacity: number;
}

/** A grid with rows and columns swapped (so column changes can reuse the row logic). */
export function transposeGrid(g: GridData): GridData {
   const styles: GridData['styles'] = {};
   for (const [k, v] of Object.entries(g.styles ?? {})) {
      const [r, c] = k.split(',');
      styles[`${c},${r}`] = v;
   }
   return {
      ...g,
      cols: g.rows,
      rows: g.cols,
      cells: g.cols.map((_v, c) => g.rows.map((_w, r) => g.cells[r]?.[c] ?? '')),
      styles,
      merges: (g.merges ?? []).map((m) => ({ r: m.c, c: m.r, rs: m.cs, cs: m.rs })),
   };
}

/**
 * Two grids with the same columns but a different number of rows, at progress `t`.
 * Rows are paired by content (then in order inside the gaps): paired rows glide to
 * their new height, unpaired rows inside the table collapse / open while fading,
 * and unpaired rows at the top or bottom just fade where they are. Cell text is
 * left blank (the grid text layer draws it).
 */
export function blendGridRows(
   ga: GridData,
   gb: GridData,
   boxA: GridBox,
   boxB: GridBox,
   t: number,
   /** Rows paired by hand (a, b): they anchor the pairing instead of content. */
   forced: ReadonlyArray<[number, number]> = []
): GridPiece[] {
   const sig = (g: GridData, r: number): string => (g.cells[r] ?? []).join('\u0001');
   const entries: Array<{ a?: number; b?: number }> = [];
   let i = 0;
   let j = 0;
   const gap = (ie: number, je: number): void => {
      while (i < ie && j < je) {
         entries.push({ a: i++, b: j++ });
      }
      while (i < ie) {
         entries.push({ a: i++ });
      }
      while (j < je) {
         entries.push({ b: j++ });
      }
   };
   // Rows pair by position unless their content clearly shows rows were inserted or
   // removed (more rows line up by content than by position). Empty rows never count.
   const sa = ga.rows.map((_v, r) =>
      sig(ga, r)
         // eslint-disable-next-line no-control-regex -- U+0001 is the row separator sig() inserts
         .replace(/\u0001/g, '')
         .trim()
         ? sig(ga, r)
         : `\u0000a${r}`
   );
   const sb = gb.rows.map((_v, r) =>
      sig(gb, r)
         // eslint-disable-next-line no-control-regex -- U+0001 is the row separator sig() inserts
         .replace(/\u0001/g, '')
         .trim()
         ? sig(gb, r)
         : `\u0000b${r}`
   );
   const byContent = lcsPairs(sa, sb);
   let byIndex = 0;
   for (let k = 0; k < Math.min(sa.length, sb.length); k += 1) {
      if (sa[k] === sb[k]) {
         byIndex += 1;
      }
   }
   // Rows paired by hand win; kept in order (a pairing that crosses another is ignored).
   const anchors: Array<[number, number]> = [];
   for (const [pi, pj] of [...forced].sort((x, y) => x[0] - y[0])) {
      const prev = anchors[anchors.length - 1];
      if (pi < ga.rows.length && pj < gb.rows.length && (!prev || (pi > prev[0] && pj > prev[1]))) {
         anchors.push([pi, pj]);
      }
   }
   for (const [pi, pj] of anchors.length ? anchors : byContent.length > byIndex ? byContent : []) {
      gap(pi, pj);
      entries.push({ a: pi, b: pj });
      i = pi + 1;
      j = pj + 1;
   }
   gap(ga.rows.length, gb.rows.length);

   const ha = fractions(ga.rows).map((f) => f * boxA.height);
   const hb = fractions(gb.rows).map((f) => f * boxB.height);
   const first = entries.findIndex((e) => e.a !== undefined && e.b !== undefined);
   let last = first;
   entries.forEach((e, k) => {
      if (e.a !== undefined && e.b !== undefined) {
         last = k;
      }
   });
   const fa = fractions(ga.cols);
   const fb = fractions(gb.cols);
   const cols = fa.map((v, k) => lerp(v, fb[k] ?? v, t) * 1000);
   const x = lerp(boxA.x, boxB.x, t);
   const width = lerp(boxA.width, boxB.width, t);
   const pickA = t < 0.5;
   const styleOf = (g: GridData, src: number | undefined, k: number, out: NonNullable<GridData['styles']>) => {
      if (src === undefined) {
         return;
      }
      g.cols.forEach((_v, c) => {
         const st = g.styles?.[`${src},${c}`];
         if (st) {
            out[`${k},${c}`] = st;
         }
      });
   };
   const grid = (rows: number[], styles: NonNullable<GridData['styles']>): GridData => ({
      cols,
      rows,
      cells: rows.map(() => cols.map(() => '')),
      header: false,
      styles,
      merges: [],
   });

   // The paired span (with any rows that come and go inside it) is one table.
   const span = entries.slice(first, last + 1);
   const mainStyles: NonNullable<GridData['styles']> = {};
   const rows = span.map((e, k) => {
      styleOf(pickA ? ga : gb, pickA ? (e.a ?? undefined) : (e.b ?? undefined), k, mainStyles);
      if (e.a !== undefined && e.b !== undefined) {
         return lerp(ha[e.a], hb[e.b], t);
      }
      return e.a !== undefined ? ha[e.a] * (1 - t) : hb[e.b!] * t;
   });
   const sum = (xs: number[]): number => xs.reduce((p, q) => p + q, 0);
   const leadA = entries.slice(0, first).flatMap((e) => (e.a !== undefined ? [e.a] : []));
   const leadB = entries.slice(0, first).flatMap((e) => (e.b !== undefined ? [e.b] : []));
   const tailA = entries.slice(last + 1).flatMap((e) => (e.a !== undefined ? [e.a] : []));
   const tailB = entries.slice(last + 1).flatMap((e) => (e.b !== undefined ? [e.b] : []));
   const top = lerp(boxA.y + sum(leadA.map((r) => ha[r])), boxB.y + sum(leadB.map((r) => hb[r])), t);
   const height = Math.max(1, sum(rows));
   const out: GridPiece[] = [
      {
         key: '',
         box: { x, y: top, width, height },
         grid: grid(
            rows.map((h) => Math.max(h, 0.001)),
            mainStyles
         ),
         opacity: 1,
      },
   ];

   // Rows above / below the paired span fade where they are, as blocks of their own
   // (a whole faded copy of either table over the span doubled every grid line).
   const whole = (key: string, g: GridData, lead: number[], tail: number[], h: number[], opacity: number): void => {
      const block = (k: string, list: number[], y: number): void => {
         if (!list.length) {
            return;
         }
         const styles: NonNullable<GridData['styles']> = {};
         const rs = list.map((r, n) => {
            styleOf(g, r, n, styles);
            return Math.max(h[r], 0.001);
         });
         out.push({ key: `${key}${k}`, box: { x, y, width, height: sum(rs) }, grid: grid(rs, styles), opacity });
      };
      block('t', lead, top - sum(lead.map((r) => h[r])));
      block('b', tail, top + height);
   };
   whole('~a', ga, leadA, tailA, ha, fadeOut(t));
   whole('~b', gb, leadB, tailB, hb, fadeIn(t));
   return out;
}

/**
 * Which row of grid `b` each row of grid `a` became (`a` index -> `b` index), for
 * matching cell text: rows paired by hand first, then the rows sharing the most
 * cell texts (a row whose numbers changed still shares its label), then rows left
 * at the same position. Columns: pass transposed grids.
 */
export function gridLineMap(
   ga: GridData,
   gb: GridData,
   forced: ReadonlyArray<[number, number]> = []
): Map<number, number> {
   const na = ga.rows.length;
   const nb = gb.rows.length;
   const out = new Map<number, number>();
   const usedB = new Set<number>();
   const take = (i: number, j: number): void => {
      if (i < na && j < nb && !out.has(i) && !usedB.has(j)) {
         out.set(i, j);
         usedB.add(j);
      }
   };
   forced.forEach(([i, j]) => take(i, j));
   // Shared text in order, wherever it sits along the line (a column added in front
   // shifts every cell, but the row still reads the same).
   const words = (g: GridData, r: number): string[] => (g.cells[r] ?? []).map((x) => x.trim()).filter(Boolean);
   const pos = (i: number, n: number): number => (i + 0.5) / n;
   const scores: Array<[number, number, number]> = [];
   ga.rows.forEach((_v, i) =>
      gb.rows.forEach((_w, j) => {
         const n = lcsPairs(words(ga, i), words(gb, j)).length;
         if (n) {
            scores.push([n, i, j]);
         }
      })
   );
   // Most shared text first; ties go to the line nearest its old place.
   scores.sort(
      (x, y) => y[0] - x[0] || Math.abs(pos(x[1], na) - pos(x[2], nb)) - Math.abs(pos(y[1], na) - pos(y[2], nb))
   );
   scores.forEach(([, i, j]) => take(i, j));
   // The rest: the nearest free line that keeps the order of those already placed.
   for (let i = 0; i < na; i += 1) {
      if (out.has(i)) {
         continue;
      }
      let lo = -1;
      let hi = nb;
      out.forEach((j, k) => {
         if (k < i) lo = Math.max(lo, j);
         if (k > i) hi = Math.min(hi, j);
      });
      let best = -1;
      for (let j = lo + 1; j < hi; j += 1) {
         if (!usedB.has(j) && (best < 0 || Math.abs(pos(j, nb) - pos(i, na)) < Math.abs(pos(best, nb) - pos(i, na)))) {
            best = j;
         }
      }
      if (best >= 0) {
         take(i, best);
      }
   }
   return out;
}

/** A line map's pairs that keep their order (a row that jumped past others is left out). */
export function inOrder(map: Map<number, number>): Array<[number, number]> {
   const out: Array<[number, number]> = [];
   for (const [i, j] of [...map.entries()].sort((x, y) => x[0] - y[0])) {
      if (!out.length || j > out[out.length - 1][1]) {
         out.push([i, j]);
      }
   }
   return out;
}

/**
 * Row heights (or column widths) of a morphing grid at progress `t`, as weights:
 * paired lines resize into each other, the rest shrink to / grow from nothing in
 * place, so every border glides. `src` says which line of each side each one is.
 */
export function blendGridAxis(
   wa: readonly number[],
   wb: readonly number[],
   pairs: ReadonlyArray<[number, number]>,
   t: number
): { sizes: number[]; src: Array<{ a?: number; b?: number }> } {
   const fa = fractions(wa);
   const fb = fractions(wb);
   const src: Array<{ a?: number; b?: number }> = [];
   let i = 0;
   let j = 0;
   for (const [pi, pj] of [...pairs, [wa.length, wb.length] as [number, number]]) {
      while (i < pi) {
         src.push({ a: i++ });
      }
      while (j < pj) {
         src.push({ b: j++ });
      }
      if (pi < wa.length && pj < wb.length) {
         src.push({ a: pi, b: pj });
         i = pi + 1;
         j = pj + 1;
      }
   }
   const sizes = src.map((e) => {
      const v =
         e.a !== undefined && e.b !== undefined
            ? lerp(fa[e.a], fb[e.b], t)
            : e.a !== undefined
              ? fa[e.a] * (1 - t)
              : fb[e.b!] * t;
      // Weights are stored with two decimals: keep even a vanished line positive.
      return Math.max(v * 1000, 0.01);
   });
   return { sizes, src };
}

/** Relative weights as fractions of their sum. */
export function fractions(w: readonly number[]): number[] {
   const sum = w.reduce((x, y) => x + y, 0) || 1;
   return w.map((x) => x / sum);
}

export function buildGridMorph(
   ctx: MorphContext,
   p: Pair,
   a: Side,
   b: Side,
   shell: (side: Side) => SVGGElement
): GridMorph | null {
   const ga = a.items.get(p.a.id);
   const gb = b.items.get(p.b.id);
   if (!ga || !gb) {
      return null;
   }
   const ta = Array.from(ga.querySelectorAll('text')) as unknown as SVGTextElement[];
   const tb = Array.from(gb.querySelectorAll('text')) as unknown as SVGTextElement[];
   const ca = gridDrawnCells(p.a.element!.text);
   const cb = gridDrawnCells(p.b.element!.text);
   if (ta.length !== ca.length || tb.length !== cb.length) {
      return null; // not the layout we expect: the plain live grid snaps its text halfway
   }
   const da = parseGrid(p.a.element!.text);
   const db = parseGrid(p.b.element!.text);

   const clipId = `dd-morph-clip-${ctx.nextClipId()}`;
   const clipPath = document.createElementNS(SVG_NS, 'clipPath');
   clipPath.setAttribute('id', clipId);
   const clip = document.createElementNS(SVG_NS, 'rect') as SVGRectElement;
   clipPath.appendChild(clip);
   ctx.svg.querySelector('defs')?.appendChild(clipPath);
   const layer = document.createElementNS(SVG_NS, 'g') as SVGGElement;
   layer.setAttribute('clip-path', `url(#${clipId})`);
   ctx.svg.appendChild(layer);

   const out: GridMorph = {
      pair: p,
      layer,
      clip,
      sameShape: da.rows.length === db.rows.length && da.cols.length === db.cols.length,
      rowPairs: [],
      colPairs: [],
      moves: [],
      fadeOut: [],
      fadeIn: [],
      changed: [],
   };
   const place = (side: Side, t: SVGTextElement): SVGGElement => {
      const holder = shell(side);
      holder.appendChild(t.cloneNode(true));
      const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
      g.appendChild(holder);
      layer.appendChild(g);
      return g;
   };
   const anchor = (t: SVGTextElement): { x: number; y: number } => {
      const first = t.querySelector('tspan');
      return {
         x: Number(first?.getAttribute('x')) || 0,
         y: Number(first?.getAttribute('y')) || 0,
      };
   };

   // 0. Cells paired by hand: the same text glides there, different text morphs glyph
   // by glyph. (Rows / columns paired by hand only steer where lines go, below: a cell
   // in them still prefers the same text nearby over morphing into other words.)
   const pairs: Array<[number, number]> = [];
   const inPlace: Array<[number, number]> = [];
   const usedA = new Set<number>();
   const usedB = new Set<number>();
   const at = (cells: GridCellRef[], r: number, c: number): number => cells.findIndex((x) => x.r === r && x.c === c);
   for (const [[ra, cA], [rb, cB]] of gridMorphPairs(da, db, ctx.reversed).cells) {
      const i = at(ca, ra, cA);
      const j = at(cb, rb, cB);
      if (i < 0 || j < 0) {
         continue;
      }
      usedA.add(i);
      usedB.add(j);
      (ca[i].text === cb[j].text ? pairs : inPlace).push([i, j]);
   }
   // Where each row / column went: hand pairs, then shared text, else nearby.
   const hand = gridMorphPairs(da, db, ctx.reversed);
   const rowTo = gridLineMap(da, db, hand.rows);
   const colTo = gridLineMap(transposeGrid(da), transposeGrid(db), hand.cols);
   out.rowPairs = inOrder(rowTo);
   out.colPairs = inOrder(colTo);
   const take = (i: number, j: number, list: Array<[number, number]>): void => {
      usedA.add(i);
      usedB.add(j);
      list.push([i, j]);
   };
   const mapped = (x: GridCellRef): number =>
      cb.findIndex((y, k) => !usedB.has(k) && y.r === rowTo.get(x.r) && y.c === colTo.get(x.c));
   // 1. Text that is still in its row / column's new cell glides there.
   ca.forEach((x, i) => {
      const j = usedA.has(i) ? -1 : mapped(x);
      if (j >= 0 && cb[j].text === x.text) {
         take(i, j, pairs);
      }
   });
   // 2. Other text that is still on the table glides to the nearest cell with the
   // same text (positions as fractions of each table, so a grown table still lines up).
   const centers = (g: GridData) => {
      const mid = (w: number[]) => {
         const f = fractions(w);
         let acc = 0;
         return f.map((v) => ((acc += v), acc - v / 2));
      };
      return { r: mid(g.rows), c: mid(g.cols) };
   };
   const pa0 = centers(da);
   const pb0 = centers(db);
   const near: Array<[number, number, number]> = [];
   ca.forEach((x, i) =>
      cb.forEach((y, j) => {
         if (!usedA.has(i) && !usedB.has(j) && x.text === y.text) {
            near.push([Math.hypot(pa0.r[x.r] - pb0.r[y.r], pa0.c[x.c] - pb0.c[y.c]), i, j]);
         }
      })
   );
   near.sort((x, y) => x[0] - y[0]);
   for (const [, i, j] of near) {
      if (!usedA.has(i) && !usedB.has(j)) {
         take(i, j, pairs);
      }
   }
   // 3. A cell whose text changed morphs into its row / column's new cell.
   ca.forEach((x, i) => {
      const j = usedA.has(i) ? -1 : mapped(x);
      if (j >= 0) {
         take(i, j, inPlace);
      }
   });
   for (const [i, j] of pairs) {
      const g = place(b, tb[j]);
      const pa = anchor(ta[i]);
      const pb = anchor(tb[j]);
      out.moves.push({
         el: g,
         dx: pa.x - ctx.offA.x - (pb.x - ctx.offB.x),
         dy: pa.y - ctx.offA.y - (pb.y - ctx.offB.y),
      });
   }
   for (const [i, j] of inPlace) {
      const ea = place(a, ta[i]);
      const eb = place(b, tb[j]);
      out.fadeOut.push(ea);
      out.fadeIn.push(eb);
      out.changed.push({ a: ea, b: eb });
   }
   // 4. Everything else fades out / in where it is.
   ta.forEach((t, i) => {
      if (!usedA.has(i)) {
         out.fadeOut.push(place(a, t));
      }
   });
   tb.forEach((t, j) => {
      if (!usedB.has(j)) {
         out.fadeIn.push(place(b, t));
      }
   });
   return out;
}
/**
 * The live grid table(s) of a pair at progress `t`, without cell text (the grid
 * layer animates it): one table with interpolated rows/columns when both slides
 * have the same shape, else both layouts cross-faded on the blended frame.
 */
export function blendGrid(
   ctx: MorphContext,
   gm: GridMorph,
   blended: CanvasElementModel,
   t: number
): CanvasElementModel[] {
   const ea = gm.pair.a.element!;
   const eb = gm.pair.b.element!;
   const blank = (text: string | undefined) => {
      const g = parseGrid(text);
      return { ...g, cells: g.cells.map((row) => row.map(() => '')) };
   };
   if (!parseGrid(ea.text).merges?.length && !parseGrid(eb.text).merges?.length) {
      // One live table: every row / column border glides to where it ends up; rows
      // and columns that come or go grow from / shrink to nothing.
      const ga = parseGrid(ea.text);
      const gb = parseGrid(eb.text);
      const rows = blendGridAxis(ga.rows, gb.rows, gm.rowPairs, t);
      const cols = blendGridAxis(ga.cols, gb.cols, gm.colPairs, t);
      const useA = t < 0.5;
      const styles: NonNullable<GridData['styles']> = {};
      rows.src.forEach((re, r) =>
         cols.src.forEach((ce, c) => {
            const side = (useA && re.a !== undefined && ce.a !== undefined) || re.b === undefined || ce.b === undefined;
            const st = side ? ga.styles?.[`${re.a},${ce.a}`] : gb.styles?.[`${re.b},${ce.b}`];
            if (st) {
               styles[`${r},${c}`] = st;
            }
         })
      );
      const pick = useA ? ga : gb;
      const top = rows.src[0];
      return [
         {
            ...blended,
            text: serializeGrid({
               cols: cols.sizes,
               rows: rows.sizes,
               cells: rows.sizes.map(() => cols.sizes.map(() => '')),
               header: pick.header && (useA ? top?.a : top?.b) === 0,
               styles,
               merges: [],
               ...(pick.borders ? { borders: pick.borders } : {}),
            }),
         },
      ];
   }
   if (gm.sameShape) {
      const ga = parseGrid(ea.text);
      const gb = parseGrid(eb.text);
      const mix = (x: number[], y: number[]): number[] => {
         const fy = fractions(y);
         return fractions(x).map((v, i) => lerp(v, fy[i], t) * 1000);
      };
      const g = blank(t < 0.5 ? ea.text : eb.text);
      return [{ ...blended, text: serializeGrid({ ...g, cols: mix(ga.cols, gb.cols), rows: mix(ga.rows, gb.rows) }) }];
   }
   const ga = parseGrid(ea.text);
   const gb = parseGrid(eb.text);
   const rowsDiffer = ga.rows.length !== gb.rows.length;
   const colsDiffer = ga.cols.length !== gb.cols.length;
   if (rowsDiffer !== colsDiffer && !ga.merges?.length && !gb.merges?.length) {
      // Only rows (or only columns) changed: shared ones glide, the extra ones fade.
      const flip = colsDiffer;
      const boxOf = (e: CanvasElementModel, off: Offset): GridBox =>
         flip
            ? { x: e.y - off.y, y: e.x - off.x, width: e.height, height: e.width }
            : { x: e.x - off.x, y: e.y - off.y, width: e.width, height: e.height };
      const hand = gridMorphPairs(ga, gb, ctx.reversed);
      const pieces = blendGridRows(
         flip ? transposeGrid(ga) : ga,
         flip ? transposeGrid(gb) : gb,
         boxOf(ea, ctx.offA),
         boxOf(eb, ctx.offB),
         t,
         flip ? hand.cols : hand.rows
      );
      return pieces.map((pc) => {
         const box = flip ? { x: pc.box.y, y: pc.box.x, width: pc.box.height, height: pc.box.width } : pc.box;
         return {
            ...blended,
            id: `${blended.id}${pc.key}`,
            ...box,
            angle: 0,
            text: serializeGrid(flip ? transposeGrid(pc.grid) : pc.grid),
            opacity: blended.opacity * pc.opacity,
         };
      });
   }
   // Cross-fade without washing out: B sits underneath fully opaque, A fades out on
   // top of it (its opaque card hides B at first), and B's lines are redrawn on top so
   // they never sit under a half-transparent card. Stacking two half-transparent
   // cards dimmed every line and cell fill mid-morph, which then popped back.
   const linesOnly = (text: string | undefined) => {
      const g = blank(text);
      const styles = Object.fromEntries(
         Object.entries(g.styles ?? {}).map(([k, st]) => [k, { ...st, fill: undefined }])
      );
      return serializeGrid({ ...g, header: false, styles });
   };
   return [
      { ...blended, id: `${blended.id}~b`, text: serializeGrid(blank(eb.text)), opacity: eb.opacity },
      { ...blended, text: serializeGrid(blank(ea.text)), opacity: ea.opacity * (1 - t) },
      {
         ...blended,
         id: `${blended.id}~bl`,
         backgroundColor: 'transparent',
         text: linesOnly(eb.text),
         opacity: eb.opacity * t,
      },
   ];
}
