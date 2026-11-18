import { placeholderGhosts } from '../../../helpers/layout-placeholders';
import { Injectable, inject } from '@angular/core';
import {
   effectiveTransition,
   hiddenAtStep,
   parseGrid,
   planAnimations,
   slideAnimations,
   slideMorphKey,
   type AnimationPlan,
   type CanvasElementModel,
   type MorphItem,
   type LifelineModel,
   type RelationshipModel,
   type SequenceDiagramModel,
   type SequenceMessageModel,
   type SlideTransition,
   type TableModel,
   layoutOf,
   masterOf,
   presentableSlides,
   presentationOf,
   fieldContext,
   resolveFields,
   type FieldContext,
   resolveThemedElements,
   resolveThemedSequences,
   isEmbedUrl,
} from '@devdesigner/shared';
import { ElementImagesService } from '../../../services/element-images.service';
import { ProjectStore } from '../../../state/project/project.store';
import { elementBox, tableBox } from '../../../helpers/element-geometry.helper';
import { contentForFrame, sequenceDiagramBox } from '../../../helpers/frame-contents.helper';
import { buildDiagramSvg } from '../../../helpers/diagram-svg.helper';
import { imageView } from '../../../helpers/render';
import type { ImageView } from '../../../models/shape-view.model';
import { embedFonts } from '../../../helpers/font-embed.helper';

/** A grid's cell text in reading order, for morph matching (its `text` is JSON). */
function gridCellsText(text: string | undefined): string {
   return parseGrid(text)
      .cells.flat()
      .filter((c) => c.trim())
      .join(' ');
}

/** An element or table that appears on a slide, in slide-local coordinates. */
export interface SlideItem extends MorphItem {
   /** Matches the `data-eid` / `data-tid` tag on the item's group in the slide SVG. */
   id: string;
   /** Rotation in radians (0 for tables). */
   angle: number;
   /** The source model (world coordinates), used to re-draw the item mid-morph. */
   element?: CanvasElementModel;
   table?: TableModel;
}

/** One slide, rendered to a self-contained vector image plus what a morph needs. */
export interface RenderedSlide {
   /** The frame this slide shows. */
   id: string;
   name: string;
   width: number;
   height: number;
   /** Top-left of the frame in canvas world coordinates (for mapping lasers). */
   originX: number;
   originY: number;
   /** The slide with every object shown (thumbnails, export). */
   svg: string;
   /**
    * Animation groups on the slide (0 = none). Step 0 is the slide before anything has
    * played, step k the state after the k-th group; when the first group has no click it
    * plays by itself as soon as the slide appears.
    */
   maxStep: number;
   /** One SVG per step 0..maxStep; empty when there are no animations. */
   stepSvgs: string[];
   /**
    * `mixSvgs[k]` (k >= 1) shows everything visible before OR after group k, the picture
    * the changing objects are animated on while moving from step k-1 to k.
    */
   mixSvgs: string[];
   /** Ids hidden at each step (index = step). */
   hiddenByStep: ReadonlyArray<ReadonlySet<string>>;
   plan: AnimationPlan;
   /** relationship id -> its two tables, so connectors follow their tables' animations. */
   relationshipEnds: ReadonlyMap<string, [string, string]>;
   background: string;
   /** The slide's own fill (what its items' colors are kept readable against). */
   pageColor?: string;
   notes: string;
   /** The transition into this slide. */
   transition: SlideTransition;
   /** GIFs and videos on the slide, played live over the slide picture while presenting. */
   media: SlideMedia[];
   items: SlideItem[];
   /** Relationships and image data the slide draws with (for live morph rendering). */
   relationships: RelationshipModel[];
   /** Sequence diagrams that overlap the slide (world coordinates). */
   sequences: {
      diagrams: SequenceDiagramModel[];
      lifelines: LifelineModel[];
      messages: SequenceMessageModel[];
   };
   imageData: ReadonlyMap<string, string>;
}

/** A GIF or video on a slide, placed in percent of the slide (so it scales with it). */
export interface SlideMedia {
   id: string;
   kind: 'gif' | 'video' | 'embed';
   /** The media file ('' for a live frame). */
   fileId: string;
   /** Live frames: the page's URL. */
   url?: string;
   /** Live frames: corner rounding as a CSS border-radius in % of the box (`x% / y%`). */
   radius?: string;
   left: number;
   top: number;
   width: number;
   height: number;
   /** Rotation in degrees about the box centre. */
   angle: number;
   opacity: number;
   /** The picture in its own box (crop, clip, playback). */
   view: ImageView;
}

