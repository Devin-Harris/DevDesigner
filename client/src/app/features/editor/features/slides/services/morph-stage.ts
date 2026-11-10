import {
   gridMergeAt,
   isSwatchColor,
   matchDiagrams,
   matchLifelines,
   matchMessages,
   matchMorphItems,
   parseGrid,
   serializeGrid,
   type CanvasElementModel,
   type GridData,
   type LifelineModel,
   type MorphBy,
   type PointModel,
   type RelationshipModel,
   type SequenceDiagramModel,
   type SequenceMessageModel,
   type TableModel,
} from '@devdesigner/shared';
import { buildDiagramSvg, sequenceBounds, type SequenceBox } from '../../../helpers/diagram-svg.helper';
import { safeSvgFragment, sanitizeSvgDom } from '../helpers/svg-sanitize.helper';
import { codeDiffActive } from '../../../helpers/render';
import type { RenderedSlide, SlideItem } from './slide-render.service';

const SVG_NS = 'http://www.w3.org/2000/svg';
const GRID_ID = 'dd-export-grid';

/** Longest text (in characters) that is morphed glyph by glyph; longer just cross-fades. */
const MAX_CHAR_MORPH = 360;

/** A slide's SVG, taken apart into the pieces a morph animates. */
interface Side {
   root: SVGSVGElement;
   /** The world -> slide-local `<g transform>` holding all content. */
   main: SVGGElement;
   items: Map<string, SVGGElement>;
   /** Content that isn't a tagged table/element (connectors, sequence diagrams). */
   rest: Element[];
}

