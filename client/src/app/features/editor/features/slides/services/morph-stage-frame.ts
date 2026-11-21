import { blendGrid } from '../helpers/morph/morph-grid.helper';
import { type SeqPair } from '../helpers/morph/morph.model';
import {
   type CanvasElementModel,
   type LifelineModel,
   type SequenceDiagramModel,
   type SequenceMessageModel,
   type TableModel,
   matchLifelines,
   matchMessages,
} from '@devdesigner/shared';
import { buildDiagramSvg } from '../../../helpers/diagram-svg.helper';
import { safeSvgFragment } from '../helpers/svg-sanitize.helper';
import { blendElement, fadeIn, fadeOut, lerp, mixColor, walkBinding } from '../helpers/morph/morph-geometry.helper';
import type { MorphStage } from './morph-stage';

/** Per-frame update of the morph stage. */
export class MorphStageFrame {
   constructor(private readonly host: MorphStage) {}

   /** Pair the diagram parts of two sequence diagrams (participants, then messages). */
   pairSequence(da: SequenceDiagramModel, db: SequenceDiagramModel): SeqPair {
      const llA = this.host.fromSeq.lifelines.filter((l) => l.diagramId === da.id);
      const llB = this.host.toSeq.lifelines.filter((l) => l.diagramId === db.id);
      const msA = this.host.fromSeq.messages.filter((m) => m.diagramId === da.id);
      const msB = this.host.toSeq.messages.filter((m) => m.diagramId === db.id);
      const lp = matchLifelines(llA, llB, this.host.reversed);
      // Every matched message glides; an end that moved to another participant slides
      // there (see `ends` in blendSequences), so the arrow grows or shrinks.
      const messages = matchMessages(msA, msB, lp, llA, llB, this.host.reversed).map(
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

   /** Render the morph at progress `t` (0 = first slide, 1 = second), already eased. */
   update(t: number): void {
      this.host.lastT = t;
      this.host.animateRest(t);

      // Matched objects are re-rendered at their in-between state, in slide-local space.
      const elements: CanvasElementModel[] = [];
      for (const p of this.host.elementPairs) {
         const glyphs = this.host.glyphIds.has(p.b.id);
         if (glyphs && p.b.type === 'text') {
            continue;
         }
         let blended = blendElement(p.a.element!, p.b.element!, t, this.host.offA, this.host.offB);
         const ends = this.host.lineEndsOf.get(p);
         if (ends) {
            // Drawn ends glide from one slide's anchors to the other's (unbound while moving).
            const pts = ends.a.map((q, i) => ({ x: lerp(q.x, ends.b[i].x, t), y: lerp(q.y, ends.b[i].y, t) }));
            blended = {
               ...blended,
               x: pts[0].x,
               y: pts[0].y,
               points: pts.map((q) => ({ x: q.x - pts[0].x, y: q.y - pts[0].y })),
               startBinding: walkBinding(ends.start, t),
               endBinding: walkBinding(ends.end, t),
            };
         }
         const isCode = this.host.codes.some((c) => c.pair === p);
         const grid = this.host.grids.find((g) => g.pair === p);
         if (grid) {
            const pieces = blendGrid(this.host.ctx, grid, blended, t);
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
            const c = this.host.codes.find((x) => x.pair === p)!;
            c.clip.setAttribute('x', String(blended.x));
            c.clip.setAttribute('y', String(blended.y));
            c.clip.setAttribute('width', String(Math.max(0, blended.width)));
            c.clip.setAttribute('height', String(Math.max(0, blended.height)));
            c.clip.setAttribute('rx', String(blended.cornerRadius ?? 8));
         }
      }
      const tables: TableModel[] = this.host.tablePairs.map((p) => ({
         ...p.b.table!,
         x: lerp(p.a.table!.x - this.host.offA.x, p.b.table!.x - this.host.offB.x, t),
         y: lerp(p.a.table!.y - this.host.offA.y, p.b.table!.y - this.host.offB.y, t),
      }));
      const seq = this.host.seqPairs.length
         ? this.host.blendSequences(t)
         : { diagrams: [], lifelines: [], messages: [], smooth: false };
      if (elements.length || tables.length || seq.diagrams.length) {
         const body = buildDiagramSvg(
            tables,
            this.host.liveRels,
            elements,
            seq,
            { x: 0, y: 0, width: this.host.to.width, height: this.host.to.height, pageColor: this.host.to.pageColor },
            this.host.to.imageData
         )
            // Grid/code cards clip by `grid-clip-<id>` / `code-clip-<id>`; the hidden measure
            // copies (and the editor canvas) hold the same ids, and url(#…) picks the first,
            // so the live card would be clipped by a stale rect (lines and fills vanish).
            .body.replace(/\b(grid|code)-clip-/g, 'dd-morph-live-$1-clip-');
         this.host.live.replaceChildren(...safeSvgFragment(body));
      } else {
         this.host.live.replaceChildren();
      }
      this.host.restack();

      for (const c of [...this.host.codes, ...this.host.grids]) {
         for (const m of c.moves) {
            m.el.setAttribute('transform', `translate(${m.dx * (1 - t)} ${m.dy * (1 - t)})`);
         }
         for (const m of 'outMoves' in c ? (c.outMoves ?? []) : []) {
            m.el.setAttribute('transform', `translate(${m.dx * t} ${m.dy * t})`);
         }
         for (const g of c.fadeOut) {
            g.setAttribute('opacity', String(fadeOut(t)));
         }
         for (const g of c.fadeIn) {
            g.setAttribute('opacity', String(fadeIn(t)));
         }
      }

      for (const c of this.host.chars) {
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
}