/**
 * Renders frames of the open project into standalone SVG slides. Reuses the
 * image-export pipeline (so a slide matches the canvas and exports exactly),
 * cropped to the frame, and lists the items on each slide for morph matching.
 * Never touches project data.
 */
@Injectable({ providedIn: 'root' })
export class SlideRenderService {
   private readonly store = inject(ProjectStore);
   private readonly images = inject(ElementImagesService);

   /**
    * Render the given frames in order. `fonts` embeds web fonts (needed for display);
    * `ghosts` draws empty placeholders faded, as the editor shows them (thumbnails).
    */
   async render(
      frames: readonly CanvasElementModel[],
      /** `liveEmbeds`: presenting — live frames draw their plain card (the page loads over
       *  it), never a snapshot, which may not line up with what the page shows now. */
      options: { fonts: boolean; ghosts?: boolean; liveEmbeds?: boolean } = { fonts: true }
   ): Promise<RenderedSlide[]> {
      const allElements = options.liveEmbeds
         ? this.store.elements().map((e) => (e.type === 'embed' && e.fileId ? { ...e, fileId: undefined } : e))
         : this.store.elements();
      const allTables = this.store.tables();
      const relationships = this.store.relationships();
      const contents = frames.map((frame) =>
         contentForFrame(
            frame.id,
            !!frame.slide,
            allElements,
            allTables,
            this.store.sequenceDiagrams(),
            this.store.lifelines(),
            this.store.sequenceMessages(),
            layoutOf(frame, this.store.slideFrames())?.id,
            masterOf(frame, this.store.slideFrames())?.id
         )
      );
      // Only the pictures on the frames being rendered (shared by all of them, so a morph
      // between two of them can draw either side's images).
      const imageData = await this.imageData(contents.flatMap((c) => c.elements));
      const out: RenderedSlide[] = [];
      for (const [index, frame] of frames.entries()) {
         const mine = contents[index];
         const themed = resolveThemedElements(
            options.ghosts ? [...mine.elements, ...placeholderGhosts(frame.id, allElements).ghosts] : mine.elements,
            allElements
         );
         // Fields ({{slide}}, {{date}}, ...) fill in on slides; layouts keep the tokens.
         const ctx = frame.slide && !frame.slide.layout ? this.fieldsFor(frame) : null;
         const elements = ctx ? themed.map((e) => resolveFields(e, ctx)) : themed;
         const tables = mine.tables;
         const sequences = resolveThemedSequences(
            { diagrams: mine.diagrams, lifelines: mine.lifelines, messages: mine.messages },
            allElements
         );
         const crop = {
            x: frame.x,
            y: frame.y,
            width: frame.width,
            height: frame.height,
            frameId: frame.id,
         };
         const built = buildDiagramSvg(tables, relationships, elements, sequences, crop, imageData);
         const svg = options.fonts ? await embedFonts(built.svg) : built.svg;
         const items = this.itemsWithin(frame, elements, tables);

         // Animations: one picture per state (after each click group) plus, for each group, a
         // "mix" picture holding everything visible before OR after it, which the player
         // animates the changing objects on top of.
         const animations = slideAnimations(
            frame.slide,
            elements.filter((e) => e.type !== 'frame')
         );
         const targets = new Set<string>([
            ...elements.filter((e) => e.type !== 'frame').map((e) => e.id),
            ...tables.map((t) => t.id),
            ...sequences.diagrams.map((d) => d.id),
         ]);
         const plan = planAnimations(animations, targets);
         const maxStep = plan.groups.length;
         const hiddenByStep: Array<ReadonlySet<string>> = [];
         const stepSvgs: string[] = [];
         const mixSvgs: string[] = [''];
         if (maxStep > 0) {
            const cache = new Map<string, string>();
            const picture = async (hidden: ReadonlySet<string>): Promise<string> => {
               const key = [...hidden].sort().join('|');
               const hit = cache.get(key);
               if (hit !== undefined) {
                  return hit;
               }
               const v = buildDiagramSvg(
                  tables.filter((t) => !hidden.has(t.id)),
                  relationships,
                  elements.filter((e) => !hidden.has(e.id)),
                  {
                     diagrams: sequences.diagrams.filter((d) => !hidden.has(d.id)),
                     lifelines: sequences.lifelines.filter((l) => !hidden.has(l.diagramId)),
                     messages: sequences.messages.filter((m) => !hidden.has(m.diagramId)),
                  },
                  crop,
                  imageData
               );
               const markup = options.fonts ? await embedFonts(v.svg) : v.svg;
               cache.set(key, markup);
               return markup;
            };
            for (let k = 0; k <= maxStep; k += 1) {
               hiddenByStep.push(hiddenAtStep(plan, k));
               stepSvgs.push(await picture(hiddenByStep[k]));
            }
            for (let k = 1; k <= maxStep; k += 1) {
               const both = new Set([...hiddenByStep[k - 1]].filter((id) => hiddenByStep[k].has(id)));
               mixSvgs.push(await picture(both));
            }
         }
         out.push({
            originX: frame.x,
            originY: frame.y,
            maxStep,
            stepSvgs,
            mixSvgs,
            hiddenByStep,
            plan,
            relationshipEnds: this.relationshipEnds(relationships, tables),
            id: frame.id,
            // Slides are named by their place in the sequence.
            name: frame.slide ? `Slide ${index + 1}` : frame.text?.trim() || 'Untitled frame',
            width: built.width,
            height: built.height,
            svg,
            background: built.background,
            pageColor: built.pageColor,
            notes: frame.slide?.notes ?? '',
            transition: effectiveTransition(frame.slide),
            items,
            relationships: [...relationships],
            sequences: this.sequencesWithin(frame, sequences),
            imageData,
            media: this.mediaWithin(frame, elements),
         });
      }
      return out;
   }