function parse(slide: RenderedSlide, gridId: string): Side {
   const text = gridId === GRID_ID ? slide.svg : slide.svg.split(GRID_ID).join(gridId);
   const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
   sanitizeSvgDom(doc.documentElement);
   const root = doc.documentElement as unknown as SVGSVGElement;
   const main = root.querySelector(':scope > g') as SVGGElement | null;
   const items = new Map<string, SVGGElement>();
   const rest: Element[] = [];
   if (main) {
      for (const child of Array.from(main.children)) {
         const id = child.getAttribute('data-eid') ?? child.getAttribute('data-tid');
         if (id && child instanceof SVGGElement) {
            items.set(id, child);
         } else {
            rest.push(child);
         }
      }
   }
   return {
      root,
      main: main ?? (doc.createElementNS(SVG_NS, 'g') as SVGGElement),
      items,
      rest,
   };
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Interpolate angles the short way round. */
function lerpAngle(a: number, b: number, t: number): number {
   const delta = ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
   return a + delta * t;
}

/** Fade in over the first half so a still-opaque twin never dips in brightness. */
const fadeIn = (t: number): number => Math.min(1, t * 2);
/** Fade out over the second half (the incoming twin is already opaque by then). */
const fadeOut = (t: number): number => 1 - Math.max(0, t * 2 - 1);

function parseColor(c: string): [number, number, number] | null {
   const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
   if (hex) {
      const h = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join('') : hex[1];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
   }
   const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(c.trim());
   return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

function mixColor(a: string, b: string, t: number): string {
   const ca = parseColor(a);
   const cb = parseColor(b);
   if (!ca || !cb) {
      return t < 0.5 ? a : b;
   }
   // Hex, not rgb(): the contrast helpers (contrastText, readableTextOn, isSwatchColor)
   // only parse hex, and an unparsed blend made text fall back to the theme color mid-morph.
   const hex = ca.map((v, i) =>
      Math.max(0, Math.min(255, Math.round(lerp(v, cb[i], t))))
         .toString(16)
         .padStart(2, '0')
   );
   return `#${hex.join('')}`;
}

function mixOptionalColor(a: string | undefined, b: string | undefined, t: number): string | undefined {
   if (a && b) {
      return mixColor(a, b, t);
   }
   return t < 0.5 ? a : b;
}

/** A header color that takes the theme text: unset or a stock swatch. */
const isStockHeader = (c: string | undefined): boolean => !c || isSwatchColor(c);

type Offset = { x: number; y: number };

/** The element at progress `t` between its two slide versions (slide-local coordinates). */
function blendElement(
   a: CanvasElementModel,
   b: CanvasElementModel,
   t: number,
   offA: Offset,
   offB: Offset
): CanvasElementModel {
   const pick = t < 0.5 ? a : b;
   const num = (x: number | undefined, y: number | undefined): number | undefined =>
      x !== undefined && y !== undefined ? lerp(x, y, t) : (y ?? x);
   let points: PointModel[] | undefined = pick.points;
   if (a.points && b.points && a.points.length === b.points.length) {
      points = a.points.map((p, i) => ({
         x: lerp(p.x, b.points![i].x, t),
         y: lerp(p.y, b.points![i].y, t),
      }));
   }
   return {
      ...pick,
      id: b.id,
      startBinding: b.startBinding,
      endBinding: b.endBinding,
      x: lerp(a.x - offA.x, b.x - offB.x, t),
      y: lerp(a.y - offA.y, b.y - offB.y, t),
      width: lerp(a.width, b.width, t),
      height: lerp(a.height, b.height, t),
      angle: lerpAngle(a.angle ?? 0, b.angle ?? 0, t),
      strokeColor: mixColor(a.strokeColor, b.strokeColor, t),
      backgroundColor: mixOptionalColor(a.backgroundColor, b.backgroundColor, t),
      strokeWidth: lerp(a.strokeWidth, b.strokeWidth, t),
      opacity: lerp(a.opacity, b.opacity, t),
      cornerRadius: num(a.cornerRadius, b.cornerRadius),
      fontSize: num(a.fontSize, b.fontSize),
      curvature: num(a.curvature, b.curvature),
      points,
   };
}

/**
 * Two paired sequence diagrams and how their parts pair up: participants (by tag,
 * then name) and messages (by tag, then wording and endpoints).
 */
interface SeqPair {
   a: SequenceDiagramModel;
   b: SequenceDiagramModel;
   llA: LifelineModel[];
   llB: LifelineModel[];
   msA: SequenceMessageModel[];
   msB: SequenceMessageModel[];
   lifelines: Array<[LifelineModel, LifelineModel]>;
   messages: Array<[SequenceMessageModel, SequenceMessageModel]>;
}

/** A piece of sequence text (title, participant label, message label) animated glyph by glyph. */
interface SeqTextJob {
   kind: 'title' | 'lifeline' | 'message';
   pair: SeqPair;
   /** Ids of the text on slide A / slide B (data-seq-title / data-lid / data-mid). */
   aId: string;
   bId: string;
}

interface Glyph {
   ch: string;
   x: number;
   y: number;
   size: number;
   fill: string;
   family: string;
   weight: string;
   italic: boolean;
   underline: boolean;
   /** Rich-text style signature (weight, italic, underline, color): equal = same run. */
   style: string;
   /** Index of the word (run of non-space characters) this glyph belongs to. */
   w: number;
   /** Morph tag of the run this glyph is in ('' = untagged): tagged glyphs pair only by tag. */
   tag: string;
}

/**
 * One animated character: moves from `a` to `b`, or fades out (b null) / in (a null).
 * (dx, dy) is how far its text block moves overall: a character with no partner rides
 * along with it, so it stays with its object instead of being left behind.
 */
interface CharMove {
   el: SVGTextElement;
   a: Glyph | null;
   b: Glyph | null;
   dx: number;
   dy: number;
}

interface SpanStyle {
   weight: string;
   italic: boolean;
   underline: boolean;
   fill: string;
   line: Element | null;
   morph: string;
}

/** The rich-text style in effect at `node` (innermost tspan attribute wins). */
function spanStyle(node: Node, text: SVGTextElement): SpanStyle {
   const attr = (name: string): string | null => {
      for (let el = node.parentNode as Element | null; el; el = el.parentNode as Element | null) {
         const v = el.getAttribute(name);
         if (v !== null) {
            return v;
         }
         if (el === text) {
            break;
         }
      }
      return null;
   };
   let line: Element | null = null;
   for (let el = node.parentNode as Element | null; el && el !== text; el = el.parentNode as Element | null) {
      if (el.hasAttribute('x')) {
         line = el;
         break;
      }
   }
   return {
      weight: attr('font-weight') ?? 'normal',
      italic: attr('font-style') === 'italic',
      underline: (attr('text-decoration') ?? '').includes('underline'),
      fill: attr('fill') ?? '#000',
      line,
      morph: attr('data-morph') ?? '',
   };
}

/** Non-space characters of an on-screen <text>, with where each one actually sits. */
function readGlyphs(text: SVGTextElement, off: Offset): Glyph[] | null {
   const content = text.textContent ?? '';
   const n = text.getNumberOfChars();
   if (n === 0 || n !== content.length) {
      return null;
   }
   const size = Number(text.getAttribute('font-size')) || 16;
   // The computed family, per run: the attribute may be missing (CSS / a theme font)
   // or overridden on a tspan, and falling back would swap the typeface mid-morph.
   const families: string[] = [];
   const styles: SpanStyle[] = [];
   const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
   for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const st = spanStyle(node, text);
      const fam =
         getComputedStyle(node.parentElement ?? text).fontFamily || text.getAttribute('font-family') || 'sans-serif';
      for (let k = 0; k < (node.nodeValue?.length ?? 0); k += 1) {
         styles.push(st);
         families.push(fam);
      }
   }
   if (styles.length !== n) {
      return null;
   }
   const out: Glyph[] = [];
   let word = 0;
   let inWord = false;
   for (let i = 0; i < n; i += 1) {
      const ch = content[i];
      const st = styles[i];
      // A line break ends a word even though no space character separates the lines.
      if (inWord && i > 0 && st.line !== styles[i - 1].line) {
         word += 1;
         inWord = false;
      }
      if (/\s/.test(ch)) {
         if (inWord) {
            word += 1;
            inWord = false;
         }
         continue;
      }
      inWord = true;
      const p = text.getStartPositionOfChar(i);
      out.push({
         ch,
         x: p.x - off.x,
         y: p.y - off.y,
         size,
         fill: st.fill,
         family: families[i],
         weight: st.weight,
         italic: st.italic,
         underline: st.underline,
         style: `${st.weight}|${st.italic ? 'i' : ''}|${st.underline ? 'u' : ''}|${st.fill}|${st.morph}`,
         w: word,
         tag: st.morph,
      });
   }
   return out;
}

/**
 * Pair the glyphs of two texts, preferring rich-text structure over single letters.
 *
 * 1. Style runs (consecutive characters with the same weight / italic / underline /
 *    color) are paired first: identical runs (same style + text), then the same
 *    words in a different style (a restyle), then runs that merely share a style.
 *    Each level only pairs runs left over between pairs of the previous level, so
 *    a bold run never trades letters with a plain one.
 * 2. Inside a paired run, words that appear in both (in order) keep their letters
 *    together and glide as a unit.
 * 3. Only the words left over in between are matched letter by letter, and only
 *    within the same gap, so a letter never jumps into an unrelated word.
 */
function matchGlyphs(ga: readonly Glyph[], gb: readonly Glyph[], by: MorphBy): Array<[number, number]> {
   const out: Array<[number, number]> = [];
   // Tagged words pair only with the same tag (an explicit "these are the same"), and
   // untagged characters never trade with them. Inside a tagged run letters glide too.
   const tags = new Set(ga.map((g) => g.tag).filter((t) => t !== ''));
   for (const tag of tags) {
      const ia = ga.flatMap((g, i) => (g.tag === tag ? [i] : []));
      const ib = gb.flatMap((g, j) => (g.tag === tag ? [j] : []));
      if (ib.length) {
         matchWords(ga, gb, ia, ib, out, true);
      }
   }
   // "By object": the rest of the text moves as one piece and cross-fades.
   if (by !== 'object') {
      const ua = ga.flatMap((g, i) => (g.tag === '' ? [i] : []));
      const ub = gb.flatMap((g, j) => (g.tag === '' ? [j] : []));
      for (const [i, j] of matchUntaggedGlyphs(
         ua.map((i) => ga[i]),
         ub.map((j) => gb[j]),
         by === 'character'
      )) {
         out.push([ua[i], ub[j]]);
      }
   }
   return out;
}

/** Style-run, then word, then (optionally) letter pairing of two untagged glyph lists. */
function matchUntaggedGlyphs(ga: readonly Glyph[], gb: readonly Glyph[], letters: boolean): Array<[number, number]> {
   const runsOf = (g: readonly Glyph[]): number[][] => {
      const runs: number[][] = [];
      g.forEach((x, i) => {
         const last = runs[runs.length - 1];
         if (last && g[last[0]].style === x.style) {
            last.push(i);
         } else {
            runs.push([i]);
         }
      });
      return runs;
   };
   const textOf = (g: readonly Glyph[], run: number[]): string => run.map((i) => g[i].ch).join('');
   const ra = runsOf(ga);
   const rb = runsOf(gb);
   const levels: Array<(g: readonly Glyph[], run: number[]) => string> = [
      (g, run) => `${g[run[0]].style}\u0000${textOf(g, run)}`,
      (g, run) => textOf(g, run),
      (g, run) => g[run[0]].style,
   ];
   const runPairs: Array<[number, number]> = [];
   const solve = (ia: number[], ib: number[], level: number): void => {
      if (!ia.length || !ib.length || level >= levels.length) {
         return;
      }
      const key = levels[level];
      const m = lcsPairs(
         ia.map((i) => key(ga, ra[i])),
         ib.map((j) => key(gb, rb[j]))
      );
      let pa = 0;
      let pb = 0;
      for (const [i, j] of m) {
         solve(ia.slice(pa, i), ib.slice(pb, j), level + 1);
         runPairs.push([ia[i], ib[j]]);
         pa = i + 1;
         pb = j + 1;
      }
      solve(ia.slice(pa), ib.slice(pb), level + 1);
   };
   solve(
      ra.map((_r, i) => i),
      rb.map((_r, i) => i),
      0
   );

   const out: Array<[number, number]> = [];
   for (const [i, j] of runPairs) {
      matchWords(ga, gb, ra[i], rb[j], out, letters);
   }
   return out;
}

/** Word-then-letter pairing of two glyph index lists (one style run each). */
function matchWords(
   ga: readonly Glyph[],
   gb: readonly Glyph[],
   idxA: readonly number[],
   idxB: readonly number[],
   out: Array<[number, number]>,
   letters = true
): void {
   const group = (g: readonly Glyph[], idx: readonly number[]): number[][] => {
      const words = new Map<number, number[]>();
      for (const i of idx) {
         const list = words.get(g[i].w);
         if (list) {
            list.push(i);
         } else {
            words.set(g[i].w, [i]);
         }
      }
      return Array.from(words.values());
   };
   const wa = group(ga, idxA);
   const wb = group(gb, idxB);
   const text = (g: readonly Glyph[], idx: number[]): string => idx.map((i) => g[i].ch).join('');
   const wordPairs = lcsPairs(
      wa.map((w) => text(ga, w)),
      wb.map((w) => text(gb, w))
   );
   const gap = (fromA: number, toA: number, fromB: number, toB: number): void => {
      if (!letters) {
         return;
      }
      const ia = wa.slice(fromA, toA).flat();
      const ib = wb.slice(fromB, toB).flat();
      for (const [i, j] of lcsPairs(
         ia.map((i) => ga[i].ch),
         ib.map((j) => gb[j].ch)
      )) {
         out.push([ia[i], ib[j]]);
      }
   };
   let pa = 0;
   let pb = 0;
   for (const [i, j] of wordPairs) {
      gap(pa, i, pb, j);
      wa[i].forEach((gi, k) => out.push([gi, wb[j][k]]));
      pa = i + 1;
      pb = j + 1;
   }
   gap(pa, wa.length, pb, wb.length);
}

/** Pair characters of two strings by longest common subsequence: [indexA, indexB][]. */
function lcsPairs(a: readonly string[], b: readonly string[]): Array<[number, number]> {
   const n = a.length;
   const m = b.length;
   const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
   for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
         dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
   }
   const out: Array<[number, number]> = [];
   let i = 0;
   let j = 0;
   while (i < n && j < m) {
      if (a[i] === b[j]) {
         out.push([i, j]);
         i += 1;
         j += 1;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
         i += 1;
      } else {
         j += 1;
      }
   }
   return out;
}

