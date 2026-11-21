import { CanvasViewService } from '../../../services/canvas-view.service';
import { PointerGestureService } from '../../../services/pointer-gesture.service';
import { TextEditingService } from './text-editing.service';
import { EditorViewportService } from '../../../services/editor-viewport.service';
import { computed, inject, Injectable } from '@angular/core';
import { sequenceDiagramRect } from '@devdesigner/shared';
import { ProjectStore } from '../../../state/project/project.store';
import { elementBox, tableBox } from '../../../helpers/element-geometry.helper';
import { tableWidth } from '../../../helpers/node-metrics.helper';
import type { Box } from '../../../models/geometry.model';
/** Where the floating context toolbars sit for the current selection, and styling the selection from them. */
@Injectable()
export class FloatingToolbarsService {
   private readonly store = inject(ProjectStore);
   private readonly gesture = inject(PointerGestureService);
   private readonly canvasView = inject(CanvasViewService);
   private readonly viewport = inject(EditorViewportService);
   private readonly textEditing = inject(TextEditingService);

   /** Placement + representative element for the floating context toolbar. */
   readonly elementToolbar$ = computed(() => {
      // Shown whenever element(s) are selected and no gesture/text-edit is active,
      // even while a draw tool stays active (drawing a shape selects it).
      const editingId = this.textEditing.editingTextId$();
      const editType = !!editingId && this.store.elements().find((e) => e.id === editingId)?.type;
      const richEditing = !!editingId && ['text', 'rectangle', 'ellipse', 'diamond', 'triangle'].includes(editType || '');
      if ((editingId && !richEditing) || this.gesture.gestureActive()) {
         return null;
      }
      const ids = this.store.selectedElementIds();
      if (!ids.length) {
         return null;
      }
      const idSet = new Set(ids);
      const els = this.store.elements().filter((e) => idSet.has(e.id));
      if (!els.length) {
         return null;
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const e of els) {
         const b = this.canvasView.drawnBox(e.id, elementBox(e));
         minX = Math.min(minX, b.x0);
         minY = Math.min(minY, b.y0);
         maxX = Math.max(maxX, b.x1);
         maxY = Math.max(maxY, b.y1);
      }
      const v = this.store.viewport();
      // Clear the rotate handle (sits ~24px above the top edge) so the bar never
      // covers it; when there is no room above, flip the bar below the selection.
      const ROTATE_CLEAR = 24;
      const BAR = 52;
      const above = minY * v.zoom + v.y - ROTATE_CLEAR * v.zoom - BAR;
      const below = maxY * v.zoom + v.y + 16;
      return {
         left: ((minX + maxX) / 2) * v.zoom + v.x,
         top: above >= 8 ? above : below,
         element: els[0],
      };
   });

   /**
    * Placement for the multi-select bar: under the union box of 2+ selected units
    * (or a single selected group, so it can be ungrouped).
    */
   readonly multiSelectBar$ = computed(() => {
      if (this.gesture.gestureActive() || !this.store.canEdit() || this.textEditing.editingTextId$()) {
         return null;
      }
      const byItem = this.store.groupByItem();
      const entered = this.store.enteredGroupId();
      const ids = [
         ...this.store.selectedTableIds(),
         ...this.store.selectedElementIds(),
         ...this.store.selectedDiagramIds(),
      ];
      const units = new Set(
         ids.map((id) => {
            const g = byItem.get(id);
            return g && g !== entered ? g : id;
         })
      );
      const grouped = units.size === 1 && ids.length > 1 && [...units][0] !== ids[0];
      if (units.size < 2 && !grouped) {
         return null;
      }
      const selected = new Set(ids);
      let x0 = Infinity,
         y0 = Infinity,
         x1 = -Infinity,
         y1 = -Infinity;
      const grow = (b: Box): void => {
         x0 = Math.min(x0, b.x0);
         y0 = Math.min(y0, b.y0);
         x1 = Math.max(x1, b.x1);
         y1 = Math.max(y1, b.y1);
      };
      for (const t of this.store.tables()) if (selected.has(t.id)) grow(tableBox(t));
      for (const e of this.store.elements())
         if (selected.has(e.id)) grow(this.canvasView.drawnBox(e.id, elementBox(e)));
      for (const d of this.store.sequenceDiagrams()) {
         const b = selected.has(d.id) ? this.canvasView.diagramBox(d) : null;
         if (b) grow({ x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY });
      }
      if (!Number.isFinite(x0)) {
         return null;
      }
      const v = this.store.viewport();
      const below = y1 * v.zoom + v.y + 14;
      const maxTop = (this.viewport.canvasSize().height || window.innerHeight) - 110;
      return {
         left: ((x0 + x1) / 2) * v.zoom + v.x,
         top: Math.min(below, maxTop),
         count: grouped ? ids.length : units.size,
         grouped,
      };
   });

