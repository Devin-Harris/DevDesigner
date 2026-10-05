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
    for (const e of elements) {
      if (e.id !== frame.id && !frameIds.has(e.id) && inside(elementBox(e), fb)) {
        out.elementIds.add(e.id);
      }
    }
    for (const t of tables) {
      if (inside(tableBox(t), fb)) {
        out.tableIds.add(t.id);
      }
    }
    for (const d of diagrams) {
      const box = sequenceDiagramBox(d, lifelines, messages);
      if (box && inside(box, fb)) {
        out.diagramIds.add(d.id);
      }
    }
  }
  return out;
}
