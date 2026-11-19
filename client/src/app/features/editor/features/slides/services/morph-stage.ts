import { buildGridMorph } from '../helpers/morph/morph-grid.helper';
import { buildCodeMorph } from '../helpers/morph/morph-code.helper';
import { blendGrid } from '../helpers/morph/morph-grid.helper';
import type { Side } from '../helpers/morph/morph.model';
import { SVG_NS } from '../helpers/morph/morph.model';
import type { MorphContext } from '../helpers/morph/morph.model';
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
   matchLifelines,
   matchMessages,
   matchMorphItems,
   morphMode,
   onlyYourPairs,
   transitionMorphs,
} from '@devdesigner/shared';
import { type SequenceBox, buildDiagramSvg, sequenceBounds } from '../../../helpers/diagram-svg.helper';
import { safeSvgFragment, sanitizeSvgDom } from '../helpers/svg-sanitize.helper';
import { lineEnds } from '../../../helpers/render';
import { type RotatedBox, elementBox, tableBox } from '../../../helpers/element-geometry.helper';
import type { RenderedSlide, SlideItem } from './slide-render.service';
import type { CodeMorph, GridMorph, Offset, Pair, SeqPair, SeqTextJob } from '../helpers/morph/morph.model';
import {
   TRAVEL,
   type Walk,
   blendElement,
   fadeIn,
   fadeOut,
   isStockHeader,
   lerp,
   mixColor,
   mixOptionalColor,
   outlineAngle,
   walkBinding,
} from '../helpers/morph/morph-geometry.helper';
import { type CharMove, type Glyph, matchGlyphs, readGlyphs } from '../helpers/morph/morph-text.helper';
import { codeShown } from '../helpers/morph/morph-code.helper';

const GRID_ID = 'dd-export-grid';

