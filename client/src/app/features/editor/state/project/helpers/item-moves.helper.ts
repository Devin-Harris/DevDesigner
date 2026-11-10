import type { PointModel, SchemaModel } from '@devdesigner/shared';
import type { ItemMoves, SequenceShift } from '../models/project-state.model';

// Pure drag-frame transforms used by `moveItemsLocal` / `shiftSequence` (perf 2.1).

export function shiftSequenceIn(s: SchemaModel, shift: SequenceShift): SchemaModel {
   const { diagramId, startXs, dx, startOriginY, dy, startRows } = shift;
   const d = s.sequenceDiagrams.find((x) => x.id === diagramId);
   const base = startOriginY + dy + (d?.headerHeight ?? 42);
   const gap = d?.rowSpacing ?? 48;
   return {
      ...s,
      lifelines: s.lifelines.map((l) => (l.diagramId === diagramId ? { ...l, x: (startXs.get(l.id) ?? l.x) + dx } : l)),
      sequenceMessages: s.sequenceMessages.map((m) =>
         m.diagramId === diagramId && startRows.has(m.id) ? { ...m, y: base + gap * (startRows.get(m.id) ?? 1) } : m
      ),
      sequenceDiagrams: s.sequenceDiagrams.map((x) => (x.id === diagramId ? { ...x, originY: startOriginY + dy } : x)),
   };
}

/** Move many rows in one pass per collection; rows already in place keep their identity. */
export function applyItemMoves(s: SchemaModel, moves: ItemMoves): SchemaModel {
   let next = s;
   const at = <T extends { id: string; x: number; y: number }>(rows: T[], to?: ReadonlyMap<string, PointModel>): T[] =>
      to?.size
         ? rows.map((r) => {
              const p = to.get(r.id);
              return p && (p.x !== r.x || p.y !== r.y) ? { ...r, x: p.x, y: p.y } : r;
           })
         : rows;
   if (moves.elements?.size) next = { ...next, elements: at(next.elements, moves.elements) };
   if (moves.tables?.size) next = { ...next, tables: at(next.tables, moves.tables) };
   const wps = moves.waypoints;
   if (wps?.size) {
      next = {
         ...next,
         relationships: next.relationships.map((r) => (wps.has(r.id) ? { ...r, waypoints: wps.get(r.id) } : r)),
      };
   }
   for (const shift of moves.sequences ?? []) next = shiftSequenceIn(next, shift);
   return next;
}