interface Pair {
   a: SlideItem;
   b: SlideItem;
}

/**
 * A code block whose code changed: the card's bounds are drawn live (so they grow
 * or shrink smoothly), lines that are in both versions stay and glide to their new
 * row, removed lines fade out late, and new lines fade in.
 */
interface CodeMorph {
   pair: Pair;
   clip: SVGRectElement;
   moves: Array<{ el: SVGGElement; dx: number; dy: number }>;
   fadeOut: SVGGElement[];
   fadeIn: SVGGElement[];
}

/**
 * A matched pair of grid tables. The table itself is drawn live without cell text
 * (rows and columns interpolate when the structure is the same, else the two
 * layouts cross-fade); cells with the same text glide to their new place, cells
 * whose text changed in place morph glyph by glyph, the rest fade out / in.
 */
interface GridMorph {
   pair: Pair;
   clip: SVGRectElement;
   /** Same number of rows and columns on both slides. */
   sameShape: boolean;
   moves: Array<{ el: SVGGElement; dx: number; dy: number }>;
   fadeOut: SVGGElement[];
   fadeIn: SVGGElement[];
   /** Cells whose text changed in place: glyph-morphed once measured, else cross-faded. */
   changed: Array<{ a: SVGGElement; b: SVGGElement }>;
}

/** One drawn grid cell: its position in the grid and its text. */
interface GridCellRef {
   r: number;
   c: number;
   text: string;
}

