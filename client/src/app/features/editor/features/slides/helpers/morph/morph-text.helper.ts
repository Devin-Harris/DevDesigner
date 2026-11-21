import type { MorphBy } from '@devdesigner/shared';
import type { Offset } from './morph.model';

/** Glyph reading and character/word matching for text morphs. */

export interface Glyph {
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
export interface CharMove {
   el: SVGTextElement;
   a: Glyph | null;
   b: Glyph | null;
   dx: number;
   dy: number;
}

export interface SpanStyle {
   weight: string;
   italic: boolean;
   underline: boolean;
   fill: string;
   line: Element | null;
   morph: string;
}

/** The rich-text style in effect at `node` (innermost tspan attribute wins). */
export function spanStyle(node: Node, text: SVGTextElement): SpanStyle {
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
export function readGlyphs(text: SVGTextElement, off: Offset): Glyph[] | null {
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
export function matchGlyphs(ga: readonly Glyph[], gb: readonly Glyph[], by: MorphBy): Array<[number, number]> {
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
export function matchUntaggedGlyphs(
   ga: readonly Glyph[],
   gb: readonly Glyph[],
   letters: boolean
): Array<[number, number]> {
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
export function matchWords(
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
export function lcsPairs(a: readonly string[], b: readonly string[]): Array<[number, number]> {
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
