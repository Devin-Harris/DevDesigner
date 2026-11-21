import { type LifelineModel } from '@devdesigner/shared';
import { applySequenceBounds } from '../../helpers/frame-contents.helper';
import { type Drag, type Handle, MIN_HEADER_W, MIN_ROW } from './sequence-diagram.helpers';
import type { SequenceDiagramComponent } from './sequence-diagram.component';

/** Pointer gestures (box, resize, header, width, gaps, marquee) of a sequence diagram. */
export class SequenceGestures {
   constructor(private readonly host: SequenceDiagramComponent) {}

   // ----- Bounding box: select + move this diagram -----
   onBoxDown(event: PointerEvent): void {
      event.stopPropagation();
      const id = this.host.diagram$().id;
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
         const fn = this.host.toWorld();
         if (event.shiftKey && !event.ctrlKey && !event.metaKey && fn) {
            // Shift+drag inside the diagram marquee-selects its messages; a plain
            // shift-click (no movement) still toggles the diagram, decided on release.
            const p = fn(event.clientX, event.clientY);
            this.host.startDrag();
            this.host.drag = { kind: 'marquee', start: p, moved: false };
            this.host.marqueeEnd.set(p);
            return;
         }
         // Toggle into/out of the selection; no drag so the gesture stays a pure click.
         this.host.store.toggleSequence(id);
         return;
      }
      // Pressing an already-selected diagram keeps the group so it can be dragged together.
      if (!this.host.store.selectedDiagramIds().includes(id)) this.host.store.selectSequence(id);
      if (!this.host.canEdit$()) return;
      const others = this.host.store
         .selectedDiagramIds()
         .filter((x) => x !== id)
         .map((x) => this.host.store.sequenceDiagramSnapshot(x))
         .filter((x) => x !== null);
      this.host.layoutBefore = this.host.snapshotLayout(id);
      this.host.othersBefore = new Map(others.map((o) => [o.diagramId, this.host.snapshotLayout(o.diagramId)]));
      this.host.startDrag();
      this.host.drag = {
         others,
         companions: this.host.captureCompanions(),
         kind: 'diagram',
         diagramId: this.host.diagram$().id,
         startX: event.clientX,
         startY: event.clientY,
         startXs: new Map(this.host.lls$().map((l) => [l.id, l.x])),
         startOriginY: this.host.originY$(),
         startRows: this.host.startRowsMap(),
      };
      if (event.altKey) void this.duplicateDrag();
   }

   // ----- Bounding box: resize from any side/corner (Shift locks, Alt centers) -----
   onResizeDown(event: PointerEvent, handle: Handle): void {
      event.stopPropagation();
      if (!this.host.canEdit$()) return;
      if (this.host.groupResize()?.(handle, event)) return;
      this.host.store.selectSequence(this.host.diagram$().id);
      this.host.layoutBefore = this.host.snapshotLayout(this.host.diagram$().id);
      this.host.startDrag();
      const l = this.host.lls$();
      const left = l.length ? Math.min(...l.map((x) => x.x)) : 0;
      const right = l.length ? Math.max(...l.map((x) => x.x)) : 0;
      const top = this.host.originY$();
      const nRows = this.host.msgs().length + 1;
      const headerH = this.host.headerH$();
      const contentH = headerH + this.host.rowSpacing() * nRows;
      const content = this.host.contentBox();
      this.host.drag = {
         kind: 'resize',
         handle,
         startX: event.clientX,
         startY: event.clientY,
         startXs: new Map(l.map((x) => [x.id, x.x])),
         startWidths: new Map(l.map((x) => [x.id, x.width])),
         startScale: this.host.diagram$().scale ?? 1,
         scaled: 1,
         startBox: content,
         startOuter: content ? applySequenceBounds(this.host.diagram$(), content) : null,
         startBounds: this.host.boundsOf(this.host.diagram$()),
         startRows: this.host.startRowsMap(),
         left,
         right,
         centerX: (left + right) / 2,
         top,
         contentH,
         centerY: top + contentH / 2,
         headerH,
         nRows,
         startRowSpacing: this.host.rowSpacing(),
      };
   }

   // ----- Row gap: drag to change the spacing between messages (box grows only if needed) -----
   onGapDown(event: PointerEvent, row: number): void {
      event.stopPropagation();
      if (!this.host.canEdit$()) return;
      this.host.layoutBefore = this.host.snapshotLayout(this.host.diagram$().id);
      this.host.startDrag();
      this.host.drag = {
         kind: 'gap',
         startY: event.clientY,
         row,
         startRowSpacing: this.host.rowSpacing(),
         startXs: new Map(this.host.lls$().map((l) => [l.id, l.x])),
         startRows: this.host.startRowsMap(),
         top: this.host.originY$(),
      };
   }

   applyGap(d: Extract<Drag, { kind: 'gap' }>, event: PointerEvent): void {
      const dy = (event.clientY - d.startY) / this.host.zoom();
      const row = Math.max(1, d.row);
      let spacing = Math.max(MIN_ROW, d.startRowSpacing + dy / row);
      const snap = this.host.snap();
      if (snap) {
         // Land the dragged row on the grid.
         const hb = d.top + this.host.headerH$();
         spacing = Math.max(MIN_ROW, (snap(hb + spacing * row) - hb) / row);
      }
      this.host.store.resizeSequenceTo(this.host.diagram$().id, d.startXs, 0, 1, spacing, d.top, d.startRows);
   }

   // ----- Participant header: select + horizontal drag -----
   onHeaderDown(event: PointerEvent, l: LifelineModel): void {
      if (this.host.groupLocked()) {
         this.onBoxDown(event);
         return;
      }
      event.stopPropagation();
      this.host.store.selectLifeline(l.id);
      if (!this.host.canEdit$() || this.host.editingLifelineId$() === l.id) return;
      this.host.startDrag();
      this.host.drag = { kind: 'll', id: l.id, start: event.clientX, startVal: l.x };
      if (event.altKey) void this.duplicateDrag();
   }

   // ----- Participant header: drag a side handle to widen/narrow it (symmetric about the spine) -----
   onWidthDown(event: PointerEvent, l: LifelineModel, side: -1 | 1): void {
      event.stopPropagation();
      if (!this.host.canEdit$()) return;
      this.host.startDrag();
      this.host.drag = { kind: 'llw', id: l.id, side, startClientX: event.clientX, startWidth: l.width };
   }

   applyWidth(d: Extract<Drag, { kind: 'llw' }>, clientX: number): void {
      const dx = ((clientX - d.startClientX) / this.host.zoom()) * d.side;
      let w = Math.max(MIN_HEADER_W, d.startWidth + dx * 2);
      const snap = this.host.snap();
      if (snap) w = Math.max(MIN_HEADER_W, Math.round(snap(w)));
      this.host.store.setLifelineWidthLocal(d.id, Math.round(w));
   }

   /**
    * Leave the original where the drag began and continue the drag on a fresh copy
    * (diagram, participant or message). The copy is positioned from the same drag
    * origin, so it jumps to the cursor.
    */
   async duplicateDrag(): Promise<void> {
      const d = this.host.drag;
      if (!d || this.host.dragCopied || this.host.duplicating || !this.host.canEdit$()) return;
      if (d.kind !== 'diagram' && d.kind !== 'll' && d.kind !== 'msg') return;
      if (d.kind === 'diagram' && (d.others.length || d.companions.tables.size || d.companions.elements.size)) {
         return; // no group duplication
      }
      this.host.duplicating = true;
      let next: Drag | null = null;
      if (d.kind === 'diagram') {
         // Put the original back (it only moved locally), then clone it in place.
         this.host.store.shiftSequence(d.diagramId, d.startXs, 0, d.startOriginY, 0, d.startRows);
         const id = this.host.store.cloneItems(new Set(), new Set([d.diagramId]), [], 0, 0).diagrams.get(d.diagramId);
         if (id) this.host.store.setSelection([], [], [], [], [], [id]);
         const copy = this.host.store.sequenceDiagrams().find((x) => x.id === id);
         if (id && copy) {
            const base = copy.originY + copy.headerHeight;
            const startRows = new Map<string, number>();
            for (const m of this.host.store.sequenceMessages().filter((x) => x.diagramId === id)) {
               startRows.set(m.id, Math.max(1, Math.round((m.y - base) / copy.rowSpacing)));
            }
            next = {
               ...d,
               diagramId: id,
               startXs: new Map(
                  this.host.store
                     .lifelines()
                     .filter((l) => l.diagramId === id)
                     .map((l) => [l.id, l.x])
               ),
               startOriginY: copy.originY,
               startRows,
            };
         }
      } else if (d.kind === 'll') {
         this.host.store.moveLifeline(d.id, d.startVal);
         const id = await this.host.store.duplicateLifeline(d.id, 0);
         if (id) next = { ...d, id };
      } else {
         // Alt-drag copies just the grabbed message: put the whole group back first.
         for (const [mid, y] of d.startYs) this.host.store.moveMessage(mid, y);
         const id = await this.host.store.duplicateMessage(d.id, 0);
         if (id) next = { ...d, id, startYs: new Map([[id, d.startY]]) };
      }
      this.host.duplicating = false;
      if (this.host.drag !== d) return; // released while the copy was being created
      if (!next) return;
      this.host.dragCopied = true;
      this.host.drag = next;
      if (this.host.lastPointer) this.onMove(this.host.lastPointer);
   }

   /** Select the messages of this diagram whose line crosses the rect (added to the current selection). */
   selectMessagesIn(rect: { left: number; top: number; width: number; height: number }): void {
      const right = rect.left + rect.width;
      const bottom = rect.top + rect.height;
      const hits = this.host
         .msgViews$()
         .filter((m) => {
            const l = m.isBreak ? m.spanLeft : m.leftX;
            const r = l + (m.isBreak ? m.spanWidth : m.width);
            return l <= right && r >= rect.left && m.y >= rect.top && m.y <= bottom;
         })
         .map((m) => m.id);
      if (!hits.length) return;
      const id = this.host.diagram$().id;
      this.host.store.setSelection(
         this.host.store.selectedTableIds(),
         this.host.store.selectedRelationshipIds(),
         this.host.store.selectedElementIds(),
         [...new Set([...this.host.store.selectedMessageIds(), ...hits])],
         this.host.store.selectedLifelineIds(),
         this.host.store.selectedDiagramIds().filter((x) => x !== id)
      );
   }

   onMove = (event: PointerEvent): void => {
      this.host.lastPointer = event;
      const d = this.host.drag;
      if (!d || this.host.duplicating) return;
      if (d.kind === 'marquee') {
         const fn = this.host.toWorld();
         if (!fn) return;
         const p = fn(event.clientX, event.clientY);
         if (Math.hypot(p.x - d.start.x, p.y - d.start.y) * this.host.zoom() > 4) d.moved = true;
         if (d.moved) {
            this.host.marqueeStart = d.start;
            this.host.marqueeEnd.set(p);
         }
         return;
      }
      if (d.kind === 'll') {
         this.host.store.moveLifeline(d.id, d.startVal + (event.clientX - d.start) / this.host.zoom());
      } else if (d.kind === 'llw') {
         this.applyWidth(d, event.clientX);
      } else if (d.kind === 'msg') {
         // Follow the cursor, snapped to the nearest row so spacing stays even.
         this.host.moveMessages(d, event.clientY);
      } else if (d.kind === 'diagram') {
         this.host.shiftDiagram(d, event);
      } else if (d.kind === 'resize') {
         this.host.applyResize(d, event);
      } else if (d.kind === 'gap') {
         this.applyGap(d, event);
      } else if (d.kind === 'connect' || d.kind === 'endpoint') {
         const fn = this.host.toWorld();
         if (fn) this.host.tempTo.set(fn(event.clientX, event.clientY));
      }
   };

   onUp = (event: PointerEvent): void => {
      this.host.endDrag();
      const d = this.host.drag;
      if (this.host.duplicating) {
         // Released before the copy existed: leave the original put and the copy in place.
         if (d?.kind === 'diagram') this.host.smartDragEnd()?.();
         this.host.drag = null;
         return;
      }
      if (d?.kind === 'marquee') {
         const rect = d.moved ? this.host.marqueeRect$() : null;
         this.host.marqueeEnd.set(null);
         this.host.marqueeStart = null;
         if (rect) this.selectMessagesIn(rect);
         else this.host.store.toggleSequence(this.host.diagram$().id);
      } else if (d?.kind === 'llw') {
         this.applyWidth(d, event.clientX);
         const l = this.host.store.lifelines().find((x) => x.id === d.id);
         if (l && l.width !== d.startWidth) {
            void this.host.store.updateLifeline(d.id, { width: l.width }, { width: d.startWidth });
         }
      } else if (d?.kind === 'connect') {
         const fn = this.host.toWorld();
         const w = fn ? fn(event.clientX, event.clientY) : this.host.tempTo();
         const target = w ? this.host.nearestLifeline(w.x) : null;
         if (target && target.id !== d.fromId) {
            void this.host.store.addMessage(this.host.diagram$().id, d.fromId, target.id, w ? w.y : d.startY);
         }
         this.host.connectFromId.set(null);
         this.host.tempTo.set(null);
      } else if (d?.kind === 'endpoint') {
         const fn = this.host.toWorld();
         const w = fn ? fn(event.clientX, event.clientY) : this.host.tempTo();
         const target = w ? this.host.nearestLifeline(w.x) : null;
         // Both ends on one participant would leave no arrow, so that drop is ignored.
         const msg = this.host.msgs().find((x) => x.id === d.id);
         const otherId = d.which === 'from' ? msg?.toLifelineId : msg?.fromLifelineId;
         if (target && target.id !== otherId) {
            void this.host.store.updateMessage(
               d.id,
               d.which === 'from' ? { fromLifelineId: target.id } : { toLifelineId: target.id }
            );
         }
         this.host.endpointDragInfo.set(null);
         this.host.tempTo.set(null);
      } else if (d?.kind === 'msg') {
         // Finalize at the release position (robust even without intermediate moves).
         this.host.moveMessages(d, event.clientY);
         if (!this.host.dragCopied) {
            const byId = new Map(this.host.store.sequenceMessages().map((m) => [m.id, m.y] as const));
            const moves = [...d.startYs]
               .map(([id, from]) => ({ id, from, to: byId.get(id) ?? from }))
               .filter((m) => this.host.rowY(m.from) !== this.host.rowY(m.to));
            this.host.store.recordMessageMoves(moves);
         }
      } else if (d?.kind === 'll') {
         if (!this.host.dragCopied) {
            const now = this.host.store.lifelines().find((x) => x.id === d.id);
            if (now && Math.abs(now.x - d.startVal) > 0.5) {
               this.host.store.recordLifelineMove(d.id, d.startVal, now.x);
            }
         }
      } else if (d?.kind === 'diagram' || d?.kind === 'resize' || d?.kind === 'gap') {
         // Apply the final position once more from the release point (covers drags
         // where no intermediate pointermove fired), then persist everything.
         if (d.kind === 'diagram') {
            this.host.shiftDiagram(d, event);
            // Only now: the final shift above still snaps against the drag's start box.
            this.host.smartDragEnd()?.();
         } else if (d.kind === 'gap') {
            this.applyGap(d, event);
         } else {
            this.host.applyResize(d, event);
            this.host.smartDragEnd()?.();
         }
         const ids =
            d.kind === 'diagram' ? [d.diagramId, ...d.others.map((o) => o.diagramId)] : [this.host.diagram$().id];
         for (const id of ids) {
            for (const l of this.host.store.lifelines().filter((x) => x.diagramId === id)) {
               this.host.store.moveLifeline(l.id, l.x);
            }
            // Messages moved with the diagram — persist their new rows too.
            for (const m of this.host.store.sequenceMessages().filter((x) => x.diagramId === id)) {
               this.host.store.moveMessage(m.id, m.y);
            }
            const cfg = this.host.store.sequenceDiagrams().find((x) => x.id === id);
            if (cfg) {
               void this.host.store.updateSequenceConfig(
                  id,
                  {
                     rowSpacing: cfg.rowSpacing,
                     originY: cfg.originY,
                     ...(d.kind === 'resize' && d.scaled !== 1
                        ? { headerHeight: cfg.headerHeight, scale: cfg.scale ?? 1 }
                        : {}),
                     ...(d.kind === 'resize' ? this.host.boundsOf(cfg) : {}),
                  },
                  false
               );
            }
            if (d.kind === 'resize' && d.scaled !== 1) {
               for (const l of this.host.store.lifelines().filter((x) => x.diagramId === id)) {
                  const was = d.startWidths.get(l.id);
                  if (was !== undefined && was !== l.width) {
                     void this.host.store.updateLifeline(l.id, { width: l.width }, undefined, false);
                  }
               }
            }
         }
         const own = d.kind === 'diagram' ? d.diagramId : this.host.diagram$().id;
         const befores = new Map(this.host.othersBefore);
         if (this.host.layoutBefore) befores.set(own, this.host.layoutBefore);
         // One undo step for the whole gesture: every moved diagram plus its companions.
         this.host.store.batchHistorySync(() => {
            if (d.kind === 'diagram' && !this.host.dragCopied) {
               // Companion elements, tables and the routes between them moved too.
               const c = d.companions;
               const els = new Map(this.host.store.elements().map((e) => [e.id, e] as const));
               const tbs = new Map(this.host.store.tables().map((t) => [t.id, t] as const));
               const rels = new Map(this.host.store.relationships().map((r) => [r.id, r] as const));
               const pos = <T extends { x: number; y: number }>(
                  m: Map<string, T>,
                  id: string,
                  f: { x: number; y: number }
               ) => {
                  const cur = m.get(id);
                  return cur ? { x: cur.x, y: cur.y } : f;
               };
               this.host.store.recordItemMoves(
                  { elements: c.elements, tables: c.tables, waypoints: c.waypoints },
                  {
                     elements: new Map([...c.elements].map(([id, f]) => [id, pos(els, id, f)])),
                     tables: new Map([...c.tables].map(([id, f]) => [id, pos(tbs, id, f)])),
                     waypoints: new Map([...c.waypoints].map(([id, wp]) => [id, rels.get(id)?.waypoints ?? wp])),
                  }
               );
            }
            for (const [dId, before] of befores) {
               const after = this.host.snapshotLayout(dId);
               if (!this.host.dragCopied && this.host.layoutChanged(before, after)) {
                  this.host.store.recordSequenceLayout(dId, before, after);
               }
            }
         });
         this.host.layoutBefore = null;
         this.host.othersBefore = new Map();
      }
      this.host.drag = null;
   };
}
