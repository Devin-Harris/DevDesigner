import type { Side } from './morph.model';
import { SVG_NS } from './morph.model';
import type { Pair } from './morph.model';
import type { MorphContext } from './morph.model';
import type { CodeMorph } from './morph.model';
import type { CanvasElementModel } from '@devdesigner/shared';
import { codeDiffActive } from '../../../../helpers/render';
import { lcsPairs } from './morph-text.helper';

/**
 * Character pairs of two code lines matched by whole tokens (identifiers / numbers,
 * runs of whitespace, single punctuation): each matched token's characters pair in
 * order, so a token moves as one piece and an edited token is replaced, not respelled.
 */
export function tokenPairs(
   ca: ReadonlyArray<{ ch: string }>,
   cb: ReadonlyArray<{ ch: string }>
): Array<[number, number]> {
   const tokens = (cs: ReadonlyArray<{ ch: string }>): Array<{ text: string; start: number }> => {
      const out: Array<{ text: string; start: number }> = [];
      const kind = (ch: string): number => (/\w/.test(ch) ? 0 : /\s/.test(ch) ? 1 : 2);
      cs.forEach((c, i) => {
         const last = out[out.length - 1];
         const k = kind(c.ch);
         if (last && k !== 2 && kind(last.text[0]) === k) last.text += c.ch;
         else out.push({ text: c.ch, start: i });
      });
      return out;
   };
   const ta = tokens(ca);
   const tb = tokens(cb);
   const out: Array<[number, number]> = [];
   for (const [x, y] of lcsPairs(
      ta.map((t) => t.text),
      tb.map((t) => t.text)
   )) {
      for (let k = 0; k < ta[x].text.length; k++) out.push([ta[x].start + k, tb[y].start + k]);
   }
   return out;
}

/** What a code block shows: its code plus, when a diff is on, the diff view and other side. */
export function codeShown(el: CanvasElementModel): string {
   return codeDiffActive(el) ? `${el.text}\u0000${el.diffView}\u0000${el.diffText}` : (el.text ?? '');
}

/**
 * A code line split into one positioned <text> per character (monospace: the advance
 * is the line's measured width over its length), keeping each token's color/italic.
 */
export function codeChars(line: SVGTextElement): Array<{ ch: string; x: number; y: number; el: SVGTextElement }> {
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

export function buildCodeMorph(
   ctx: MorphContext,
   p: Pair,
   a: Side,
   b: Side,
   shell: (side: Side) => SVGGElement
): CodeMorph | null {
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
   const clipId = `dd-morph-clip-${ctx.nextClipId()}`;
   const clipPath = document.createElementNS(SVG_NS, 'clipPath');
   clipPath.setAttribute('id', clipId);
   const clip = document.createElementNS(SVG_NS, 'rect') as SVGRectElement;
   clipPath.appendChild(clip);
   ctx.svg.querySelector('defs')?.appendChild(clipPath);
   const layer = document.createElementNS(SVG_NS, 'g') as SVGGElement;
   layer.setAttribute('clip-path', `url(#${clipId})`);
   ctx.svg.appendChild(layer);

   const out: CodeMorph = { pair: p, clip, layer, moves: [], fadeOut: [], fadeIn: [] };
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
         out.moves.push({ el: g, ...codeShift(ctx, pos(la[i]), pos(lb[j])) });
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
   // "Animate text by object": the code crossfades as one piece (the card still
   // glides and resizes). Otherwise identical lines glide whole.
   const by = ctx.byFor(p);
   const whole = by === 'object';
   const linePairs = whole ? [] : lcsPairs(ra.code.map(textOf), rb.code.map(textOf));
   // Changed lines (the unmatched ones between two matched anchors, zipped in order)
   // morph character by character instead of crossfading.
   const changed: Array<[number, number]> = [];
   const anchors: Array<[number, number]> = [[-1, -1], ...linePairs, [ra.code.length, rb.code.length]];
   for (let k = 0; !whole && k + 1 < anchors.length; k++) {
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
      // By word: whole tokens pair up (a word that stays glides as one piece and a
      // changed word swaps whole); by character: letters pair up inside words too.
      const cp =
         by === 'word'
            ? tokenPairs(ca, cb)
            : lcsPairs(
                 ca.map((c) => c.ch),
                 cb.map((c) => c.ch)
              );
      const ua = new Set(cp.map((x) => x[0]));
      const ub = new Set(cp.map((x) => x[1]));
      for (const [x, y] of cp) {
         const g = place(b, cb[y].el, []);
         out.moves.push({ el: g, ...codeShift(ctx, ca[x], cb[y]) });
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
export function codeShift(
   ctx: MorphContext,
   pa: { x: number; y: number },
   pb: { x: number; y: number }
): { dx: number; dy: number } {
   // Both positions are canvas coordinates of different slides: compare them
   // relative to their own slide so only the in-slide movement is animated.
   return {
      dx: pa.x - ctx.offA.x - (pb.x - ctx.offB.x),
      dy: pa.y - ctx.offA.y - (pb.y - ctx.offB.y),
   };
}
