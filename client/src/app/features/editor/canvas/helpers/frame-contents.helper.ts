import { isEmptyPlaceholder, type PlaceholderConfig } from '@dbdesigner/shared';
import type {
  CanvasElementModel,
  LifelineModel,
  SequenceDiagramModel,
  SequenceMessageModel,
  TableModel,
} from '@dbdesigner/shared';
import type { Box } from '../models/geometry.model';
import { elementBox, tableBox } from './element-geometry.helper';

/** Padding the sequence diagram's outer box adds around its participants. */
const SEQ_BOX_PAD = 26;

/** Everything on the canvas that sits fully inside one or more frames. */
export interface FrameContents {
  elementIds: Set<string>;
  tableIds: Set<string>;
  diagramIds: Set<string>;
}

/** A sequence diagram's outer box, matching how it is drawn and exported. */
export function sequenceDiagramBox(
  diagram: SequenceDiagramModel,
  lifelines: readonly LifelineModel[],
  messages: readonly SequenceMessageModel[],
): Box | null {
  const lls = lifelines.filter((l) => l.diagramId === diagram.id);
  if (!lls.length) {
    return null;
  }
  const hb = diagram.originY + diagram.headerHeight;
  const gap = diagram.rowSpacing;
  const rows = messages
    .filter((m) => m.diagramId === diagram.id)
    .map((m) => Math.max(1, Math.round((m.y - hb) / gap)));
  const maxRow = rows.length ? Math.max(...rows) : 0;
  return {
    x0: Math.min(...lls.map((l) => l.x - l.width / 2)) - SEQ_BOX_PAD,
    x1: Math.max(...lls.map((l) => l.x + l.width / 2)) + SEQ_BOX_PAD,
    y0: diagram.originY - SEQ_BOX_PAD,
    y1: hb + gap * (maxRow + 1) + SEQ_BOX_PAD,
  };
}

/**
 * The elements, tables and sequence diagrams fully inside any of `frameIds`
 * (nested frames included; the given frames themselves are excluded).
 */
export function frameContents(
  frameIds: ReadonlySet<string>,
  elements: readonly CanvasElementModel[],
  tables: readonly TableModel[],
  diagrams: readonly SequenceDiagramModel[],
  lifelines: readonly LifelineModel[],
  messages: readonly SequenceMessageModel[],
  /** The slide(s) shown on the canvas; plain frames only take what is on them (or on no slide). */
  activeSlideId: string | ReadonlySet<string> | null = null,
): FrameContents {
  const out: FrameContents = {
    elementIds: new Set(),
    tableIds: new Set(),
    diagramIds: new Set(),
  };
  const frames = elements.filter((e) => e.type === 'frame' && frameIds.has(e.id));
  const inside = (b: Box, f: Box): boolean =>
    b.x0 >= f.x0 && b.x1 <= f.x1 && b.y0 >= f.y0 && b.y1 <= f.y1;
  for (const frame of frames) {
    const fb = elementBox(frame);
    if (frame.slide) {
      // A slide owns what is tagged with its id (slides are stacked in one spot, so
      // geometry cannot tell them apart).
      for (const e of elements) {
        if (e.slideId === frame.id) {
          out.elementIds.add(e.id);
        }
      }
      for (const t of tables) {
        if (t.slideId === frame.id) {
          out.tableIds.add(t.id);
        }
      }
      for (const d of diagrams) {
        if (d.slideId === frame.id) {
          out.diagramIds.add(d.id);
        }
      }
      continue;
    }
    const takes = (slideId: string | undefined): boolean =>
      !slideId ||
      (typeof activeSlideId === 'string' ? slideId === activeSlideId : !!activeSlideId?.has(slideId));
    for (const e of elements) {
      if (
        e.id !== frame.id &&
        !frameIds.has(e.id) &&
        takes(e.slideId) &&
        inside(elementBox(e), fb)
      ) {
        out.elementIds.add(e.id);
      }
    }
    for (const t of tables) {
      if (takes(t.slideId) && inside(tableBox(t), fb)) {
        out.tableIds.add(t.id);
      }
    }
    for (const d of diagrams) {
      const box = sequenceDiagramBox(d, lifelines, messages);
      if (takes(d.slideId) && box && inside(box, fb)) {
        out.diagramIds.add(d.id);
      }
    }
  }
  return out;
}

/**
 * What belongs in the picture of the frame `frameId` (a slide's thumbnail, its
 * presentation image, an export): items owned by that slide plus anything on no
 * slide. Other slides' items, stacked in the same spot, are left out. `layoutId`
 * (the slide's layout frame) adds that layout's elements, drawn beneath the slide's.
 */
export function contentForFrame<
  E extends { slideId?: string; zIndex: number; placeholder?: PlaceholderConfig; text?: string },
  T extends { slideId?: string },
  D extends { id: string; slideId?: string },
  L extends { diagramId: string },
  M extends { diagramId: string },
>(
  frameId: string,
  isSlide: boolean,
  elements: readonly E[],
  tables: readonly T[],
  diagrams: readonly D[],
  lifelines: readonly L[],
  messages: readonly M[],
  layoutId?: string,
): { elements: E[]; tables: T[]; diagrams: D[]; lifelines: L[]; messages: M[] } {
  if (!isSlide) {
    return {
      elements: [...elements],
      tables: [...tables],
      diagrams: [...diagrams],
      lifelines: [...lifelines],
      messages: [...messages],
    };
  }
  const mine = (slideId: string | undefined): boolean => !slideId || slideId === frameId;
  // A slide with no background of its own shows its layout's.
  type Fill = { id?: string; fillStyle?: string; backgroundColor?: string };
  const layout = layoutId
    ? (elements as readonly Fill[]).find((e) => e.id === layoutId)
    : undefined;
  const withLayoutFill = (e: E): E => {
    const f = e as Fill;
    return layout && f.id === frameId && f.fillStyle === 'none' && layout.fillStyle !== 'none'
      ? ({ ...e, fillStyle: layout.fillStyle, backgroundColor: layout.backgroundColor } as E)
      : e;
  };
  const ds = diagrams.filter((d) => mine(d.slideId));
  const ids = new Set(ds.map((d) => d.id));
  return {
    elements: [
      ...(layoutId ? layoutElements(elements, layoutId) : []),
      // Empty placeholder copies are only prompts for the editor: never in the picture.
      ...elements.filter((e) => mine(e.slideId) && !isEmptyPlaceholder(e)).map(withLayoutFill),
    ],
    tables: tables.filter((t) => mine(t.slideId)),
    diagrams: ds,
    lifelines: lifelines.filter((l) => ids.has(l.diagramId)),
    messages: messages.filter((m) => ids.has(m.diagramId)),
  };
}

/** Below every slide item: a layout's elements always draw under the slide's own. */
export const LAYOUT_Z_OFFSET = 1_000_000;

/** A layout frame's elements, pushed below the slide's own stacking order. */
export function layoutElements<
  E extends { slideId?: string; zIndex: number; placeholder?: PlaceholderConfig },
>(elements: readonly E[], layoutId: string): E[] {
  // Placeholders are not repeated: each slide has its own copy.
  return elements
    .filter((e) => e.slideId === layoutId && !e.placeholder)
    .map((e) => ({ ...e, zIndex: e.zIndex - LAYOUT_Z_OFFSET }));
}