   /** Placement + table for the floating table action bar (single table selected). */
   readonly tableToolbar$ = computed(() => {
      if (this.gesture.gestureActive()) {
         return null;
      }
      const table = this.store.selectedTable();
      if (!table) {
         return null;
      }
      const v = this.store.viewport();
      return {
         left: (table.x + tableWidth(table) / 2) * v.zoom + v.x,
         top: Math.max(table.y * v.zoom + v.y - 52, 8),
         table,
      };
   });

   /** Placement for the floating contextual bar over the selected sequence message. */
   readonly sequenceMessageToolbar$ = computed(() => {
      const m = this.store.selectedMessage();
      if (!m) {
         return null;
      }
      const d = this.store.sequenceDiagrams().find((x) => x.id === m.diagramId);
      if (!d) {
         return null;
      }
      const lls = this.store.lifelines();
      const base = d.originY + d.headerHeight;
      const row = Math.max(1, Math.round((m.y - base) / d.rowSpacing));
      const y = base + d.rowSpacing * row;
      let midX: number;
      const from = lls.find((l) => l.id === m.fromLifelineId);
      const to = lls.find((l) => l.id === m.toLifelineId);
      if (m.style === 'break' || !from || !to) {
         const own = lls.filter((l) => l.diagramId === m.diagramId);
         if (!own.length) return null;
         const minX = Math.min(...own.map((l) => l.x));
         const maxX = Math.max(...own.map((l) => l.x));
         midX = (minX + maxX) / 2;
      } else {
         midX = (from.x + to.x) / 2;
      }
      const v = this.store.viewport();
      return { left: midX * v.zoom + v.x, top: y * v.zoom + v.y };
   });

   /** Placement for the floating participant (lifeline) toolbar, above its header. */
   readonly sequenceParticipantToolbar$ = computed(() => {
      const l = this.store.selectedLifeline();
      if (!l) {
         return null;
      }
      const d = this.store.sequenceDiagrams().find((x) => x.id === l.diagramId);
      if (!d) {
         return null;
      }
      const v = this.store.viewport();
      return { left: l.x * v.zoom + v.x, top: d.originY * v.zoom + v.y };
   });

   /** Screen anchor (top-center of the box) for the selected sequence diagram's toolbar. */
   readonly sequenceDiagramToolbar$ = computed(() => {
      const d = this.store.selectedDiagram();
      if (!d || this.store.selectedLifeline() || this.store.selectedMessage()) {
         return null;
      }
      const r = sequenceDiagramRect(d, this.store.lifelines(), this.store.sequenceMessages());
      if (!r) {
         return null;
      }
      const v = this.store.viewport();
      return { left: (r.x + r.w / 2) * v.zoom + v.x, top: r.y * v.zoom + v.y };
   });

   /** Element types a "fill / stroke for all" applies to. */
   private static readonly FILLABLE = new Set(['rectangle', 'ellipse', 'diamond', 'triangle']);

   private static readonly STROKABLE = new Set(['rectangle', 'ellipse', 'diamond', 'triangle', 'arrow', 'line', 'freedraw']);

   /** Some selected elements take a fill or stroke. */
   readonly selectionStylable$ = computed(() => {
      const ids = new Set(this.store.selectedElementIds());
      return this.store.elements().some((e) => ids.has(e.id) && FloatingToolbarsService.STROKABLE.has(e.type));
   });

   /** Fill / stroke every selected shape (one undo step). */
   styleSelection(kind: 'fill' | 'stroke', color: string): void {
      if (!this.store.canEdit()) return;
      const ids = new Set(this.store.selectedElementIds());
      const allowed = kind === 'fill' ? FloatingToolbarsService.FILLABLE : FloatingToolbarsService.STROKABLE;
      const targets = this.store.elements().filter((e) => ids.has(e.id) && allowed.has(e.type));
      if (!targets.length) return;
      void this.store.batchHistory(async () => {
         for (const e of targets) {
            if (kind === 'fill') {
               await this.store.updateElement(
                  e.id,
                  color === 'transparent' ? { fillStyle: 'none' } : { backgroundColor: color, fillStyle: 'solid' }
               );
            } else {
               await this.store.updateElement(e.id, { strokeColor: color });
            }
         }
      });
   }
}
