import { CanvasViewService } from './canvas-view.service';
import { computed, inject, Injectable } from '@angular/core';
import { MediaActionsService } from './media-actions.service';
import { ProjectStore, type SequenceLayoutSnapshot } from '../state/project/project.store';
import { type AlignAction } from '../models/toolbar-actions';
import { elementBox, tableBox } from '../helpers/element-geometry.helper';
import { tableHeight, tableWidth } from '../helpers/node-metrics.helper';
import type { Box } from '../models/geometry.model';
/** Element kinds that can contain other items (a lone selection aligns to these). */
const CONTAINER_TYPES: ReadonlySet<string> = new Set(['frame', 'rectangle', 'ellipse', 'diamond', 'triangle']);

/** What alignment reaches in a sub-feature; the editor entry wires it with `connect`. */
export interface AlignHost {
   /** Re-route manual relationship lines whose tables moved. */
   followRoutes(start: Map<string, { x: number; y: number }>): void;
}

/** Align / distribute the selection (or a lone item within its container), and image crop alignment. */
@Injectable()
export class AlignService {
   private readonly store = inject(ProjectStore);
   private readonly canvasView = inject(CanvasViewService);
   private readonly mediaActions = inject(MediaActionsService);
   private host!: AlignHost;

   connect(host: AlignHost): void {
      this.host = host;
   }

   /** The image element being cropped inline (crop overlay), while it still exists. */
   readonly croppingElement$ = computed(() => {
      const id = this.mediaActions.croppingId();
      return id ? (this.store.elements().find((e) => e.id === id && e.type === 'image') ?? null) : null;
   });

   /**
    * The frame / shape a lone selected unit sits fully inside, if any. A single
    * selection aligns to this container, so no second selection is needed. Once
    * several units are selected they align to each other instead (which already
    * covers the "item + its container" case).
    */
   private readonly alignContainer = computed<Box | null>(() => {
      if (this.canvasView.alignUnitCount() !== 1) {
         return null;
      }
      const selected = new Set([
         ...this.store.selectedTableIds(),
         ...this.store.selectedElementIds(),
         ...this.store.selectedDiagramIds(),
      ]);
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      const grow = (b: Box): void => {
         x0 = Math.min(x0, b.x0);
         y0 = Math.min(y0, b.y0);
         x1 = Math.max(x1, b.x1);
         y1 = Math.max(y1, b.y1);
      };
      for (const t of this.store.tables()) {
         if (selected.has(t.id)) grow(tableBox(t));
      }
      for (const e of this.store.elements()) {
         if (selected.has(e.id)) grow(elementBox(e));
      }
      for (const d of this.store.sequenceDiagrams()) {
         const b = selected.has(d.id) ? this.canvasView.diagramBox(d) : null;
         if (b) grow({ x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY });
      }
      if (!Number.isFinite(x0)) {
         return null;
      }
      const eps = 0.5;
      let best: Box | null = null;
      let bestArea = Infinity;
      for (const e of this.store.elements()) {
         if (selected.has(e.id) || !CONTAINER_TYPES.has(e.type)) continue;
         const b = elementBox(e);
         if (b.x0 > x0 + eps || b.y0 > y0 + eps || b.x1 < x1 - eps || b.y1 < y1 - eps) continue;
         const area = (b.x1 - b.x0) * (b.y1 - b.y0);
         if (area < bestArea) {
            best = b;
            bestArea = area;
         }
      }
      return best;
   });

   /** Align buttons are live for 2+ units, or for one unit inside a container. */
   readonly canAlign = computed(
      () => this.store.canEdit() && (this.canvasView.alignUnitCount() >= 2 || !!this.alignContainer())
   );

   readonly canDistribute$ = computed(() => this.store.canEdit() && this.canvasView.alignUnitCount() >= 3);

   /** True when an align action would target the surrounding container. */
   readonly alignToContainer$ = computed(() => this.canvasView.alignUnitCount() === 1 && !!this.alignContainer());

   // --- alignment ---

