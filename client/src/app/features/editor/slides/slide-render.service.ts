import { placeholderGhosts } from './layout-placeholders';
import { Injectable, inject } from '@angular/core';
import {
  effectiveTransition,
  hiddenAtStep,
  parseGrid,
  planAnimations,
  slideAnimations,
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
} from '@dbdesigner/shared';
import { ElementImagesService } from '../../../core/services/element-images.service';
import { ProjectStore } from '../../../stores/project.store';
import { elementBox, tableBox } from '../canvas/helpers/element-geometry.helper';
import { contentForFrame, sequenceDiagramBox } from '../canvas/helpers/frame-contents.helper';
import { buildDiagramSvg } from '../export/diagram-svg.helper';
import { embedFonts } from '../export/font-embed.helper';

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
  notes: string;
  /** The transition into this slide. */
  transition: SlideTransition;
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
    options: { fonts: boolean; ghosts?: boolean } = { fonts: true },
  ): Promise<RenderedSlide[]> {
    const allElements = this.store.elements();
    const allTables = this.store.tables();
    const relationships = this.store.relationships();
    const imageData = await this.imageData(allElements);
    const out: RenderedSlide[] = [];
    for (const [index, frame] of frames.entries()) {
      const mine = contentForFrame(
        frame.id,
        !!frame.slide,
        allElements,
        allTables,
        this.store.sequenceDiagrams(),
        this.store.lifelines(),
        this.store.sequenceMessages(),
        layoutOf(frame, this.store.slideFrames())?.id,
      );
      const elements = options.ghosts
        ? [...mine.elements, ...placeholderGhosts(frame.id, allElements).ghosts]
        : mine.elements;
      const tables = mine.tables;
      const sequences = {
        diagrams: mine.diagrams,
        lifelines: mine.lifelines,
        messages: mine.messages,
      };
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
        elements.filter((e) => e.type !== 'frame'),
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
            imageData,
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
        notes: frame.slide?.notes ?? '',
        transition: effectiveTransition(frame.slide),
        items,
        relationships: [...relationships],
        sequences: this.sequencesWithin(frame, sequences),
        imageData,
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
    tables: readonly TableModel[],
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
    },
  ): RenderedSlide['sequences'] {
    const diagrams = all.diagrams.filter((d) => {
      const b = sequenceDiagramBox(d, all.lifelines, all.messages);
      return (
        !!b &&
        // A slide's own diagrams take part anywhere (off-frame = staged for morph).
        ((!!frame.slide && d.slideId === frame.id) ||
          (b.x1 > frame.x &&
            b.x0 < frame.x + frame.width &&
            b.y1 > frame.y &&
            b.y0 < frame.y + frame.height))
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
    tables: readonly TableModel[],
  ): SlideItem[] {
    const items: SlideItem[] = [];
    const fx0 = frame.x;
    const fy0 = frame.y;
    const fx1 = frame.x + frame.width;
    const fy1 = frame.y + frame.height;
    // What the slide owns takes part wherever it is (items staged off the frame slide in
    // / out); anything else (free canvas content) only where it overlaps the frame.
    const takes = (
      slideId: string | undefined,
      x0: number,
      y0: number,
      x1: number,
      y1: number,
    ): boolean =>
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
        key: e.morphId ?? (e.placeholder?.of ? `placeholder:${e.placeholder.of}` : e.id),
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

  private async imageData(elements: readonly CanvasElementModel[]): Promise<Map<string, string>> {
    const ids = [
      ...new Set(
        elements.filter((e) => e.type === 'image' && e.fileId).map((e) => e.fileId as string),
      ),
    ];
    const data = new Map<string, string>();
    await Promise.all(
      ids.map(async (id) => {
        const url = await this.images.dataUrl(id);
        if (url) {
          data.set(id, url);
        }
      }),
    );
    return data;
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