/** The cells a grid draws, in the order the renderer emits their `<text>` (non-empty merge origins). */
function gridDrawnCells(text: string | undefined): GridCellRef[] {
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

interface GridBox {
   x: number;
   y: number;
   width: number;
   height: number;
}

/** One live piece of a morphing grid: a table drawn at `box` with `opacity` (0..1). */
interface GridPiece {
   key: string;
   box: GridBox;
   grid: GridData;
   opacity: number;
}

/** A grid with rows and columns swapped (so column changes can reuse the row logic). */
function transposeGrid(g: GridData): GridData {
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
function blendGridRows(ga: GridData, gb: GridData, boxA: GridBox, boxB: GridBox, t: number): GridPiece[] {
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
         .replace(/\u0001/g, '')
         .trim()
         ? sig(ga, r)
         : `\u0000a${r}`
   );
   const sb = gb.rows.map((_v, r) =>
      sig(gb, r)
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
   for (const [pi, pj] of byContent.length > byIndex ? byContent : []) {
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

   // Rows above / below the paired span: the whole table of that side (its extra rows
   // plus the span, so the outline and corners stay its own) fades over the steady span.
   const whole = (
      key: string,
      g: GridData,
      lead: number[],
      tail: number[],
      h: number[],
      side: 'a' | 'b',
      opacity: number
   ): void => {
      if (!lead.length && !tail.length) {
         return;
      }
      const styles: NonNullable<GridData['styles']> = {};
      const rs: number[] = [];
      const add = (src: number | undefined, height: number): void => {
         styleOf(g, src, rs.length, styles);
         rs.push(Math.max(height, 0.001));
      };
      lead.forEach((r) => add(r, h[r]));
      span.forEach((e, k) => add(e[side], rows[k]));
      tail.forEach((r) => add(r, h[r]));
      const above = sum(lead.map((r) => h[r]));
      out.push({
         key,
         box: { x, y: top - above, width, height: sum(rs) },
         grid: grid(rs, styles),
         opacity,
      });
   };
   whole('~a', ga, leadA, tailA, ha, 'a', fadeOut(t));
   whole('~b', gb, leadB, tailB, hb, 'b', fadeIn(t));
   return out;
}

/** Relative weights as fractions of their sum. */
function fractions(w: readonly number[]): number[] {
   const sum = w.reduce((x, y) => x + y, 0) || 1;
   return w.map((x) => x / sum);
}

/**
 * The morph transition between two slides, as a live SVG, behaving like
 * PowerPoint's Morph: an object that is on both slides is drawn ONCE and glides
 * from its first state to its second (position, size, rotation, colors, line
 * width, font size). It is re-rendered every frame, so shapes stay crisp and are
 * never stretched. Changed text animates glyph by glyph; arrows and relationship
 * lines follow what they are attached to; everything else fades out or in.
 * Works on copies of the slides' own data, never on project data.
 */
export class MorphStage {
   readonly svg: SVGSVGElement;
   private readonly to: RenderedSlide;
   private readonly offA: Offset;
   private readonly offB: Offset;
   private readonly elementPairs: Pair[] = [];
   private readonly tablePairs: Pair[] = [];
   private readonly codes: CodeMorph[] = [];
   private readonly grids: GridMorph[] = [];
   private readonly seqPairs: SeqPair[] = [];
   private readonly fromSeq: RenderedSlide['sequences'];
   private readonly toSeq: RenderedSlide['sequences'];
   /** What morphed text animates by: whole objects, words, or characters. */
   private readonly by: MorphBy;
   /** Sequence text whose wording changes (animated glyph by glyph once measured). */
   private readonly seqTexts: SeqTextJob[] = [];
   /** Slide-B ids of messages / participants / diagram titles drawn by the glyph layer. */
   private readonly hideMsg = new Set<string>();
   private readonly hideLl = new Set<string>();
   private readonly hideTitle = new Set<string>();
   private codeSeq = 0;
   private readonly liveRels: RelationshipModel[] = [];
   private readonly outgoing: SVGGElement[] = [];
   private readonly incoming: SVGGElement[] = [];
   /** Unpaired objects set to "no transition": they switch instantly instead of fading. */
   private readonly cutOut = new Set<SVGGElement>();
   private readonly cutIn = new Set<SVGGElement>();
   private readonly restA = document.createElementNS(SVG_NS, 'g');
   private readonly restB = document.createElementNS(SVG_NS, 'g');
   private readonly live = document.createElementNS(SVG_NS, 'g');
   private readonly bgB = document.createElementNS(SVG_NS, 'g');
   /** Text pairs drawn glyph by glyph (by slide-B id) instead of through the live scene. */
   private readonly glyphIds = new Set<string>();
   private readonly chars: CharMove[] = [];
   private charLayer: SVGGElement | null = null;
   /** Hidden static copies of changed text, kept only so their glyphs can be measured. */
   private measure: SVGGElement | null = null;
   private lastT = 0;
   private readonly reversed: boolean;

   /**
    * `reversed`: the transition plays backwards (`from` is the later slide), so the tag
    * rules mirror the forward ones: whatever could morph forward unanimates the same way.
    */
   constructor(from: RenderedSlide, to: RenderedSlide, reversed = false) {
      this.reversed = reversed;
      this.to = to;
      this.by = to.transition.morphBy ?? 'character';
      this.fromSeq = from.sequences;
      this.toSeq = to.sequences;
      this.offA = { x: from.originX, y: from.originY };
      this.offB = { x: to.originX, y: to.originY };
      const a = parse(from, GRID_ID);
      const b = parse(to, `${GRID_ID}-b`);

      const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
      svg.setAttribute('viewBox', `0 0 ${to.width} ${to.height}`);
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      svg.style.width = '100%';
      svg.style.height = '100%';
      svg.style.display = 'block';
      this.svg = svg;

      // Shared definitions (markers, hatch patterns, grid, embedded fonts).
      const defs = document.createElementNS(SVG_NS, 'defs');
      const seen = new Set<string>();
      for (const side of [a, b]) {
         for (const d of Array.from(side.root.querySelectorAll(':scope > defs > *'))) {
            const id = d.getAttribute('id');
            if (id && seen.has(id)) {
               continue;
            }
            if (id) {
               seen.add(id);
            }
            defs.appendChild(document.importNode(d, true));
         }
      }
      svg.appendChild(defs);

      const bgA = document.createElementNS(SVG_NS, 'g');
      for (const r of Array.from(a.root.querySelectorAll(':scope > rect'))) {
         bgA.appendChild(document.importNode(r, true));
      }
      for (const r of Array.from(b.root.querySelectorAll(':scope > rect'))) {
         this.bgB.appendChild(document.importNode(r, true));
      }
      svg.append(bgA, this.bgB);

      // Pair the objects that exist on both slides.
      const fromItems = from.items.filter((i) => a.items.has(i.id));
      const toItems = to.items.filter((i) => b.items.has(i.id));
      const matchedA = new Set<string>();
      const matchedB = new Set<string>();
      for (const [i, j] of matchMorphItems(fromItems, toItems, undefined, this.reversed)) {
         const pair: Pair = { a: fromItems[i], b: toItems[j] };
         if (pair.a.element && pair.b.element) {
            this.elementPairs.push(pair);
         } else if (pair.a.table && pair.b.table) {
            this.tablePairs.push(pair);
         } else {
            continue;
         }
         matchedA.add(pair.a.id);
         matchedB.add(pair.b.id);
      }

      // Relationship lines between two matched tables are redrawn live, so their
      // static copies are left out of both slides' backgrounds.
      const columnToTable = (items: readonly SlideItem[]): Map<string, string> => {
         const out = new Map<string, string>();
         for (const item of items) {
            for (const c of item.table?.columns ?? []) {
               out.set(c.id, item.id);
            }
         }
         return out;
      };
      const liveRelIds = (
         rels: readonly RelationshipModel[],
         items: readonly SlideItem[],
         matchedIds: Set<string>
      ): Set<string> => {
         const col = columnToTable(items);
         return new Set(
            rels
               .filter((r) => {
                  const s = col.get(r.sourceColumnId);
                  const t = col.get(r.targetColumnId);
                  return !!s && !!t && matchedIds.has(s) && matchedIds.has(t);
               })
               .map((r) => r.id)
         );
      };
      // Only a line that is on BOTH slides (between the same paired tables) is drawn
      // live; one on a single slide stays in that slide's static copy and fades with it,
      // instead of vanishing (an A-only line was dropped from A and never drawn live).
      const aToB = new Map([...this.tablePairs].map((p) => [p.a.id, p.b.id]));
      const ends = (r: RelationshipModel, col: Map<string, string>): [string, string] | null => {
         const s = col.get(r.sourceColumnId);
         const t = col.get(r.targetColumnId);
         return s && t ? [s, t] : null;
      };
      const colA = columnToTable(from.items);
      const colB = columnToTable(to.items);
      const key = (x: string, y: string): string => [x, y].sort().join('|');
      const keysA = new Set<string>();
      for (const r of from.relationships) {
         const e = ends(r, colA);
         if (e && aToB.has(e[0]) && aToB.has(e[1])) {
            keysA.add(key(aToB.get(e[0])!, aToB.get(e[1])!));
         }
      }
      const keysB = new Set<string>();
      for (const r of to.relationships) {
         const e = ends(r, colB);
         if (e) {
            keysB.add(key(e[0], e[1]));
         }
      }
      const ridA = new Set(
         [...liveRelIds(from.relationships, from.items, matchedA)].filter((id) => {
            const e = ends(
               from.relationships.find((r) => r.id === id)!,
               colA
            )!;
            return keysB.has(key(aToB.get(e[0])!, aToB.get(e[1])!));
         })
      );
      const ridB = new Set(
         [...liveRelIds(to.relationships, to.items, matchedB)].filter((id) => {
            const e = ends(
               to.relationships.find((r) => r.id === id)!,
               colB
            )!;
            return keysA.has(key(e[0], e[1]));
         })
      );
      this.liveRels.push(...to.relationships.filter((r) => ridB.has(r.id)));

      // Sequence diagrams on both slides are paired by morph tag, else by their
      // participants, and drawn live: participants and messages glide (matched by tag,
      // name and wording), new ones fade in, changed wording morphs glyph by glyph and
      // the box grows. Diagrams with no partner cross-fade.
      const usedSeqA = new Set<string>();
      const usedSeqB = new Set<string>();
      const diagramsA = from.sequences.diagrams;
      const diagramsB = to.sequences.diagrams;
      const like = (seq: RenderedSlide['sequences'], d: SequenceDiagramModel) => ({
         id: d.id,
         title: d.title,
         morphId: d.morphId,
         lifelines: seq.lifelines.filter((l) => l.diagramId === d.id),
      });
      for (const [i, j] of matchDiagrams(
         diagramsA.map((d) => like(from.sequences, d)),
         diagramsB.map((d) => like(to.sequences, d)),
         this.reversed
      )) {
         usedSeqA.add(diagramsA[i].id);
         usedSeqB.add(diagramsB[j].id);
         this.seqPairs.push(this.pairSequence(diagramsA[i], diagramsB[j]));
      }
      for (const p of this.seqPairs) {
         if (p.a.title && p.b.title && p.a.title !== p.b.title) {
            this.seqTexts.push({ kind: 'title', pair: p, aId: p.a.id, bId: p.b.id });
         }
         for (const [la, lb] of p.lifelines) {
            if (la.label && lb.label && la.label !== lb.label) {
               this.seqTexts.push({ kind: 'lifeline', pair: p, aId: la.id, bId: lb.id });
            }
         }
         for (const [ma, mb] of p.messages) {
            if (ma.label && mb.label && ma.label !== mb.label) {
               this.seqTexts.push({ kind: 'message', pair: p, aId: ma.id, bId: mb.id });
            }
         }
      }

      const shell = (side: Side): SVGGElement => {
         const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
         const tr = side.main.getAttribute('transform');
         if (tr) {
            g.setAttribute('transform', tr);
         }
         return g;
      };
      const buildRest = (side: Side, live: Set<string>, liveSeq: Set<string>, target: SVGGElement): void => {
         const s = shell(side);
         for (const el of side.rest) {
            const rid = el.getAttribute('data-rid');
            if (rid && live.has(rid)) {
               continue;
            }
            const sid = el.getAttribute('data-seq');
            if (sid && liveSeq.has(sid)) {
               continue;
            }
            s.appendChild(document.importNode(el, true));
         }
         target.appendChild(s);
      };
      buildRest(a, ridA, usedSeqA, this.restA);
      buildRest(b, ridB, usedSeqB, this.restB);
      svg.append(this.restA, this.restB);

      // Objects on only one slide fade out / in right where they are.
      const onlyHere = (
         side: Side,
         items: readonly SlideItem[],
         matchedIds: Set<string>,
         into: SVGGElement[]
      ): void => {
         for (const item of items) {
            if (matchedIds.has(item.id)) {
               continue;
            }
            const g = shell(side);
            g.appendChild(document.importNode(side.items.get(item.id)!, true));
            svg.appendChild(g);
            into.push(g);
            // The earlier slide's "out" tag (its "in" tag when playing backwards) says cut.
            const early = into === this.outgoing ? !this.reversed : this.reversed;
            const key = early ? item.element?.morphOut : item.element?.morphIn;
            if (key && key.startsWith('tag:cut-')) (into === this.outgoing ? this.cutOut : this.cutIn).add(g);
         }
      };
      onlyHere(a, fromItems, matchedA, this.outgoing);
      onlyHere(b, toItems, matchedB, this.incoming);

      // Changed text keeps hidden static copies so its glyph positions can be measured.
      const textPairs = this.textPairs();
      if (textPairs.length || this.seqTexts.length) {
         const m = document.createElementNS(SVG_NS, 'g') as SVGGElement;
         m.setAttribute('opacity', '0');
         for (const p of this.seqPairs) {
            if (!this.seqTexts.some((j) => j.pair === p)) {
               continue;
            }
            const ea = a.rest.find((el) => el.getAttribute('data-seq') === p.a.id);
            const eb = b.rest.find((el) => el.getAttribute('data-seq') === p.b.id);
            if (!ea || !eb) {
               continue;
            }
            const ga = shell(a);
            ga.setAttribute('data-side', 'a');
            ga.setAttribute('data-seq', p.a.id);
            ga.appendChild(document.importNode(ea, true));
            const gb = shell(b);
            gb.setAttribute('data-side', 'b');
            gb.setAttribute('data-seq', p.b.id);
            gb.appendChild(document.importNode(eb, true));
            m.append(ga, gb);
         }
         for (const p of textPairs) {
            const ga = shell(a);
            ga.setAttribute('data-side', 'a');
            ga.setAttribute('data-id', p.a.id);
            ga.appendChild(document.importNode(a.items.get(p.a.id)!, true));
            const gb = shell(b);
            gb.setAttribute('data-side', 'b');
            gb.setAttribute('data-id', p.b.id);
            gb.appendChild(document.importNode(b.items.get(p.b.id)!, true));
            m.append(ga, gb);
         }
         svg.appendChild(m);
         this.measure = m;
      }

      svg.appendChild(this.live);

      // Code blocks with changed code: line-level morph on top of the live card.
      for (const p of this.elementPairs) {
         if (p.a.type === 'code' && p.b.type === 'code' && codeShown(p.a.element!) !== codeShown(p.b.element!)) {
            const code = this.buildCodeMorph(p, a, b, shell);
            if (code) {
               this.codes.push(code);
            }
         }
         if (p.a.type === 'grid' && p.b.type === 'grid') {
            const grid = this.buildGridMorph(p, a, b, shell);
            if (grid) {
               this.grids.push(grid);
            }
         }
      }
      this.update(0);
   }

   private buildCodeMorph(p: Pair, a: Side, b: Side, shell: (side: Side) => SVGGElement): CodeMorph | null {
      const ga = a.items.get(p.a.id);
      const gb = b.items.get(p.b.id);
      if (!ga || !gb) {
         return null;
      }
      const read = (g: SVGGElement): { code: SVGTextElement[]; nums: SVGTextElement[]; extras: SVGTextElement[] } => {
         const texts = Array.from(g.querySelectorAll('text')) as unknown as SVGTextElement[];
         return {
            // Diff decorations (highlight bands, split divider, +/- signs) fade as a whole.
            extras: Array.from(g.querySelectorAll('[data-diff]')) as unknown as SVGTextElement[],
            code: texts.filter((t) => t.getAttribute('xml:space') === 'preserve'),
            nums: texts.filter((t) => t.getAttribute('text-anchor') === 'end' && /^\d+$/.test(t.textContent ?? '')),
         };
      };
      const ra = read(ga);
      const rb = read(gb);
      const pos = (t: SVGTextElement): { x: number; y: number } => ({
         x: Number(t.getAttribute('x')) || 0,
         y: Number(t.getAttribute('y')) || 0,
      });

      // The card clip follows the live (growing) bounds; everything text-like sits inside it.
      const clipId = `dd-morph-clip-${(this.codeSeq += 1)}`;
      const clipPath = document.createElementNS(SVG_NS, 'clipPath');
      clipPath.setAttribute('id', clipId);
      const clip = document.createElementNS(SVG_NS, 'rect') as SVGRectElement;
      clipPath.appendChild(clip);
      this.svg.querySelector('defs')?.appendChild(clipPath);
      const layer = document.createElementNS(SVG_NS, 'g') as SVGGElement;
      layer.setAttribute('clip-path', `url(#${clipId})`);
      this.svg.appendChild(layer);

      const out: CodeMorph = { pair: p, clip, moves: [], fadeOut: [], fadeIn: [] };
      const place = (side: Side, t: SVGTextElement, into: SVGGElement[]): SVGGElement => {
         const holder = shell(side);
         holder.appendChild(t.cloneNode(true));
         const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
         g.appendChild(holder);
         layer.appendChild(g);
         into.push(g);
         return g;
      };
      const pairUp = (
         la: SVGTextElement[],
         lb: SVGTextElement[],
         pairs: Array<[number, number]>,
         skipA: ReadonlySet<number> = new Set(),
         skipB: ReadonlySet<number> = new Set()
      ): void => {
         const usedA = new Set(pairs.map((x) => x[0]));
         const usedB = new Set(pairs.map((x) => x[1]));
         for (const [i, j] of pairs) {
            const g = place(b, lb[j], []);
            out.moves.push({ el: g, ...this.codeShift(pos(la[i]), pos(lb[j])) });
         }
         la.forEach((t, i) => {
            if (!usedA.has(i) && !skipA.has(i)) {
               place(a, t, out.fadeOut);
            }
         });
         lb.forEach((t, j) => {
            if (!usedB.has(j) && !skipB.has(j)) {
               place(b, t, out.fadeIn);
            }
         });
      };
      const textOf = (t: SVGTextElement): string => t.textContent ?? '';
      // Identical lines glide whole.
      const linePairs = lcsPairs(ra.code.map(textOf), rb.code.map(textOf));
      // Changed lines (the unmatched ones between two matched anchors, zipped in order)
      // morph character by character instead of crossfading.
      const changed: Array<[number, number]> = [];
      const anchors: Array<[number, number]> = [[-1, -1], ...linePairs, [ra.code.length, rb.code.length]];
      for (let k = 0; k + 1 < anchors.length; k++) {
         const ia: number[] = [];
         const ib: number[] = [];
         for (let i = anchors[k][0] + 1; i < anchors[k + 1][0]; i++) {
            if (textOf(ra.code[i]).trim()) ia.push(i);
         }
         for (let j = anchors[k][1] + 1; j < anchors[k + 1][1]; j++) {
            if (textOf(rb.code[j]).trim()) ib.push(j);
         }
         for (let m = 0; m < Math.min(ia.length, ib.length); m++) {
            changed.push([ia[m], ib[m]]);
         }
      }
      pairUp(ra.code, rb.code, linePairs, new Set(changed.map((x) => x[0])), new Set(changed.map((x) => x[1])));
      for (const [i, j] of changed) {
         const ca = codeChars(ra.code[i]);
         const cb = codeChars(rb.code[j]);
         const cp = lcsPairs(
            ca.map((c) => c.ch),
            cb.map((c) => c.ch)
         );
         const ua = new Set(cp.map((x) => x[0]));
         const ub = new Set(cp.map((x) => x[1]));
         for (const [x, y] of cp) {
            const g = place(b, cb[y].el, []);
            out.moves.push({ el: g, ...this.codeShift(ca[x], cb[y]) });
         }
         ca.forEach((c, x) => {
            if (!ua.has(x) && /\S/.test(c.ch)) place(a, c.el, out.fadeOut);
         });
         cb.forEach((c, y) => {
            if (!ub.has(y) && /\S/.test(c.ch)) place(b, c.el, out.fadeIn);
         });
      }
      // Gutter numbers stay in their gutter: a number pairs with the same number in the
      // same gutter column (left to right) on the other slide, so it only shifts by as
      // much as its row does; the rest fade.
      const keys = (list: SVGTextElement[]): string[] => {
         const cols = [...new Set(list.map((t) => Math.round(pos(t).x)))].sort((x, y) => x - y);
         return list.map((t) => `${cols.indexOf(Math.round(pos(t).x))}|${textOf(t)}`);
      };
      const kb = keys(rb.nums);
      const freeB = new Map<string, number[]>();
      kb.forEach((key, j) => freeB.set(key, [...(freeB.get(key) ?? []), j]));
      const numPairs: Array<[number, number]> = [];
      keys(ra.nums).forEach((key, i) => {
         const j = freeB.get(key)?.shift();
         if (j != null) numPairs.push([i, j]);
      });
      pairUp(ra.nums, rb.nums, numPairs);
      // Bands sit under the text: put them first in the layer.
      const before = layer.firstChild;
      for (const [side, list, into] of [
         [a, ra.extras, out.fadeOut],
         [b, rb.extras, out.fadeIn],
      ] as const) {
         for (const el of list) {
            const g = place(side, el, into);
            if (el.tagName !== 'text') {
               layer.insertBefore(g, before);
            }
         }
      }
      return out;
   }

   /** The in-slide offset from a B-side position back to its A-side partner. */
   private codeShift(pa: { x: number; y: number }, pb: { x: number; y: number }): { dx: number; dy: number } {
      // Both positions are canvas coordinates of different slides: compare them
      // relative to their own slide so only the in-slide movement is animated.
      return {
         dx: pa.x - this.offA.x - (pb.x - this.offB.x),
         dy: pa.y - this.offA.y - (pb.y - this.offB.y),
      };
   }

   private buildGridMorph(p: Pair, a: Side, b: Side, shell: (side: Side) => SVGGElement): GridMorph | null {
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

      const clipId = `dd-morph-clip-${(this.codeSeq += 1)}`;
      const clipPath = document.createElementNS(SVG_NS, 'clipPath');
      clipPath.setAttribute('id', clipId);
      const clip = document.createElementNS(SVG_NS, 'rect') as SVGRectElement;
      clipPath.appendChild(clip);
      this.svg.querySelector('defs')?.appendChild(clipPath);
      const layer = document.createElementNS(SVG_NS, 'g') as SVGGElement;
      layer.setAttribute('clip-path', `url(#${clipId})`);
      this.svg.appendChild(layer);

      const out: GridMorph = {
         pair: p,
         clip,
         sameShape: da.rows.length === db.rows.length && da.cols.length === db.cols.length,
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

      // 1. The same text (in reading order) glides to wherever its cell went.
      const pairs = lcsPairs(
         ca.map((c) => c.text),
         cb.map((c) => c.text)
      );
      const usedA = new Set(pairs.map((x) => x[0]));
      const usedB = new Set(pairs.map((x) => x[1]));
      // 2. A cell at the same row/column whose text changed morphs in place.
      const inPlace: Array<[number, number]> = [];
      ca.forEach((x, i) => {
         if (usedA.has(i)) {
            return;
         }
         const j = cb.findIndex((y, k) => !usedB.has(k) && y.r === x.r && y.c === x.c);
         if (j >= 0) {
            usedA.add(i);
            usedB.add(j);
            inPlace.push([i, j]);
         }
      });
      for (const [i, j] of pairs) {
         const g = place(b, tb[j]);
         const pa = anchor(ta[i]);
         const pb = anchor(tb[j]);
         out.moves.push({
            el: g,
            dx: pa.x - this.offA.x - (pb.x - this.offB.x),
            dy: pa.y - this.offA.y - (pb.y - this.offB.y),
         });
      }
      for (const [i, j] of inPlace) {
         const ea = place(a, ta[i]);
         const eb = place(b, tb[j]);
         out.fadeOut.push(ea);
         out.fadeIn.push(eb);
         out.changed.push({ a: ea, b: eb });
      }
      // 3. Everything else fades out / in where it is.
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
   private blendGrid(gm: GridMorph, blended: CanvasElementModel, t: number): CanvasElementModel[] {
      const ea = gm.pair.a.element!;
      const eb = gm.pair.b.element!;
      const blank = (text: string | undefined) => {
         const g = parseGrid(text);
         return { ...g, cells: g.cells.map((row) => row.map(() => '')) };
      };
      if (gm.sameShape) {
         const ga = parseGrid(ea.text);
         const gb = parseGrid(eb.text);
         const mix = (x: number[], y: number[]): number[] => {
            const fy = fractions(y);
            return fractions(x).map((v, i) => lerp(v, fy[i], t) * 1000);
         };
         const g = blank(t < 0.5 ? ea.text : eb.text);
         return [
            { ...blended, text: serializeGrid({ ...g, cols: mix(ga.cols, gb.cols), rows: mix(ga.rows, gb.rows) }) },
         ];
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
         const pieces = blendGridRows(
            flip ? transposeGrid(ga) : ga,
            flip ? transposeGrid(gb) : gb,
            boxOf(ea, this.offA),
            boxOf(eb, this.offB),
            t
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

   /** Pair the diagram parts of two sequence diagrams (participants, then messages). */
   private pairSequence(da: SequenceDiagramModel, db: SequenceDiagramModel): SeqPair {
      const llA = this.fromSeq.lifelines.filter((l) => l.diagramId === da.id);
      const llB = this.toSeq.lifelines.filter((l) => l.diagramId === db.id);
      const msA = this.fromSeq.messages.filter((m) => m.diagramId === da.id);
      const msB = this.toSeq.messages.filter((m) => m.diagramId === db.id);
      const lp = matchLifelines(llA, llB, this.reversed);
      // Every matched message glides; an end that moved to another participant slides
      // there (see `ends` in blendSequences), so the arrow grows or shrinks.
      const messages = matchMessages(msA, msB, lp, llA, llB, this.reversed).map(
         ([i, j]): [SequenceMessageModel, SequenceMessageModel] => [msA[i], msB[j]]
      );
      return {
         a: da,
         b: db,
         llA,
         llB,
         msA,
         msB,
         lifelines: lp.map(([i, j]): [LifelineModel, LifelineModel] => [llA[i], llB[j]]),
         messages,
      };
   }

   /**
    * Animate one piece of text from `ga` to `gb`: paired glyphs glide, the rest fade
    * out / in while riding along with the text block's overall movement.
    */
   private addGlyphMoves(layer: SVGGElement, ga: Glyph[], gb: Glyph[]): void {
      const matched = matchGlyphs(ga, gb, this.by);
      const usedA = new Set(matched.map((m) => m[0]));
      const usedB = new Set(matched.map((m) => m[1]));
      const center = (g: readonly Glyph[]): { x: number; y: number } => {
         if (!g.length) {
            return { x: 0, y: 0 };
         }
         const xs = g.flatMap((q) => [q.x, q.x + q.size * 0.55]);
         const ys = g.flatMap((q) => [q.y - q.size * 0.8, q.y + q.size * 0.2]);
         return {
            x: (Math.min(...xs) + Math.max(...xs)) / 2,
            y: (Math.min(...ys) + Math.max(...ys)) / 2,
         };
      };
      const ca = center(ga);
      const cb = center(gb);
      const dx = cb.x - ca.x;
      const dy = cb.y - ca.y;
      const make = (g: Glyph): SVGTextElement => {
         const el = document.createElementNS(SVG_NS, 'text') as SVGTextElement;
         el.setAttribute('font-family', g.family);
         // Glyphs are laid out once at a fixed size and moved/scaled by transform:
         // changing font-size per frame re-hints them, so letters wobble mid-morph.
         el.setAttribute('text-rendering', 'geometricPrecision');
         el.setAttribute('x', '0');
         el.setAttribute('y', '0');
         el.textContent = g.ch;
         layer.appendChild(el);
         return el;
      };
      for (const [i, j] of matched) {
         this.chars.push({ el: make(ga[i]), a: ga[i], b: gb[j], dx, dy });
      }
      ga.forEach((g, i) => {
         if (!usedA.has(i)) {
            this.chars.push({ el: make(g), a: g, b: null, dx, dy });
         }
      });
      gb.forEach((g, j) => {
         if (!usedB.has(j)) {
            this.chars.push({ el: make(g), a: null, b: g, dx, dy });
         }
      });
   }

   private textPairs(): Pair[] {
      return this.elementPairs.filter(
         (p) =>
            p.a.type !== 'code' &&
            p.b.type !== 'code' &&
            p.a.type !== 'grid' &&
            p.b.type !== 'grid' &&
            !!p.a.text.trim() &&
            !!p.b.text.trim() &&
            (p.a.text !== p.b.text ||
               JSON.stringify(p.a.element?.runs ?? null) !== JSON.stringify(p.b.element?.runs ?? null))
      );
   }

   /**
    * Changed text between matched text elements is morphed glyph by glyph:
    * characters present in both slides slide to their new place, new ones fade in,
    * removed ones fade out. Needs the stage attached to the document (glyph
    * positions are measured from the real layout), so call it right after append.
    */
   async prepare(): Promise<void> {
      const measure = this.measure;
      if (!measure && !this.grids.some((g) => g.changed.length)) {
         return;
      }
      try {
         await Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 400))]);
      } catch {
         /* measure with whatever font is available */
      }
      const layer = document.createElementNS(SVG_NS, 'g') as SVGGElement;
      const read = (find: () => [SVGTextElement | null, SVGTextElement | null]): [Glyph[], Glyph[]] | null => {
         let ga: Glyph[] | null = null;
         let gb: Glyph[] | null = null;
         try {
            const [ta, tb] = find();
            ga = ta ? readGlyphs(ta, this.offA) : null;
            gb = tb ? readGlyphs(tb, this.offB) : null;
         } catch (err) {
            console.warn('morph: could not measure text', err);
         }
         if (!ga || !gb || ga.length > MAX_CHAR_MORPH || gb.length > MAX_CHAR_MORPH) {
            return null;
         }
         return [ga, gb];
      };
      for (const p of this.textPairs()) {
         const glyphs = read(() => {
            const find = (side: 'a' | 'b', id: string): SVGTextElement | null =>
               measure?.querySelector(`g[data-side="${side}"][data-id="${CSS.escape(id)}"] text`) ?? null;
            return [find('a', p.a.id), find('b', p.b.id)];
         });
         if (glyphs) {
            this.addGlyphMoves(layer, glyphs[0], glyphs[1]);
            this.glyphIds.add(p.b.id);
         }
      }
      // Grid cells whose text changed in place.
      for (const gm of this.grids) {
         for (const c of gm.changed) {
            const glyphs = read(() => [c.a.querySelector('text'), c.b.querySelector('text')]);
            if (!glyphs) {
               continue; // stays a cross-fade
            }
            this.addGlyphMoves(layer, glyphs[0], glyphs[1]);
            c.a.remove();
            c.b.remove();
         }
      }
      // Sequence text: titles, participant names and message wording.
      for (const job of this.seqTexts) {
         const attr = job.kind === 'title' ? 'data-seq-title' : job.kind === 'lifeline' ? 'data-lid' : 'data-mid';
         const glyphs = read(() => {
            const find = (side: 'a' | 'b', seqId: string, id: string): SVGTextElement | null =>
               measure?.querySelector(
                  `g[data-side="${side}"][data-seq="${CSS.escape(seqId)}"] text[${attr}="${CSS.escape(id)}"]`
               ) ?? null;
            return [find('a', job.pair.a.id, job.aId), find('b', job.pair.b.id, job.bId)];
         });
         if (!glyphs) {
            continue;
         }
         this.addGlyphMoves(layer, glyphs[0], glyphs[1]);
         (job.kind === 'title' ? this.hideTitle : job.kind === 'lifeline' ? this.hideLl : this.hideMsg).add(job.bId);
      }
      measure?.remove();
      this.measure = null;
      if (this.chars.length) {
         this.svg.appendChild(layer);
         this.charLayer = layer;
      }
      this.update(this.lastT);
   }

   /** Render the morph at progress `t` (0 = first slide, 1 = second), already eased. */
   update(t: number): void {
      this.lastT = t;
      this.bgB.setAttribute('opacity', String(fadeIn(t)));
      this.restA.setAttribute('opacity', String(fadeOut(t)));
      this.restB.setAttribute('opacity', String(fadeIn(t)));
      for (const g of this.outgoing) {
         g.setAttribute('opacity', String(this.cutOut.has(g) ? (t > 0 ? 0 : 1) : 1 - t));
      }
      for (const g of this.incoming) {
         g.setAttribute('opacity', String(this.cutIn.has(g) ? (t > 0 ? 1 : 0) : t));
      }

      // Matched objects are re-rendered at their in-between state, in slide-local space.
      const elements: CanvasElementModel[] = [];
      for (const p of this.elementPairs) {
         const glyphs = this.glyphIds.has(p.b.id);
         if (glyphs && p.b.type === 'text') {
            continue;
         }
         const blended = blendElement(p.a.element!, p.b.element!, t, this.offA, this.offB);
         const isCode = this.codes.some((c) => c.pair === p);
         const grid = this.grids.find((g) => g.pair === p);
         if (grid) {
            const pieces = this.blendGrid(grid, blended, t);
            elements.push(...pieces);
            // Cell text is clipped to everything the grid draws (fading rows included).
            const x0 = Math.min(...pieces.map((e) => e.x));
            const y0 = Math.min(...pieces.map((e) => e.y));
            const x1 = Math.max(...pieces.map((e) => e.x + e.width));
            const y1 = Math.max(...pieces.map((e) => e.y + e.height));
            grid.clip.setAttribute('x', String(x0));
            grid.clip.setAttribute('y', String(y0));
            grid.clip.setAttribute('width', String(Math.max(0, x1 - x0)));
            grid.clip.setAttribute('height', String(Math.max(0, y1 - y0)));
            continue;
         }
         // A shape's label (or a changing code block's lines) is drawn by its own layer.
         // A changing code block's card is drawn empty (no lines, no diff): its own layer
         // animates the lines and the diff decorations on top.
         elements.push(
            isCode
               ? { ...blended, text: '', diffText: undefined, diffView: undefined }
               : glyphs
                 ? { ...blended, text: '' }
                 : blended
         );
         if (isCode) {
            const c = this.codes.find((x) => x.pair === p)!;
            c.clip.setAttribute('x', String(blended.x));
            c.clip.setAttribute('y', String(blended.y));
            c.clip.setAttribute('width', String(Math.max(0, blended.width)));
            c.clip.setAttribute('height', String(Math.max(0, blended.height)));
            c.clip.setAttribute('rx', String(blended.cornerRadius ?? 8));
         }
      }
      const tables: TableModel[] = this.tablePairs.map((p) => ({
         ...p.b.table!,
         x: lerp(p.a.table!.x - this.offA.x, p.b.table!.x - this.offB.x, t),
         y: lerp(p.a.table!.y - this.offA.y, p.b.table!.y - this.offB.y, t),
      }));
      const seq = this.seqPairs.length
         ? this.blendSequences(t)
         : { diagrams: [], lifelines: [], messages: [], smooth: false };
      if (elements.length || tables.length || seq.diagrams.length) {
         const body = buildDiagramSvg(
            tables,
            this.liveRels,
            elements,
            seq,
            { x: 0, y: 0, width: this.to.width, height: this.to.height, pageColor: this.to.pageColor },
            this.to.imageData
         )
            // Grid/code cards clip by `grid-clip-<id>` / `code-clip-<id>`; the hidden measure
            // copies (and the editor canvas) hold the same ids, and url(#…) picks the first,
            // so the live card would be clipped by a stale rect (lines and fills vanish).
            .body.replace(/\b(grid|code)-clip-/g, 'dd-morph-live-$1-clip-');
         this.live.replaceChildren(...safeSvgFragment(body));
      } else {
         this.live.replaceChildren();
      }

      for (const c of [...this.codes, ...this.grids]) {
         for (const m of c.moves) {
            m.el.setAttribute('transform', `translate(${m.dx * (1 - t)} ${m.dy * (1 - t)})`);
         }
         for (const g of c.fadeOut) {
            g.setAttribute('opacity', String(fadeOut(t)));
         }
         for (const g of c.fadeIn) {
            g.setAttribute('opacity', String(fadeIn(t)));
         }
      }

      for (const c of this.chars) {
         const single = !(c.a && c.b);
         const only = (c.a ?? c.b)!;
         const from = c.a ?? only;
         const to = c.b ?? only;
         const f = single ? 0 : t;
         // A character without a partner travels with its text block (fading out toward
         // where the block ends up, or in from where it was) instead of staying put.
         const x = single ? (c.a ? only.x + c.dx * t : only.x - c.dx * (1 - t)) : lerp(from.x, to.x, f);
         const y = single ? (c.a ? only.y + c.dy * t : only.y - c.dy * (1 - t)) : lerp(from.y, to.y, f);
         const base = to.size || 16;
         if (c.el.getAttribute('font-size') !== String(base)) {
            c.el.setAttribute('font-size', String(base));
         }
         const scale = lerp(from.size, to.size, f) / base;
         c.el.setAttribute('transform', `translate(${x} ${y}) scale(${scale})`);
         c.el.setAttribute('fill', mixColor(from.fill, to.fill, f));
         // Weight / italic / underline can't be blended: they switch halfway.
         const style = f < 0.5 ? from : to;
         c.el.setAttribute('font-weight', style.weight);
         c.el.setAttribute('font-style', style.italic ? 'italic' : 'normal');
         if (style.underline) {
            c.el.setAttribute('text-decoration', 'underline');
         } else {
            c.el.removeAttribute('text-decoration');
         }
         c.el.setAttribute('opacity', String(c.a && c.b ? 1 : c.a ? 1 - t : t));
      }
   }

   /**
    * The live sequence diagrams at progress `t`, in slide-local coordinates.
    * Participants and messages that are on both slides glide (rows and columns
    * interpolate, colors blend); ones on only one slide fade out or in where they
    * are, and the box grows or shrinks between the two boxes. Text that changes is
    * left out here when the glyph layer animates it.
    */
   private blendSequences(t: number): {
      diagrams: SequenceDiagramModel[];
      lifelines: LifelineModel[];
      messages: SequenceMessageModel[];
      smooth: boolean;
      fade: { lifelines: Map<string, number>; messages: Map<string, number> };
      hideText: {
         messages: ReadonlySet<string>;
         lifelines: ReadonlySet<string>;
         titles: ReadonlySet<string>;
      };
      themeHeaderText: ReadonlySet<string>;
      boxes: Map<string, SequenceBox>;
      ends: Map<string, { from: number; to: number }>;
   } {
      const diagrams: SequenceDiagramModel[] = [];
      const lifelines: LifelineModel[] = [];
      const messages: SequenceMessageModel[] = [];
      const fadeLl = new Map<string, number>();
      const fadeMs = new Map<string, number>();
      const boxes = new Map<string, SequenceBox>();
      const ends = new Map<string, { from: number; to: number }>();
      const themeHeaderText = new Set<string>();
      const offA = this.offA;
      const offB = this.offB;
      const row = (m: SequenceMessageModel, d: SequenceDiagramModel): number =>
         Math.max(1, Math.round((m.y - (d.originY + d.headerHeight)) / d.rowSpacing));
      const shifted = (b: SequenceBox, off: Offset): SequenceBox => ({
         x0: b.x0 - off.x,
         y0: b.y0 - off.y,
         x1: b.x1 - off.x,
         y1: b.y1 - off.y,
      });

      for (const p of this.seqPairs) {
         const { a: da, b: db } = p;
         const originY = lerp(da.originY - offA.y, db.originY - offB.y, t);
         const headerHeight = lerp(da.headerHeight, db.headerHeight, t);
         const rowSpacing = lerp(da.rowSpacing, db.rowSpacing, t);
         diagrams.push({
            ...db,
            originY,
            headerHeight,
            rowSpacing,
            lifelineSpacing: lerp(da.lifelineSpacing, db.lifelineSpacing, t),
            backgroundColor: mixOptionalColor(da.backgroundColor, db.backgroundColor, t),
            title: t < 0.5 ? da.title : db.title,
         });
         const hb = originY + headerHeight;

         const boxA = sequenceBounds(da, this.fromSeq.lifelines, this.fromSeq.messages);
         const boxB = sequenceBounds(db, this.toSeq.lifelines, this.toSeq.messages);
         if (boxA && boxB) {
            const a = shifted(boxA, offA);
            const b = shifted(boxB, offB);
            boxes.set(db.id, {
               x0: lerp(a.x0, b.x0, t),
               y0: lerp(a.y0, b.y0, t),
               x1: lerp(a.x1, b.x1, t),
               y1: lerp(a.y1, b.y1, t),
            });
         }

         // Participants.
         const idOfA = new Map<string, string>();
         const pairedA = new Set<string>();
         const pairedB = new Set<string>();
         for (const [la, lb] of p.lifelines) {
            pairedA.add(la.id);
            pairedB.add(lb.id);
            idOfA.set(la.id, lb.id);
            if (isStockHeader(la.color) && isStockHeader(lb.color)) {
               themeHeaderText.add(lb.id);
            }
            lifelines.push({
               ...lb,
               diagramId: db.id,
               label: t < 0.5 ? la.label : lb.label,
               x: lerp(la.x - offA.x, lb.x - offB.x, t),
               width: lerp(la.width, lb.width, t),
               color: mixOptionalColor(la.color, lb.color, t),
               lineColor: mixOptionalColor(la.lineColor, lb.lineColor, t),
               strokeColor: mixOptionalColor(la.strokeColor, lb.strokeColor, t),
               textColor: mixOptionalColor(la.textColor, lb.textColor, t),
            });
         }
         for (const la of p.llA) {
            if (!pairedA.has(la.id)) {
               idOfA.set(la.id, la.id);
               lifelines.push({ ...la, diagramId: db.id, x: la.x - offA.x });
               fadeLl.set(la.id, 1 - t);
            }
         }
         for (const lb of p.llB) {
            if (!pairedB.has(lb.id)) {
               lifelines.push({ ...lb, x: lb.x - offB.x });
               fadeLl.set(lb.id, t);
            }
         }

         // Messages.
         const doneA = new Set<string>();
         const doneB = new Set<string>();
         const xA = new Map(p.llA.map((l) => [l.id, l.x - offA.x] as const));
         const xB = new Map(p.llB.map((l) => [l.id, l.x - offB.x] as const));
         for (const [ma, mb] of p.messages) {
            doneA.add(ma.id);
            doneB.add(mb.id);
            const fa = xA.get(ma.fromLifelineId);
            const ta = xA.get(ma.toLifelineId);
            const fb = xB.get(mb.fromLifelineId);
            const tb = xB.get(mb.toLifelineId);
            if (fa !== undefined && ta !== undefined && fb !== undefined && tb !== undefined) {
               ends.set(mb.id, { from: lerp(fa, fb, t), to: lerp(ta, tb, t) });
            }
            messages.push({
               ...mb,
               diagramId: db.id,
               label: t < 0.5 ? ma.label : mb.label,
               y: hb + rowSpacing * lerp(row(ma, da), row(mb, db), t),
               color: mixOptionalColor(ma.color, mb.color, t),
            });
         }
         for (const ma of p.msA) {
            if (doneA.has(ma.id)) {
               continue;
            }
            const from = idOfA.get(ma.fromLifelineId);
            const to = idOfA.get(ma.toLifelineId);
            if (from && to) {
               messages.push({
                  ...ma,
                  diagramId: db.id,
                  fromLifelineId: from,
                  toLifelineId: to,
                  y: hb + rowSpacing * row(ma, da),
               });
               fadeMs.set(ma.id, 1 - t);
            }
         }
         for (const mb of p.msB) {
            if (!doneB.has(mb.id)) {
               messages.push({ ...mb, diagramId: db.id, y: hb + rowSpacing * row(mb, db) });
               fadeMs.set(mb.id, t);
            }
         }
      }
      return {
         diagrams,
         lifelines,
         messages,
         smooth: true,
         fade: { lifelines: fadeLl, messages: fadeMs },
         hideText: { messages: this.hideMsg, lifelines: this.hideLl, titles: this.hideTitle },
         themeHeaderText,
         boxes,
         ends,
      };
   }

   /** Number of objects that glide between the slides (0 = it is just a cross-fade). */
   get pairedCount(): number {
      return this.elementPairs.length + this.tablePairs.length + this.seqPairs.length;
   }

   dispose(): void {
      this.charLayer?.remove();
      this.svg.remove();
   }
}

/** What a code block shows: its code plus, when a diff is on, the diff view and other side. */
function codeShown(el: CanvasElementModel): string {
   return codeDiffActive(el) ? `${el.text}\u0000${el.diffView}\u0000${el.diffText}` : (el.text ?? '');
}

/**
 * A code line split into one positioned <text> per character (monospace: the advance
 * is the line's measured width over its length), keeping each token's color/italic.
 */
function codeChars(line: SVGTextElement): Array<{ ch: string; x: number; y: number; el: SVGTextElement }> {
   const text = line.textContent ?? '';
   const x0 = Number(line.getAttribute('x')) || 0;
   const y = Number(line.getAttribute('y')) || 0;
   const size = Number(line.getAttribute('font-size')) || 14;
   let cw = size * 0.6;
   try {
      const w = line.getComputedTextLength();
      if (w > 0 && text.length) cw = w / text.length;
   } catch {
      /* not rendered: keep the estimate */
   }
   const runs: Array<{ text: string; fill: string | null; italic: boolean }> = [];
   const spans = Array.from(line.querySelectorAll('tspan'));
   if (spans.length) {
      for (const sp of spans) {
         runs.push({
            text: sp.textContent ?? '',
            fill: sp.getAttribute('fill'),
            italic: sp.getAttribute('font-style') === 'italic',
         });
      }
   } else {
      runs.push({ text, fill: line.getAttribute('fill'), italic: false });
   }
   const out: Array<{ ch: string; x: number; y: number; el: SVGTextElement }> = [];
   let i = 0;
   for (const r of runs) {
      for (const ch of r.text) {
         const x = x0 + i * cw;
         const el = line.cloneNode(false) as SVGTextElement;
         el.setAttribute('x', String(x));
         if (r.fill) el.setAttribute('fill', r.fill);
         if (r.italic) el.setAttribute('font-style', 'italic');
         el.textContent = ch;
         out.push({ ch, x, y, el });
         i += 1;
      }
   }
   return out;
}