   onAlign(action: AlignAction): void {
      if (!this.store.canEdit()) {
         return;
      }
      // While cropping, the panel lines the clip shape up within its picture.
      if (this.croppingElement$()) {
         this.mediaActions.requestCropAlign(action);
         return;
      }
      // Tables, canvas elements (text, shapes, lines...) and sequence diagrams align
      // together by their bounding boxes. A whole group is ONE item: its box is the
      // union of its members, and placing it shifts every member by the same amount.
      interface Member {
         gid: string | null;
         x: number;
         y: number;
         w: number;
         h: number;
         shift: (dx: number, dy: number) => void;
      }
      interface Item {
         x: number;
         y: number;
         w: number;
         h: number;
         place: (x: number, y: number) => void;
      }
      const byItem = this.store.groupByItem();
      const entered = this.store.enteredGroupId();
      const gidOf = (id: string): string | null => {
         const g = byItem.get(id);
         return g && g !== entered ? g : null;
      };
      const members: Member[] = [];
      const tableIds = this.store.selectedTableIds();
      const tableStart = new Map(this.store.tables().map((t) => [t.id, { x: t.x, y: t.y }]));
      for (const t of this.store.tables()) {
         if (tableIds.includes(t.id)) {
            members.push({
               gid: gidOf(t.id),
               x: t.x,
               y: t.y,
               w: tableWidth(t),
               h: tableHeight(t),
               shift: (dx, dy) => this.store.moveTable(t.id, Math.round(t.x + dx), Math.round(t.y + dy)),
            });
         }
      }
      const elementIds = this.store.selectedElementIds();
      const moves: { id: string; from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
      for (const e of this.store.elements()) {
         if (elementIds.includes(e.id)) {
            const b = elementBox(e);
            members.push({
               gid: gidOf(e.id),
               x: b.x0,
               y: b.y0,
               w: b.x1 - b.x0,
               h: b.y1 - b.y0,
               shift: (dx, dy) => {
                  const nx = Math.round(e.x + dx);
                  const ny = Math.round(e.y + dy);
                  if (nx !== e.x || ny !== e.y) {
                     moves.push({ id: e.id, from: { x: e.x, y: e.y }, to: { x: nx, y: ny } });
                     this.store.moveElement(e.id, nx, ny);
                  }
               },
            });
         }
      }
      // Moving a sequence diagram shifts every participant and message with it (rows
      // kept), then persists + records undo.
      const seqMoves: { id: string; before: SequenceLayoutSnapshot }[] = [];
      for (const d of this.store.sequenceDiagrams()) {
         if (!this.store.selectedDiagramIds().includes(d.id)) continue;
         const b = this.canvasView.diagramBox(d);
         const snap = this.store.sequenceDiagramSnapshot(d.id);
         if (!b || !snap) continue;
         members.push({
            gid: gidOf(d.id),
            x: b.minX,
            y: b.minY,
            w: b.maxX - b.minX,
            h: b.maxY - b.minY,
            shift: (dx, dy) => {
               const rx = Math.round(dx);
               const ry = Math.round(dy);
               if (!rx && !ry) return;
               seqMoves.push({ id: d.id, before: this.canvasView.layoutSnapshot(d.id) });
               this.store.shiftSequence(d.id, snap.startXs, rx, snap.startOriginY, ry, snap.startRows);
            },
         });
      }
      const items: Item[] = [];
      const grouped = new Map<string, Member[]>();
      for (const m of members) {
         if (m.gid) {
            grouped.set(m.gid, [...(grouped.get(m.gid) ?? []), m]);
         } else {
            items.push({
               x: m.x,
               y: m.y,
               w: m.w,
               h: m.h,
               place: (x, y) => m.shift(x - m.x, y - m.y),
            });
         }
      }
      for (const parts of grouped.values()) {
         const gx = Math.min(...parts.map((m) => m.x));
         const gy = Math.min(...parts.map((m) => m.y));
         items.push({
            x: gx,
            y: gy,
            w: Math.max(...parts.map((m) => m.x + m.w)) - gx,
            h: Math.max(...parts.map((m) => m.y + m.h)) - gy,
            place: (x, y) => parts.forEach((m) => m.shift(x - gx, y - gy)),
         });
      }
      // A lone unit aligns to the frame / shape it sits inside.
      const container = items.length === 1 ? this.alignContainer() : null;
      if (items.length < 2 && !container) {
         return;
      }
      const minX = container ? container.x0 : Math.min(...items.map((i) => i.x));
      const maxRight = container ? container.x1 : Math.max(...items.map((i) => i.x + i.w));
      const minY = container ? container.y0 : Math.min(...items.map((i) => i.y));
      const maxBottom = container ? container.y1 : Math.max(...items.map((i) => i.y + i.h));

      switch (action) {
         case 'left':
            items.forEach((i) => i.place(minX, i.y));
            break;
         case 'right':
            items.forEach((i) => i.place(maxRight - i.w, i.y));
            break;
         case 'hcenter': {
            const center = (minX + maxRight) / 2;
            items.forEach((i) => i.place(center - i.w / 2, i.y));
            break;
         }
         case 'top':
            items.forEach((i) => i.place(i.x, minY));
            break;
         case 'bottom':
            items.forEach((i) => i.place(i.x, maxBottom - i.h));
            break;
         case 'vcenter': {
            const center = (minY + maxBottom) / 2;
            items.forEach((i) => i.place(i.x, center - i.h / 2));
            break;
         }
         case 'dist-h': {
            if (items.length < 2) break;
            const sorted = [...items].sort((p, q) => p.x - q.x);
            const first = sorted[0].x;
            const last = sorted[sorted.length - 1].x;
            const step = (last - first) / (sorted.length - 1);
            sorted.forEach((i, n) => i.place(first + step * n, i.y));
            break;
         }
         case 'dist-v': {
            if (items.length < 2) break;
            const sorted = [...items].sort((p, q) => p.y - q.y);
            const first = sorted[0].y;
            const last = sorted[sorted.length - 1].y;
            const step = (last - first) / (sorted.length - 1);
            sorted.forEach((i, n) => i.place(i.x, first + step * n));
            break;
         }
         case 'gaps-h':
         case 'gaps-v': {
            // Tidy: same 40px gap between neighbours, starting from the first one.
            if (items.length < 2) break;
            const gap = 40;
            const horizontal = action === 'gaps-h';
            const sorted = [...items].sort((p, q) => (horizontal ? p.x - q.x : p.y - q.y));
            let at = horizontal ? sorted[0].x : sorted[0].y;
            for (const i of sorted) {
               if (horizontal) i.place(at, i.y);
               else i.place(i.x, at);
               at += (horizontal ? i.w : i.h) + gap;
            }
            break;
         }
      }
      this.host.followRoutes(tableStart);
      this.store.recordElementMove(moves);
      for (const { id, before } of seqMoves) {
         const after = this.canvasView.layoutSnapshot(id);
         for (const [lid, x] of after.lifelineXs) this.store.moveLifeline(lid, x);
         for (const [mid, y] of after.messageYs) this.store.moveMessage(mid, y);
         void this.store.updateSequenceConfig(id, {
            rowSpacing: after.rowSpacing,
            originY: after.originY,
         });
         this.store.recordSequenceLayout(id, before, after);
      }
   }
}