/** Longest text (in characters) that is morphed glyph by glyph; longer just cross-fades. */
const MAX_CHAR_MORPH = 360;

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
   /** Paired bound lines: their drawn points on each slide (slide-local), glided between. */
   private readonly lineEndsOf = new Map<
      Pair,
      { a: PointModel[]; b: PointModel[]; start: Walk | null; end: Walk | null }
   >();
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
   /** What the code and grid morph builders read from this stage (live: set in the constructor). */
   private readonly ctx = this.context();
   private readonly liveRels: RelationshipModel[] = [];
   /**
    * Objects on only one slide, with their slide's stacking order: each frame they are
    * slotted into the live layer between the morphing objects, so an object on top
    * on its slide stays on top during the transition (not under every morphing one).
    */
   private readonly stackZ = new Map<SVGGElement, { side: 'a' | 'b'; z: number }>();
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
   private readonly tr: RenderedSlide['transition'];
   /** Objects on both slides morph (off: everything moves with the slide as pictures). */
   private readonly morphOn: boolean;
   /** How the rest of the slide (background, one-slide objects) changes. */
   private readonly restType: SlideTransitionType;
   private readonly bgA = document.createElementNS(SVG_NS, 'g');

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
   private addGlyphMoves(layer: SVGGElement, ga: Glyph[], gb: Glyph[], by: MorphBy = this.by): void {
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
            this.addGlyphMoves(layer, glyphs[0], glyphs[1], this.byFor(p));
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
            this.addGlyphMoves(layer, glyphs[0], glyphs[1], this.byFor(gm.pair));
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

   /**
    * Slot one-slide objects and code/grid line layers into the live layer by stacking
    * order (the incoming slide's, with outgoing objects placed just above the morphing
    * object that sat under them on their slide).
    */
   private restack(): void {
      const pairs = this.elementPairs.filter((p) => p.a.element && p.b.element);
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
      for (const [node, st] of this.stackZ) extra.push({ node, z: st.side === 'b' ? st.z : toB(st.z) });
      for (const c of [...this.codes, ...this.grids]) {
         extra.push({ node: c.layer, z: c.pair.b.element!.zIndex + 0.5 });
      }
      if (!extra.length) return;
      const slots = Array.from(this.live.children).flatMap((ch) => {
         const id = ch.getAttribute('data-eid');
         const z = id ? zB.get(id) : undefined;
         return z === undefined ? [] : [{ ch, z }];
      });
      extra.sort((x, y) => x.z - y.z);
      if (!slots.length) {
         // Nothing live to slot between (e.g. every pair is glyph-morphed text): the extras
         // were detached when the live layer was rebuilt, so put them back above it in
         // stacking order, or they'd vanish mid-morph and pop in at the end.
         let prev: Element = this.live;
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

   /** Per-object "animate by" (set on the later slide), else the transition's. */
   private byFor(p: Pair): MorphBy {
      return this.tr.morphByItems?.[this.reversed ? p.a.id : p.b.id] ?? this.by;
   }

   /**
    * The slide around the morphing objects (background, objects on one slide only, the
    * rest) changes the way the transition type says: fade, slide, zoom, or a cut.
    */
   private animateRest(t: number): void {
      const W = this.to.width;
      const H = this.to.height;
      const forward = !this.reversed;
      const sideA: SVGGElement[] = [this.bgA as SVGGElement, this.restA, ...this.outgoing];
      const sideB: SVGGElement[] = [this.bgB as SVGGElement, this.restB, ...this.incoming];
      const set = (els: SVGGElement[], opacity: (g: SVGGElement) => number, transform: string | null): void => {
         for (const g of els) {
            g.setAttribute('opacity', String(opacity(g)));
            if (transform) g.setAttribute('transform', transform);
            else g.removeAttribute('transform');
         }
      };
      if (this.restType === 'slide') {
         const base = TRAVEL[this.tr.direction ?? 'left'] ?? TRAVEL['left'];
         const [dx, dy] = forward ? base : [-base[0], -base[1]];
         set(sideA, () => 1, `translate(${dx * W * t} ${dy * H * t})`);
         set(sideB, () => 1, `translate(${-dx * W * (1 - t)} ${-dy * H * (1 - t)})`);
         return;
      }
      if (this.restType === 'zoom') {
         const about = (k: number): string => `translate(${W / 2} ${H / 2}) scale(${k}) translate(${-W / 2} ${-H / 2})`;
         const out = forward ? 1.4 : 0.6;
         const inn = forward ? 0.6 : 1.4;
         set(sideA, (g) => (g === this.bgA ? 1 : 1 - t), about(1 + (out - 1) * t));
         set(sideB, () => t, about(inn + (1 - inn) * t));
         return;
      }
      if (this.restType === 'none') {
         set(sideA, (g) => (g === this.bgA ? 1 : t > 0 ? 0 : 1), null);
         set(sideB, () => (t > 0 ? 1 : 0), null);
         return;
      }
      // fade (and morph)
      set([this.bgA as SVGGElement], () => 1, null);
      set([this.bgB as SVGGElement], () => fadeIn(t), null);
      set([this.restA], () => fadeOut(t), null);
      set([this.restB], () => fadeIn(t), null);
      set(this.outgoing, (g) => (this.cutOut.has(g) ? (t > 0 ? 0 : 1) : 1 - t), null);
      set(this.incoming, (g) => (this.cutIn.has(g) ? (t > 0 ? 1 : 0) : t), null);
   }

   /** Render the morph at progress `t` (0 = first slide, 1 = second), already eased. */
   update(t: number): void {
      this.lastT = t;
      this.animateRest(t);

      // Matched objects are re-rendered at their in-between state, in slide-local space.
      const elements: CanvasElementModel[] = [];
      for (const p of this.elementPairs) {
         const glyphs = this.glyphIds.has(p.b.id);
         if (glyphs && p.b.type === 'text') {
            continue;
         }
         let blended = blendElement(p.a.element!, p.b.element!, t, this.offA, this.offB);
         const ends = this.lineEndsOf.get(p);
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
         const isCode = this.codes.some((c) => c.pair === p);
         const grid = this.grids.find((g) => g.pair === p);
         if (grid) {
            const pieces = blendGrid(this.ctx, grid, blended, t);
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
      this.restack();

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
            scale: lerp(da.scale ?? 1, db.scale ?? 1, t),
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
}
