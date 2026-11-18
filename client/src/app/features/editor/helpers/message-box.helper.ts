import { messageLabelLines } from '@devdesigner/shared';
import type { LifelineModel, SequenceDiagramModel, SequenceMessageModel } from '@devdesigner/shared';
import type { Box } from '../models/geometry.model';

// Mirrors `.msg-label` in sequence-diagram.component.scss (11px mono, 4px/10px padding, 1.35 line height).
const FONT_PX = 11;
const CHAR_W = FONT_PX * 0.6;
const LINE_H = FONT_PX * 1.35;
const PAD_X = 10;
const PAD_Y = 4;

/**
 * World-space boxes of sequence message labels, keyed by message id, so a
 * line/arrow can anchor to the text. Messages with no label have no box (there
 * is nothing to anchor to). Row snapping matches the diagram component's `rowY`.
 */
export function messageLabelBoxes(
   diagrams: readonly SequenceDiagramModel[],
   lifelines: readonly LifelineModel[],
   messages: readonly SequenceMessageModel[]
): Map<string, Box> {
   const out = new Map<string, Box>();
   const diagramById = new Map(diagrams.map((d) => [d.id, d]));
   const lifelineById = new Map(lifelines.map((l) => [l.id, l]));
   const xsByDiagram = new Map<string, number[]>();
   for (const l of lifelines) {
      const xs = xsByDiagram.get(l.diagramId) ?? [];
      xs.push(l.x);
      xsByDiagram.set(l.diagramId, xs);
   }

   for (const m of messages) {
      if (!m.label) {
         continue;
      }
      const d = diagramById.get(m.diagramId);
      if (!d) {
         continue;
      }
      const isBreak = m.style === 'break';
      const f = lifelineById.get(m.fromLifelineId);
      const t = lifelineById.get(m.toLifelineId);
      let cx: number;
      if (isBreak) {
         const xs = xsByDiagram.get(d.id);
         if (!xs?.length) {
            continue;
         }
         cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      } else if (f && t) {
         cx = (f.x + t.x) / 2;
      } else {
         continue;
      }
      const hb = d.originY + d.headerHeight;
      const cy = hb + d.rowSpacing * Math.max(1, Math.round((m.y - hb) / d.rowSpacing));
      const xs = xsByDiagram.get(d.id) ?? [0];
      const k = d.scale ?? 1;
      const lines = messageLabelLines(
         m.label,
         (isBreak ? Math.max(...xs) - Math.min(...xs) : Math.abs((t?.x ?? 0) - (f?.x ?? 0))) / k,
         isBreak,
         m.wrap !== false
      );
      const w = (Math.max(...lines.map((s) => s.length)) * CHAR_W + PAD_X * 2) * k;
      const h = (lines.length * LINE_H + PAD_Y * 2) * k;
      out.set(m.id, { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 });
   }
   return out;
}
