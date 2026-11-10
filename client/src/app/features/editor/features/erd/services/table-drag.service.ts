import { PointerGestureService } from '../../../services/pointer-gesture.service';
import type { SequenceStart } from '../../../models/sequence-start.model';
import { inject, Injectable, type Signal } from '@angular/core';
import type { TableModel } from '@devdesigner/shared';
import { ProjectStore } from '../../../state/project/project.store';
import type { Point } from '../../../models/geometry.model';
import type { ColumnLocation } from '../../../models/geometry.model';
/** What table drags read from the editor entry; the entry wires it with `connect`. */
export interface TableDragHost {
   readonly columnLocations: Signal<Map<string, ColumnLocation>>;
   itemScale(id: string): number;
   sequenceStart(diagramId: string): SequenceStart | null;
   duplicateAndDrag(): Promise<void>;
}

/** Grabbing ERD table nodes: selection on press and the start of a (multi-item) table drag. */
@Injectable()
export class TableDragService {
   private readonly store = inject(ProjectStore);
   private readonly gesture = inject(PointerGestureService);
   private host!: TableDragHost;

   connect(host: TableDragHost): void {
      this.host = host;
   }

   /** Non-table selection members dragged along when a table is grabbed (groups, mixed selections). */
   nodeExtras: {
      elements: Map<string, { x: number; y: number }>;
      sequences: Map<string, SequenceStart>;
   } | null = null;

   dragTableId: string | null = null;

   multiDragStart = new Map<string, { x: number; y: number }>();

   // Manual routes touching the dragged tables. `both` true when both endpoints
   // move together (rigid translate). Otherwise only one end moves: the waypoint
   // nearest that anchor follows it vertically (so the closest vertical run
   // shrinks) while its x is absorbed by the horizontal run. `sourceMoved` picks
   // which end (first vs last waypoint) is the one being dragged.
   waypointDragStart = new Map<string, { wp: Point[]; both: boolean; sourceMoved: boolean }>();

   // --- node pointer (select / drag) ---

   onNodePointerDown(event: PointerEvent, table: TableModel): void {
      if (event.button !== 0) {
         return;
      }
      event.stopPropagation();
      if (PointerGestureService.additive(event)) {
         this.store.selectTable(table.id, true);
         return;
      }
      if (!this.store.selectedTableIds().includes(table.id)) {
         this.store.selectTable(table.id, false);
      }
      if (!this.store.canEdit()) {
         return;
      }
      this.gesture.startClientX = event.clientX;
      this.gesture.startClientY = event.clientY;
      this.gesture.gestureScale = this.host.itemScale(table.id);
      this.gesture.dragCopied = false;
      this.beginNodeDrag(table.id);
      if (event.altKey) {
         void this.host.duplicateAndDrag();
      }
   }

   /** Start moving the current table selection, grabbed by `tableId`. */
   beginNodeDrag(tableId: string): void {
      this.gesture.mode = 'node';
      this.dragTableId = tableId;
      this.multiDragStart = new Map(
         this.store
            .tables()
            .filter((t) => this.store.selectedTableIds().includes(t.id))
            .map((t) => [t.id, { x: t.x, y: t.y }])
      );

      const elementIds = new Set(this.store.selectedElementIds());
      const diagramIds = this.store.selectedDiagramIds();
      this.nodeExtras =
         elementIds.size || diagramIds.length
            ? {
                 elements: new Map(
                    this.store
                       .elements()
                       .filter((e) => elementIds.has(e.id))
                       .map((e) => [e.id, { x: e.x, y: e.y }] as const)
                 ),
                 sequences: new Map(
                    diagramIds
                       .map((id) => [id, this.host.sequenceStart(id)] as const)
                       .filter((e): e is readonly [string, SequenceStart] => !!e[1])
                 ),
              }
            : null;

      const moved = new Set(this.store.selectedTableIds());
      const locs = this.host.columnLocations();
      this.waypointDragStart = new Map();
      for (const rel of this.store.relationships()) {
         const st = locs.get(rel.sourceColumnId)?.table.id;
         const tt = locs.get(rel.targetColumnId)?.table.id;
         const srcMoved = !!st && moved.has(st);
         const tgtMoved = !!tt && moved.has(tt);
         if (srcMoved || tgtMoved) {
            this.waypointDragStart.set(rel.id, {
               wp: (rel.waypoints ?? []).map((w) => ({ ...w })),
               both: srcMoved && tgtMoved,
               sourceMoved: srcMoved,
            });
         }
      }
   }
}
