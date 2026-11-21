import { type Offset, SVG_NS } from '../helpers/morph/morph.model';
import {
   type LifelineModel,
   type MorphBy,
   type SequenceDiagramModel,
   type SequenceMessageModel,
} from '@devdesigner/shared';
import { type SequenceBox, sequenceBounds } from '../../../helpers/diagram-svg.helper';
import { TRAVEL, fadeIn, fadeOut, isStockHeader, lerp, mixOptionalColor } from '../helpers/morph/morph-geometry.helper';
import { type Glyph, matchGlyphs, readGlyphs } from '../helpers/morph/morph-text.helper';
import { MAX_CHAR_MORPH } from './morph-stage.helpers';
import type { MorphStage } from './morph-stage';

/** Sequence blending, glyph moves and restacking for the morph stage. */
export class MorphStageBlend {
   constructor(private readonly host: MorphStage) {}

   /**
    * Animate one piece of text from `ga` to `gb`: paired glyphs glide, the rest fade
    * out / in while riding along with the text block's overall movement.
    */
   addGlyphMoves(layer: SVGGElement, ga: Glyph[], gb: Glyph[], by: MorphBy = this.host.by): void {
      const matched = matchGlyphs(ga, gb, by);
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
         this.host.chars.push({ el: make(ga[i]), a: ga[i], b: gb[j], dx, dy });
      }
      ga.forEach((g, i) => {
         if (!usedA.has(i)) {
            this.host.chars.push({ el: make(g), a: g, b: null, dx, dy });
         }
      });
      gb.forEach((g, j) => {
         if (!usedB.has(j)) {
            this.host.chars.push({ el: make(g), a: null, b: g, dx, dy });
         }
      });
   }

   /**
    * Changed text between matched text elements is morphed glyph by glyph:
    * characters present in both slides slide to their new place, new ones fade in,
    * removed ones fade out. Needs the stage attached to the document (glyph
    * positions are measured from the real layout), so call it right after append.
    */
   async prepare(): Promise<void> {
      const measure = this.host.measure;
      if (!measure && !this.host.grids.some((g) => g.changed.length)) {
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
            ga = ta ? readGlyphs(ta, this.host.offA) : null;
            gb = tb ? readGlyphs(tb, this.host.offB) : null;
         } catch (err) {
            console.warn('morph: could not measure text', err);
         }
         if (!ga || !gb || ga.length > MAX_CHAR_MORPH || gb.length > MAX_CHAR_MORPH) {
            return null;
         }
         return [ga, gb];
      };
      for (const p of this.host.textPairs()) {
         const glyphs = read(() => {
            const find = (side: 'a' | 'b', id: string): SVGTextElement | null =>
               measure?.querySelector(`g[data-side="${side}"][data-id="${CSS.escape(id)}"] text`) ?? null;
            return [find('a', p.a.id), find('b', p.b.id)];
         });
         if (glyphs) {
            this.addGlyphMoves(layer, glyphs[0], glyphs[1], this.host.byFor(p));
            this.host.glyphIds.add(p.b.id);
         }
      }
      // Grid cells whose text changed in place.
      for (const gm of this.host.grids) {
         for (const c of gm.changed) {
            const glyphs = read(() => [c.a.querySelector('text'), c.b.querySelector('text')]);
            if (!glyphs) {
               continue; // stays a cross-fade
            }
            this.addGlyphMoves(layer, glyphs[0], glyphs[1], this.host.byFor(gm.pair));
            c.a.remove();
            c.b.remove();
         }
      }
      // Sequence text: titles, participant names and message wording.
      for (const job of this.host.seqTexts) {
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
         (job.kind === 'title'
            ? this.host.hideTitle
            : job.kind === 'lifeline'
              ? this.host.hideLl
              : this.host.hideMsg
         ).add(job.bId);
      }
      measure?.remove();
      this.host.measure = null;
      if (this.host.chars.length) {
         this.host.svg.appendChild(layer);
         this.host.charLayer = layer;
      }
      this.host.update(this.host.lastT);
   }

   /**
    * Slot one-slide objects and code/grid line layers into the live layer by stacking
    * order (the incoming slide's, with outgoing objects placed just above the morphing
    * object that sat under them on their slide).
    */
   restack(): void {
      const pairs = this.host.elementPairs.filter((p) => p.a.element && p.b.element);
      if (!pairs.length) return;
      const zB = new Map<string, number>();
      for (const p of pairs) {
         zB.set(p.a.id, p.b.element!.zIndex);
         zB.set(p.b.id, p.b.element!.zIndex);
      }
      const byA = pairs.map((p) => ({ a: p.a.element!.zIndex, b: p.b.element!.zIndex })).sort((x, y) => x.a - y.a);
      const toB = (z: number): number => {
         let out = -Infinity;
         for (const q of byA) if (q.a < z) out = q.b + 0.25;
         return out;
      };
      const extra: Array<{ node: SVGGElement; z: number }> = [];
      for (const [node, st] of this.host.stackZ) extra.push({ node, z: st.side === 'b' ? st.z : toB(st.z) });
      for (const c of [...this.host.codes, ...this.host.grids]) {
         extra.push({ node: c.layer, z: c.pair.b.element!.zIndex + 0.5 });
      }
      if (!extra.length) return;
      const slots = Array.from(this.host.live.children).flatMap((ch) => {
         const id = ch.getAttribute('data-eid');
         const z = id ? zB.get(id) : undefined;
         return z === undefined ? [] : [{ ch, z }];
      });
      extra.sort((x, y) => x.z - y.z);
      if (!slots.length) {
         // Nothing live to slot between (e.g. every pair is glyph-morphed text): the extras
         // were detached when the live layer was rebuilt, so put them back above it in
         // stacking order, or they'd vanish mid-morph and pop in at the end.
         let prev: Element = this.host.live;
         for (const e of extra) {
            prev.after(e.node);
            prev = e.node;
         }
         return;
      }
      for (const e of extra) {
         const next = slots.find((sl) => sl.z > e.z);
         if (next) next.ch.before(e.node);
         else slots[slots.length - 1].ch.after(e.node);
         // Later extras with the same z go above this one.
         slots.push({ ch: e.node, z: e.z });
         slots.sort((x, y) => x.z - y.z);
      }
   }

   /**
    * The slide around the morphing objects (background, objects on one slide only, the
    * rest) changes the way the transition type says: fade, slide, zoom, or a cut.
    */
   animateRest(t: number): void {
      const W = this.host.to.width;
      const H = this.host.to.height;
      const forward = !this.host.reversed;
      const sideA: SVGGElement[] = [this.host.bgA as SVGGElement, this.host.restA, ...this.host.outgoing];
      const sideB: SVGGElement[] = [this.host.bgB as SVGGElement, this.host.restB, ...this.host.incoming];
      const set = (els: SVGGElement[], opacity: (g: SVGGElement) => number, transform: string | null): void => {
         for (const g of els) {
            g.setAttribute('opacity', String(opacity(g)));
            if (transform) g.setAttribute('transform', transform);
            else g.removeAttribute('transform');
         }
      };
      if (this.host.restType === 'slide') {
         const base = TRAVEL[this.host.tr.direction ?? 'left'] ?? TRAVEL['left'];
         const [dx, dy] = forward ? base : [-base[0], -base[1]];
         set(sideA, () => 1, `translate(${dx * W * t} ${dy * H * t})`);
         set(sideB, () => 1, `translate(${-dx * W * (1 - t)} ${-dy * H * (1 - t)})`);
         return;
      }
      if (this.host.restType === 'zoom') {
         const about = (k: number): string => `translate(${W / 2} ${H / 2}) scale(${k}) translate(${-W / 2} ${-H / 2})`;
         const out = forward ? 1.4 : 0.6;
         const inn = forward ? 0.6 : 1.4;
         set(sideA, (g) => (g === this.host.bgA ? 1 : 1 - t), about(1 + (out - 1) * t));
         set(sideB, () => t, about(inn + (1 - inn) * t));
         return;
      }
      if (this.host.restType === 'none') {
         set(sideA, (g) => (g === this.host.bgA ? 1 : t > 0 ? 0 : 1), null);
         set(sideB, () => (t > 0 ? 1 : 0), null);
         return;
      }
      // fade (and morph)
      set([this.host.bgA as SVGGElement], () => 1, null);
      set([this.host.bgB as SVGGElement], () => fadeIn(t), null);
      set([this.host.restA], () => fadeOut(t), null);
      set([this.host.restB], () => fadeIn(t), null);
      set(this.host.outgoing, (g) => (this.host.cutOut.has(g) ? (t > 0 ? 0 : 1) : 1 - t), null);
      set(this.host.incoming, (g) => (this.host.cutIn.has(g) ? (t > 0 ? 1 : 0) : t), null);
   }

   /**
    * The live sequence diagrams at progress `t`, in slide-local coordinates.
    * Participants and messages that are on both slides glide (rows and columns
    * interpolate, colors blend); ones on only one slide fade out or in where they
    * are, and the box grows or shrinks between the two boxes. Text that changes is
    * left out here when the glyph layer animates it.
    */
   blendSequences(t: number): {
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
      const offA = this.host.offA;
      const offB = this.host.offB;
      const row = (m: SequenceMessageModel, d: SequenceDiagramModel): number =>
         Math.max(1, Math.round((m.y - (d.originY + d.headerHeight)) / d.rowSpacing));
      const shifted = (b: SequenceBox, off: Offset): SequenceBox => ({
         x0: b.x0 - off.x,
         y0: b.y0 - off.y,
         x1: b.x1 - off.x,
         y1: b.y1 - off.y,
      });

      for (const p of this.host.seqPairs) {
         const { a: da, b: db } = p;
         const originY = lerp(da.originY - offA.y, db.originY - offB.y, t);
         const headerHeight = lerp(da.headerHeight, db.headerHeight, t);
         const rowSpacing = lerp(da.rowSpacing, db.rowSpacing, t);
         diagrams.push({
            ...db,
            originY,
            headerHeight,
            rowSpacing,
            scale: lerp(da.scale ?? 1, db.scale ?? 1, t),
            lifelineSpacing: lerp(da.lifelineSpacing, db.lifelineSpacing, t),
            backgroundColor: mixOptionalColor(da.backgroundColor, db.backgroundColor, t),
            title: t < 0.5 ? da.title : db.title,
         });
         const hb = originY + headerHeight;

         const boxA = sequenceBounds(da, this.host.fromSeq.lifelines, this.host.fromSeq.messages);
         const boxB = sequenceBounds(db, this.host.toSeq.lifelines, this.host.toSeq.messages);
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
         hideText: { messages: this.host.hideMsg, lifelines: this.host.hideLl, titles: this.host.hideTitle },
         themeHeaderText,
         boxes,
         ends,
      };
   }
}