   /** A `data:` URL for an SVG string (used for <img> thumbnails and slides). */
   static dataUrl(svg: string): string {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
   }

   /** Which two tables each relationship joins (so a connector can follow its tables' animations). */
   private relationshipEnds(
      relationships: readonly RelationshipModel[],
      tables: readonly TableModel[]
   ): Map<string, [string, string]> {
      const tableOf = new Map<string, string>();
      for (const t of tables) {
         for (const c of t.columns) {
            tableOf.set(c.id, t.id);
         }
      }
      const ends = new Map<string, [string, string]>();
      for (const r of relationships) {
         const a = tableOf.get(r.sourceColumnId);
         const b = tableOf.get(r.targetColumnId);
         if (a && b) {
            ends.set(r.id, [a, b]);
         }
      }
      return ends;
   }

   /** A slide's sequence diagrams (a plain frame's: those overlapping it), with their parts. */
   private sequencesWithin(
      frame: CanvasElementModel,
      all: {
         diagrams: readonly SequenceDiagramModel[];
         lifelines: readonly LifelineModel[];
         messages: readonly SequenceMessageModel[];
      }
   ): RenderedSlide['sequences'] {
      const diagrams = all.diagrams.filter((d) => {
         const b = sequenceDiagramBox(d, all.lifelines, all.messages);
         return (
            !!b &&
            // A slide's own diagrams take part anywhere (off-frame = staged for morph).
            ((!!frame.slide && d.slideId === frame.id) ||
               (b.x1 > frame.x && b.x0 < frame.x + frame.width && b.y1 > frame.y && b.y0 < frame.y + frame.height))
         );
      });
      const ids = new Set(diagrams.map((d) => d.id));
      return {
         diagrams,
         lifelines: all.lifelines.filter((l) => ids.has(l.diagramId)),
         messages: all.messages.filter((m) => ids.has(m.diagramId)),
      };
   }

   /** A slide's elements and tables (a plain frame's: those overlapping it), positioned relative to the frame. */
   private itemsWithin(
      frame: CanvasElementModel,
      elements: readonly CanvasElementModel[],
      tables: readonly TableModel[]
   ): SlideItem[] {
      const items: SlideItem[] = [];
      const fx0 = frame.x;
      const fy0 = frame.y;
      const fx1 = frame.x + frame.width;
      const fy1 = frame.y + frame.height;
      // What the slide owns takes part wherever it is (items staged off the frame slide in
      // / out); anything else (free canvas content) only where it overlaps the frame.
      const takes = (slideId: string | undefined, x0: number, y0: number, x1: number, y1: number): boolean =>
         (!!frame.slide && slideId === frame.id) || (x1 > fx0 && x0 < fx1 && y1 > fy0 && y0 < fy1);

      for (const e of elements) {
         if (e.type === 'frame') {
            continue;
         }
         const b = elementBox(e);
         if (!takes(e.slideId, b.x0, b.y0, b.x1, b.y1)) {
            continue;
         }
         items.push({
            id: e.id,
            // Copies of one layout placeholder morph into each other across slides.
            // A tag set on the layout's placeholder applies to every slide's copy of it.
            key: slideMorphKey(e, (id) => this.store.elements().find((p) => p.id === id)),
            keyIn: e.morphIn ?? undefined,
            keyOut: e.morphOut ?? undefined,
            kind: 'element',
            type: e.type,
            // Grids are matched by what their cells say, not by their JSON.
            text: e.type === 'grid' ? gridCellsText(e.text) : (e.text ?? ''),
            runTags: [...new Set((e.runs ?? []).flatMap((r) => (r.morph ? [r.morph] : [])))],
            cx: (b.x0 + b.x1) / 2 - fx0,
            cy: (b.y0 + b.y1) / 2 - fy0,
            w: b.x1 - b.x0,
            h: b.y1 - b.y0,
            angle: e.angle ?? 0,
            // Placeholder copies are slide content; anything else not owned by the slide came from its layout.
            source: frame.slide && e.slideId && e.slideId !== frame.id && !e.placeholder?.of ? 'layout' : undefined,
            element: e,
         });
      }
      for (const t of tables) {
         const b = tableBox(t);
         if (!takes(t.slideId, b.x0, b.y0, b.x1, b.y1)) {
            continue;
         }
         items.push({
            id: t.id,
            key: t.morphId ?? t.id,
            kind: 'table',
            type: 'table',
            text: t.name,
            cx: (b.x0 + b.x1) / 2 - fx0,
            cy: (b.y0 + b.y1) / 2 - fy0,
            w: b.x1 - b.x0,
            h: b.y1 - b.y0,
            angle: 0,
            table: t,
         });
      }
      return items;
   }

