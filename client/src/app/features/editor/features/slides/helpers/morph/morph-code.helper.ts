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
   // A split view lists its two columns' lines interleaved: when both slides are split,
   // a line only pairs within its own column, so nothing slides across the divider.
   const columns = (list: SVGTextElement[]): number[] => {
      const xs = [...new Set(list.map((t) => Math.round(pos(t).x)))].sort((x, y) => x - y);
      return list.map((t) => (xs.length === 2 ? xs.indexOf(Math.round(pos(t).x)) : 0));
   };
   const colA = columns(ra.code);
   const colB = columns(rb.code);
   const split = colA.includes(1) && colB.includes(1);
   const keyOf = (cols: number[]) => (t: SVGTextElement, i: number) => (split ? `${cols[i]}|${textOf(t)}` : textOf(t));
   // Plain code beside a split diff: every unchanged line is in both halves, so pair the
   // plain code with the one half it matches best (never some lines to each half).
   const onlyCol = (cols: number[], c: number): Set<number> =>
      new Set(cols.map((k, i) => (k === c ? i : -1)).filter((i) => i >= 0));
   const pairWithin = (keepA: Set<number> | null, keepB: Set<number> | null): Array<[number, number]> => {
      const ia = ra.code.map((_, i) => i).filter((i) => !keepA || keepA.has(i));
      const ib = rb.code.map((_, j) => j).filter((j) => !keepB || keepB.has(j));
      return lcsPairs(
         ia.map((i) => keyOf(colA)(ra.code[i], i)),
         ib.map((j) => keyOf(colB)(rb.code[j], j))
      ).map(([x, y]) => [ia[x], ib[y]] as [number, number]);
   };
   /** Lines of the split side outside the half the plain code pairs with (none otherwise). */
   let offA = new Set<number>();
   let offB = new Set<number>();
   const bestHalf = (): Array<[number, number]> => {
      const aSplit = colA.includes(1);
      const bSplit = colB.includes(1);
      if (aSplit === bSplit) return pairWithin(null, null);
      const [l, r] = [0, 1].map((c) =>
         aSplit ? pairWithin(onlyCol(colA, c), null) : pairWithin(null, onlyCol(colB, c))
      );
      const other = r.length > l.length ? 0 : 1;
      if (aSplit) offA = onlyCol(colA, other);
      else offB = onlyCol(colB, other);
      return other === 0 ? r : l;
   };
   const linePairs = whole ? [] : bestHalf();
   // Changed lines (the unmatched ones between two matched anchors, zipped in order)
   // morph character by character instead of crossfading.
   const changed: Array<[number, number]> = [];
   const anchors: Array<[number, number]> = [[-1, -1], ...linePairs, [ra.code.length, rb.code.length]];
   for (let k = 0; !whole && k + 1 < anchors.length; k++) {
      const ia: number[] = [];
      const ib: number[] = [];
      for (let i = anchors[k][0] + 1; i < anchors[k + 1][0]; i++) {
         if (textOf(ra.code[i]).trim() && !offA.has(i)) ia.push(i);
      }
      for (let j = anchors[k][1] + 1; j < anchors[k + 1][1]; j++) {
         if (textOf(rb.code[j]).trim() && !offB.has(j)) ib.push(j);
      }
      for (const col of split ? [0, 1] : [0]) {
         const ca = split ? ia.filter((i) => colA[i] === col) : ia;
         const cb = split ? ib.filter((j) => colB[j] === col) : ib;
         for (let m = 0; m < Math.min(ca.length, cb.length); m++) {
            changed.push([ca[m], cb[m]]);
         }
      }
   }
   pairUp(ra.code, rb.code, linePairs, new Set(changed.map((x) => x[0])), new Set(changed.map((x) => x[1])));
   // Per changed line, each paired character's x and its (A minus B) shift, so a word-level
   // diff highlight can travel with the characters it sits under.
   type CharShift = { x: number; shift: { dx: number; dy: number } | null };
   const charsA = new Map<number, CharShift[]>();
   const charsB = new Map<number, CharShift[]>();
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
      const listA: CharShift[] = ca.map((c) => ({ x: c.x, shift: null }));
      const listB: CharShift[] = cb.map((c) => ({ x: c.x, shift: null }));
      for (const [x, y] of cp) {
         const g = place(b, cb[y].el, []);
         const shift = codeShift(ctx, ca[x], cb[y]);
         out.moves.push({ el: g, ...shift });
         listA[x].shift = shift;
         listB[y].shift = shift;
      }
      charsA.set(i, listA);
      charsB.set(j, listB);
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
   // Diff decorations (row highlight bands, +/- signs) belong to a row: they travel with
   // that row's code (fading as they go) rather than appearing at their end position.
   const partnerAB = new Map<number, number>();
   const partnerBA = new Map<number, number>();
   for (const [i, j] of [...linePairs, ...changed]) {
      partnerAB.set(i, j);
      partnerBA.set(j, i);
   }
   const box = (el: Element): { x: number; y: number; w: number } | null => {
      const n = (k: string): number => Number(el.getAttribute(k)) || 0;
      if (el.tagName === 'rect') return { x: n('x'), y: n('y') + n('height') / 2, w: n('width') };
      return el.tagName === 'text' ? { x: n('x'), y: n('y'), w: 0 } : null;
   };
   const lineWidth = (t: SVGTextElement): number => {
      try {
         return t.getComputedTextLength();
      } catch {
         return textOf(t).length * (Number(t.getAttribute('font-size')) || 14) * 0.6;
      }
   };
   /**
    * The (A minus B) shift a diff decoration should travel by: that of the code line on its
    * row and column (a split view has two lines per row), by character for a word-level
    * highlight on a changed line. A line that fades in place takes its decorations with it;
    * a row with no code (a filler gap) moves with the nearest partnered row in its column.
    */
   const rowShift = (
      el: Element,
      mine: SVGTextElement[],
      partner: Map<number, number>,
      theirs: SVGTextElement[],
      chars: Map<number, CharShift[]>,
      fromA: boolean,
      cols: number[],
      extras: Element[]
   ): { dx: number; dy: number } | null => {
      const b0 = box(el);
      if (!b0 || !mine.length) return null;
      const size = Number(mine[0].getAttribute('font-size')) || 14;
      // A line's baseline sits a little below its row's centre.
      const baseline = el.tagName === 'text' ? b0.y : b0.y + size * 0.36;
      // Which column the decoration is in: a split's right half starts one gutter left of
      // its code (the gutter being how far the left column's code sits from the card edge).
      const starts = [...new Set(mine.map((t) => pos(t).x))].sort((x, y) => x - y);
      let column = 0;
      if (cols.includes(1)) {
         const edge = Math.min(starts[0], ...extras.map((e) => box(e)?.x ?? Number.POSITIVE_INFINITY));
         const rightHalf = starts[starts.length - 1] - (starts[0] - edge);
         column = b0.x >= rightHalf - 1 ? 1 : 0;
      }
      const rows = mine.map((t, i) => ({ i, dy: pos(t).y - baseline })).filter((c) => cols[c.i] === column);
      const sameRow = rows.filter((c) => Math.abs(c.dy) < size * 0.75);
      const shiftOf = (i: number): { dx: number; dy: number } => {
         const other = theirs[partner.get(i)!];
         return fromA ? codeShift(ctx, pos(mine[i]), pos(other)) : codeShift(ctx, pos(other), pos(mine[i]));
      };
      const line = sameRow[0];
      // A line that fades in place (no partner) takes its decorations with it: they fade too.
      if (line && !partner.has(line.i)) return null;
      if (line) {
         // A word highlight (narrower than its line) does what the characters under it do:
         // moves with them when most of them move, else fades in place as they do.
         const cs = chars.get(line.i);
         if (cs?.length && b0.w > 0 && b0.w < lineWidth(mine[line.i]) * 0.9) {
            const under = cs.filter((c) => c.x >= b0.x - 1 && c.x < b0.x + b0.w - 1);
            const moving = under.filter((c) => c.shift).map((c) => c.shift!);
            if (!under.length || moving.length * 2 < under.length) return null;
            return {
               dx: moving.reduce((t, m) => t + m.dx, 0) / moving.length,
               dy: moving.reduce((t, m) => t + m.dy, 0) / moving.length,
            };
         }
         return shiftOf(line.i);
      }
      // A row with no code in this column (a split's gray filler gap): the row is defined by
      // the line beside it in the other column, so it moves (or fades) with that line.
      if (cols.includes(1)) {
         const beside = mine.findIndex((t, i) => cols[i] !== column && Math.abs(pos(t).y - baseline) < size * 0.75);
         if (beside >= 0) return partner.has(beside) ? shiftOf(beside) : null;
      }
      // Otherwise (an empty line) move with the nearest partnered row.
      const near = rows.filter((c) => partner.has(c.i)).sort((m, n) => Math.abs(m.dy) - Math.abs(n.dy))[0];
      return near ? shiftOf(near.i) : null;
   };
   // Bands sit under the text: put them first in the layer.
   const before = layer.firstChild;
   for (const [side, list, into, fromA] of [
      [a, ra.extras, out.fadeOut, true],
      [b, rb.extras, out.fadeIn, false],
   ] as const) {
      for (const el of list) {
         const g = place(side, el, into);
         if (el.tagName !== 'text') {
            layer.insertBefore(g, before);
         }
         const shift = fromA
            ? rowShift(el, ra.code, partnerAB, rb.code, charsA, true, colA, ra.extras)
            : rowShift(el, rb.code, partnerBA, ra.code, charsB, false, colB, rb.extras);
         if (!shift) continue;
         if (fromA) {
            // Leaves with its row: from where it is toward the row's place on B.
            (out.outMoves ??= []).push({ el: g, dx: -shift.dx, dy: -shift.dy });
         } else {
            // Arrives with its row: from the row's place on A to where it ends up.
            out.moves.push({ el: g, dx: shift.dx, dy: shift.dy });
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
