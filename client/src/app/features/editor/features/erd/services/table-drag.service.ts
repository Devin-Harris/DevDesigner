import { PointerGestureService } from '../../../services/pointer-gesture.service';
import type { SequenceStart } from '../../../models/sequence-start.model';
import { inject, Injectable } from '@angular/core';
import type { TableModel } from '@devdesigner/shared';
import { ProjectStore } from '../../../state/project/project.store';
import type { Point } from '../../../models/geometry.model';
import { CanvasViewService } from '../../../services/canvas-view.service';
/** What table drags read from the editor entry; the entry wires it with `connect`. */
export interface TableDragHost {
   duplicateAndDrag(): Promise<void>;
}

/** Grabbing ERD table nodes: selection on press and the start of a (multi-item) table drag. */
@Injectable()
export class TableDragService {
   private readonly store = inject(ProjectStore);
   private readonly gesture = inject(PointerGestureService);
   private readonly canvasView = inject(CanvasViewService);
   private host!: TableDragHost;

   connect(host: TableDragHost): void {
      this.host = host;
   }

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
      this.gesture.gestureScale = this.canvasView.itemScale(table.id);
      this.gesture.dragCopied = false;
      this.beginNodeDrag(table.id);
      if (event.altKey) {
         void this.host.duplicateAndDrag();
      }
   }

   /** Start moving the current table selection, grabbed by `tableId`. */
   beginNodeDrag(tableId: string): void {
      this.gesture.mode = 'node';
      this.gesture.dragTableId = tableId;
      this.gesture.multiDragStart = new Map(
         this.store
            .tables()
            .filter((t) => this.store.selectedTableIds().includes(t.id))
            .map((t) => [t.id, { x: t.x, y: t.y }])
      );

      const elementIds = new Set(this.store.selectedElementIds());
      const diagramIds = this.store.selectedDiagramIds();
      this.gesture.nodeExtras =
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
                       .map((id) => [id, this.canvasView.sequenceStart(id)] as const)
                       .filter((e): e is readonly [string, SequenceStart] => !!e[1])
                 ),
              }
            : null;

      const moved = new Set(this.store.selectedTableIds());
      const locs = this.canvasView.columnLocations();
      this.gesture.waypointDragStart = new Map();
      for (const rel of this.store.relationships()) {
         const st = locs.get(rel.sourceColumnId)?.table.id;
         const tt = locs.get(rel.targetColumnId)?.table.id;
         const srcMoved = !!st && moved.has(st);
         const tgtMoved = !!tt && moved.has(tt);
         if (srcMoved || tgtMoved) {
            this.gesture.waypointDragStart.set(rel.id, {
               wp: (rel.waypoints ?? []).map((w) => ({ ...w })),
               both: srcMoved && tgtMoved,
               sourceMoved: srcMoved,
            });
         }
      }
   }
}