   /** The GIFs and videos among a slide's elements (files are loaded by `imageData` first). */
   private mediaWithin(frame: CanvasElementModel, elements: readonly CanvasElementModel[]): SlideMedia[] {
      const out: SlideMedia[] = [];
      const fw = frame.width || 1;
      const fh = frame.height || 1;
      for (const e of [...elements].sort((a, b) => a.zIndex - b.zIndex)) {
         if (e.type === 'embed') {
            // Live frames load their page over the slide picture (which shows the placeholder card).
            if (!isEmbedUrl(e.text)) continue;
            const view = imageView({ ...e, media: undefined }, '');
            out.push({
               id: e.id,
               kind: 'embed',
               fileId: '',
               url: e.text!.trim(),
               radius: `${((e.cornerRadius ?? 8) / (e.width || 1)) * 100}% / ${((e.cornerRadius ?? 8) / (e.height || 1)) * 100}%`,
               left: ((e.x - frame.x) / fw) * 100,
               top: ((e.y - frame.y) / fh) * 100,
               width: (e.width / fw) * 100,
               height: (e.height / fh) * 100,
               angle: ((e.angle || 0) * 180) / Math.PI,
               opacity: e.opacity / 100,
               view,
            });
            continue;
         }
         const kind = e.type === 'image' ? this.images.kind(e.fileId) : null;
         if (!e.fileId || (kind !== 'gif' && kind !== 'video')) {
            continue;
         }
         out.push({
            id: e.id,
            kind,
            fileId: e.fileId,
            left: ((e.x - frame.x) / fw) * 100,
            top: ((e.y - frame.y) / fh) * 100,
            width: (e.width / fw) * 100,
            height: (e.height / fh) * 100,
            angle: ((e.angle || 0) * 180) / Math.PI,
            opacity: e.opacity / 100,
            view: imageView(e, e.fileId),
         });
      }
      return out;
   }

   private async imageData(elements: readonly CanvasElementModel[]): Promise<Map<string, string>> {
      const ids = [...new Set(elements.filter((e) => (e.type === 'image' || e.type === 'embed') && e.fileId).map((e) => e.fileId as string))];
      const data = new Map<string, string>();
      await Promise.all(
         ids.map(async (id) => {
            const url = await this.images.stillDataUrl(id);
            if (url) {
               data.set(id, url);
            }
         })
      );
      return data;
   }

   /** The field values for one slide of a deck. */
   private fieldsFor(frame: CanvasElementModel): FieldContext {
      const name = presentationOf(frame);
      const ids = presentableSlides(this.store.slideFrames())
         .filter((f) => presentationOf(f) === name)
         .map((f) => f.id);
      return fieldContext(frame.id, ids, name);
   }
}

/** The slide as it looks after `step` animation groups: that state's image and what is visible. */
export function slideAtStep(slide: RenderedSlide, step: number): RenderedSlide {
   if (slide.maxStep === 0) {
      return slide;
   }
   const k = Math.min(slide.maxStep, Math.max(0, step));
   const hidden = slide.hiddenByStep[k];
   return {
      ...slide,
      svg: slide.stepSvgs[k],
      items: slide.items.filter((i) => !hidden.has(i.id)),
      sequences: {
         diagrams: slide.sequences.diagrams.filter((d) => !hidden.has(d.id)),
         lifelines: slide.sequences.lifelines.filter((l) => !hidden.has(l.diagramId)),
         messages: slide.sequences.messages.filter((m) => !hidden.has(m.diagramId)),
      },
   };
}
