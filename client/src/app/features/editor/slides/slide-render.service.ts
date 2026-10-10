import { Injectable, inject } from '@angular/core';
import {
  effectiveTransition,
  type CanvasElementModel,
  type MorphItem,
  type LifelineModel,
  type RelationshipModel,
  type SequenceDiagramModel,
  type SequenceMessageModel,
  type SlideTransition,
  type TableModel,
} from '@dbdesigner/shared';
import { ElementImagesService } from '../../../core/services/element-images.service';
import { ProjectStore } from '../../../stores/project.store';
import { elementBox, tableBox } from '../canvas/helpers/element-geometry.helper';
import { contentForFrame, sequenceDiagramBox } from '../canvas/helpers/frame-contents.helper';
import { buildDiagramSvg } from '../export/diagram-svg.helper';
import { embedFonts } from '../export/font-embed.helper';

/** An element or table that appears on a slide, in slide-local coordinates. */
export interface SlideItem extends MorphItem {
  /** Matches the `data-eid` / `data-tid` tag on the item's group in the slide SVG. */
  id: string;
  /** Rotation in radians (0 for tables). */
  angle: number;
  /** The source model (world coordinates), used to re-draw the item mid-morph. */
  element?: CanvasElementModel;
  table?: TableModel;
  /** Build step the item appears on (0 = from the start). */
  step: number;
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
  /** The finished slide (every build step revealed). */
  svg: string;
  /** Highest build step on the slide (0 = no build steps). */
  maxStep: number;
  /** One SVG per step 0..maxStep (the last equals `svg`); empty when there are no steps. */
  stepSvgs: string[];
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

  /** Render the given frames in order. `fonts` embeds web fonts (needed for display). */
  async render(
    frames: readonly CanvasElementModel[],
    options: { fonts: boolean } = { fonts: true },
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
      );
      const elements = mine.elements;
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
      const maxStep = items.reduce((m, i) => Math.max(m, i.step), 0);
      const stepSvgs: string[] = [];
      if (maxStep > 0) {
        for (let k = 0; k < maxStep; k += 1) {
          const part = elements.filter((e) => (e.step ?? 0) <= k);
          const v = buildDiagramSvg(tables, relationships, part, sequences, crop, imageData);
          stepSvgs.push(options.fonts ? await embedFonts(v.svg) : v.svg);
        }
        stepSvgs.push(svg);
      }
      out.push({
        originX: frame.x,
        originY: frame.y,
        maxStep,
        stepSvgs,
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

  /** The sequence diagrams (with parts) whose box overlaps the frame. */
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
        b.x1 > frame.x &&
        b.x0 < frame.x + frame.width &&
        b.y1 > frame.y &&
        b.y0 < frame.y + frame.height
      );
    });
    const ids = new Set(diagrams.map((d) => d.id));
    return {
      diagrams,
      lifelines: all.lifelines.filter((l) => ids.has(l.diagramId)),
      messages: all.messages.filter((m) => ids.has(m.diagramId)),
    };
  }

  /** Elements and tables that overlap the frame, positioned relative to it. */
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
    const overlaps = (x0: number, y0: number, x1: number, y1: number): boolean =>
      x1 > fx0 && x0 < fx1 && y1 > fy0 && y0 < fy1;

    for (const e of elements) {
      if (e.type === 'frame') {
        continue;
      }
      const b = elementBox(e);
      if (!overlaps(b.x0, b.y0, b.x1, b.y1)) {
        continue;
      }
      items.push({
        id: e.id,
        key: e.morphId ?? e.id,
        kind: 'element',
        type: e.type,
        text: e.text ?? '',
        cx: (b.x0 + b.x1) / 2 - fx0,
        cy: (b.y0 + b.y1) / 2 - fy0,
        w: b.x1 - b.x0,
        h: b.y1 - b.y0,
        angle: e.angle ?? 0,
        step: e.step ?? 0,
        element: e,
      });
    }
    for (const t of tables) {
      const b = tableBox(t);
      if (!overlaps(b.x0, b.y0, b.x1, b.y1)) {
        continue;
      }
      items.push({
        id: t.id,
        key: t.id,
        kind: 'table',
        type: 'table',
        text: t.name,
        cx: (b.x0 + b.x1) / 2 - fx0,
        cy: (b.y0 + b.y1) / 2 - fy0,
        w: b.x1 - b.x0,
        h: b.y1 - b.y0,
        angle: 0,
        step: 0,
        table: t,
      });
    }
    return items;
  }

  private async imageData(
    elements: readonly CanvasElementModel[],
  ): Promise<Map<string, string>> {
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

/** The slide as it looks at a build step: that step's image and the items visible by then. */
export function slideAtStep(slide: RenderedSlide, step: number): RenderedSlide {
  if (slide.maxStep === 0 || step >= slide.maxStep) {
    return slide;
  }
  const k = Math.max(0, step);
  return {
    ...slide,
    svg: slide.stepSvgs[k],
    items: slide.items.filter((i) => i.step <= k),
  };
}
