import { buildGridMorph } from '../helpers/morph/morph-grid.helper';
import { buildCodeMorph, codeShown } from '../helpers/morph/morph-code.helper';
import {
   type CodeMorph,
   type GridMorph,
   type MorphContext,
   type Offset,
   type Pair,
   SVG_NS,
   type SeqPair,
   type SeqTextJob,
   type Side,
} from '../helpers/morph/morph.model';
import {
   type CanvasElementModel,
   type ElementBinding,
   type LifelineModel,
   type MorphBy,
   type PointModel,
   type RelationshipModel,
   type SequenceDiagramModel,
   type SequenceMessageModel,
   type SlideTransitionType,
   type TableModel,
   matchDiagrams,
   matchMorphItems,
   morphMode,
   onlyYourPairs,
   transitionMorphs,
} from '@devdesigner/shared';
import { type SequenceBox } from '../../../helpers/diagram-svg.helper';
import { lineEnds } from '../../../helpers/render';
import { type RotatedBox, elementBox, tableBox } from '../../../helpers/element-geometry.helper';
import type { RenderedSlide, SlideItem } from './slide-render.service';
import { type Walk, outlineAngle } from '../helpers/morph/morph-geometry.helper';
import { type CharMove } from '../helpers/morph/morph-text.helper';
import { GRID_ID, parse } from './morph-stage.helpers';
import { MorphStageBlend } from './morph-stage-blend';
import { MorphStageFrame } from './morph-stage-frame';

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
   /** Methods moved to morph-stage-frame.ts. */
   private readonly morphStageFrame = new MorphStageFrame(this);

   /** Methods moved to morph-stage-blend.ts. */
   private readonly morphStageBlend = new MorphStageBlend(this);

   readonly svg: SVGSVGElement;
   readonly to: RenderedSlide;
   readonly offA: Offset;
   readonly offB: Offset;
   readonly elementPairs: Pair[] = [];
   /** Paired bound lines: their drawn points on each slide (slide-local), glided between. */
   readonly lineEndsOf = new Map<Pair, { a: PointModel[]; b: PointModel[]; start: Walk | null; end: Walk | null }>();
   readonly tablePairs: Pair[] = [];
   readonly codes: CodeMorph[] = [];
   readonly grids: GridMorph[] = [];
   readonly seqPairs: SeqPair[] = [];
   readonly fromSeq: RenderedSlide['sequences'];
   readonly toSeq: RenderedSlide['sequences'];
   /** What morphed text animates by: whole objects, words, or characters. */
   readonly by: MorphBy;
   /** Sequence text whose wording changes (animated glyph by glyph once measured). */
   readonly seqTexts: SeqTextJob[] = [];
   /** Slide-B ids of messages / participants / diagram titles drawn by the glyph layer. */
   readonly hideMsg = new Set<string>();
   readonly hideLl = new Set<string>();
   readonly hideTitle = new Set<string>();
   private codeSeq = 0;
   /** What the code and grid morph builders read from this stage (live: set in the constructor). */
   readonly ctx = this.context();
   readonly liveRels: RelationshipModel[] = [];
   /**
    * Objects on only one slide, with their slide's stacking order: each frame they are
    * slotted into the live layer between the morphing objects, so an object on top
    * on its slide stays on top during the transition (not under every morphing one).
    */
   readonly stackZ = new Map<SVGGElement, { side: 'a' | 'b'; z: number }>();
   readonly outgoing: SVGGElement[] = [];
   readonly incoming: SVGGElement[] = [];
   /** Unpaired objects set to "no transition": they switch instantly instead of fading. */
   readonly cutOut = new Set<SVGGElement>();
   readonly cutIn = new Set<SVGGElement>();
   readonly restA = document.createElementNS(SVG_NS, 'g');
   readonly restB = document.createElementNS(SVG_NS, 'g');
   readonly live = document.createElementNS(SVG_NS, 'g');
   readonly bgB = document.createElementNS(SVG_NS, 'g');
   /** Text pairs drawn glyph by glyph (by slide-B id) instead of through the live scene. */
   readonly glyphIds = new Set<string>();
   readonly chars: CharMove[] = [];
   charLayer: SVGGElement | null = null;
   /** Hidden static copies of changed text, kept only so their glyphs can be measured. */
   measure: SVGGElement | null = null;
   lastT = 0;
   readonly reversed: boolean;
   readonly tr: RenderedSlide['transition'];
   /** Objects on both slides morph (off: everything moves with the slide as pictures). */
   private readonly morphOn: boolean;
   /** How the rest of the slide (background, one-slide objects) changes. */
   readonly restType: SlideTransitionType;
   readonly bgA = document.createElementNS(SVG_NS, 'g');

   /**
    * `reversed`: the transition plays backwards (`from` is the later slide), so the tag
    * rules mirror the forward ones: whatever could morph forward unanimates the same way.
    */
   constructor(from: RenderedSlide, to: RenderedSlide, reversed = false) {
      this.reversed = reversed;
      this.to = to;
      // The transition belongs to the later slide (the one being entered going forward).
      const tr = reversed ? from.transition : to.transition;
      this.tr = tr;
      this.by = tr.morphBy ?? 'character';
      this.morphOn = transitionMorphs(tr);
      this.restType = tr.type === 'morph' ? 'fade' : tr.type;
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

      const bgA = this.bgA;
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
      const auto = this.morphOn
         ? matchMorphItems(fromItems, toItems, undefined, this.reversed, {
              width: this.to.width,
              height: this.to.height,
           })
         : [];
      // Fade / slide / zoom morph only the pairs you made; Auto pairs look-alikes too.
      for (const [i, j] of morphMode(tr) === 'mine' ? onlyYourPairs(fromItems, toItems, auto, this.reversed) : auto) {
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

      // Bound lines/arrows: each side's ends as drawn on its own slide (an automatic
      // anchor has no stored spot, so blending bindings would start from the shape's
      // center and snap). The morph glides between these drawn ends instead.
      const boxesOf = (slide: RenderedSlide) => {
         const els = new Map<string, CanvasElementModel>();
         const tbs = new Map<string, TableModel>();
         for (const it of slide.items) {
            if (it.element) els.set(it.id, it.element);
            if (it.table) tbs.set(it.id, it.table);
         }
         return (bd: ElementBinding): RotatedBox | null => {
            if (bd.targetKind === 'table') {
               const tb = tbs.get(bd.targetId);
               return tb ? tableBox(tb) : null;
            }
            const e = bd.targetKind === 'element' ? els.get(bd.targetId) : undefined;
            return e ? { ...elementBox(e), angle: e.angle } : null;
         };
      };
      const boxA = boxesOf(from);
      const morphedB = new Set(this.elementPairs.map((q) => q.b.id));
      const boxB = boxesOf(to);
      for (const p of this.elementPairs) {
         const ea = p.a.element!;
         const eb = p.b.element!;
         const isLine = (e: CanvasElementModel): boolean => e.type === 'line' || e.type === 'arrow';
         if (!isLine(ea) || !isLine(eb) || !(ea.startBinding || ea.endBinding || eb.startBinding || eb.endBinding)) {
            continue;
         }
         const wa = lineEnds(ea, boxA);
         const wb = lineEnds(eb, boxB);
         const pa = wa.map((q) => ({ x: q.x - this.offA.x, y: q.y - this.offA.y }));
         const pb = wb.map((q) => ({ x: q.x - this.offB.x, y: q.y - this.offB.y }));
         if (pa.length !== pb.length || pa.length < 2) continue;
         // An end bound on both slides to a shape that itself morphs walks around that
         // shape's outline (by angle in the shape's own frame) as both move, so it never
         // crosses the shape. Other ends glide straight between their drawn spots.
         const walk = (
            ba: ElementBinding | undefined,
            bb: ElementBinding | undefined,
            ptA: PointModel,
            ptB: PointModel
         ): Walk | null => {
            if (!ba || !bb || bb.targetKind !== 'element' || !morphedB.has(bb.targetId)) return null;
            const boxa = boxA(ba);
            const boxb = boxB(bb);
            if (!boxa || !boxb) return null;
            return { binding: bb, from: outlineAngle(boxa, ptA), to: outlineAngle(boxb, ptB) };
         };
         const n = wa.length - 1;
         this.lineEndsOf.set(p, {
            a: pa,
            b: pb,
            start: walk(ea.startBinding, eb.startBinding, wa[0], wb[0]),
            end: walk(ea.endBinding, eb.endBinding, wa[n], wb[n]),
         });
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
      for (const [i, j] of (this.morphOn
         ? matchDiagrams(
              diagramsA.map((d) => like(from.sequences, d)),
              diagramsB.map((d) => like(to.sequences, d)),
              this.reversed
           )
         : []
      ).filter(
         // Outside Auto, a diagram morphs only when you tagged both ends alike.
         ([i, j]) =>
            morphMode(this.tr) === 'auto' ||
            (!!diagramsA[i].morphId?.startsWith('tag:') && diagramsA[i].morphId === diagramsB[j].morphId)
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
            // An extra group around the shell takes the slide-level motion (slide / zoom).
            const inner = shell(side);
            inner.appendChild(document.importNode(side.items.get(item.id)!, true));
            const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
            g.appendChild(inner);
            svg.appendChild(g);
            into.push(g);
            // Arrows and lines too: one pointing into a morphing grid/table must stay above it.
            if (item.element && item.element.type !== 'frame') {
               this.stackZ.set(g, { side: into === this.outgoing ? 'a' : 'b', z: item.element.zIndex });
            }
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
            const code = buildCodeMorph(this.ctx, p, a, b, shell);
            if (code) {
               this.codes.push(code);
            }
         }
         if (p.a.type === 'grid' && p.b.type === 'grid') {
            const grid = buildGridMorph(this.ctx, p, a, b, shell);
            if (grid) {
               this.grids.push(grid);
            }
         }
      }
      this.update(0);
   }

   textPairs(): Pair[] {
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

   /** Per-object "animate by" (set on the later slide), else the transition's. */
   byFor(p: Pair): MorphBy {
      return this.tr.morphByItems?.[this.reversed ? p.a.id : p.b.id] ?? this.by;
   }

   /** Number of objects that glide between the slides (0 = it is just a cross-fade). */
   get pairedCount(): number {
      return this.elementPairs.length + this.tablePairs.length + this.seqPairs.length;
   }

   private context(): MorphContext {
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- the getters read fields the constructor sets later
      const stage = this;
      return {
         get svg() {
            return stage.svg;
         },
         get offA() {
            return stage.offA;
         },
         get offB() {
            return stage.offB;
         },
         get reversed() {
            return stage.reversed;
         },
         nextClipId: () => (this.codeSeq += 1),
         byFor: (p) => this.byFor(p),
      };
   }

   dispose(): void {
      this.charLayer?.remove();
      this.svg.remove();
   }

   // ---- delegates to morph-stage-blend.ts ----
   prepare(): Promise<void> {
      return this.morphStageBlend.prepare();
   }
   restack(): void {
      return this.morphStageBlend.restack();
   }
   animateRest(t: number): void {
      return this.morphStageBlend.animateRest(t);
   }
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
      return this.morphStageBlend.blendSequences(t);
   }

   // ---- delegates to morph-stage-frame.ts ----
   private pairSequence(da: SequenceDiagramModel, db: SequenceDiagramModel): SeqPair {
      return this.morphStageFrame.pairSequence(da, db);
   }
   update(t: number): void {
      return this.morphStageFrame.update(t);
   }
}
