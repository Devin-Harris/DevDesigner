import { CanvasDblClickService } from './features/elements/services/canvas-dblclick.service';
import { DeckPanelsService } from './features/slides/services/deck-panels.service';
import { DrawToolService } from './features/elements/services/draw-tool.service';
import { ElementGestureService } from './features/elements/services/element-gesture.service';
import { LaserInputService } from './features/collaboration/services/laser-input.service';
import { GroupTransformService } from './features/elements/services/group-transform.service';
import { CanvasSnapService } from './services/canvas-snap.service';
import { CanvasViewService } from './services/canvas-view.service';
import { EditorToolService } from './services/editor-tool.service';
import { RelationshipLinkService } from './features/erd/services/relationship-link.service';
import { PointerGestureService } from './services/pointer-gesture.service';
import { SlidePlacementService } from './features/slides/services/slide-placement.service';
import { DeckFocusService } from './features/slides/services/deck-focus.service';
import { EditorViewportService } from './services/editor-viewport.service';
import { computed, inject, signal, Injectable, DestroyRef } from '@angular/core';
import { PenPrefsService } from './services/pen-prefs.service';
import type { TableModel } from '@devdesigner/shared';
import { ProjectStore } from './state/project/project.store';
import { GridTableService } from './services/grid-table.service';
import { elementBox, elementIntersectsRect } from './helpers/element-geometry.helper';
import { tableHeight, snapToGrid, tableWidth } from './helpers/node-metrics.helper';
import type { Rect } from './models/geometry.model';
/**
 * The canvas pointer dispatcher: a press on empty canvas (pan, marquee, draw, laser), then every
 * window pointer move / release routed to the gesture in progress (links, segments, draws, erases,
 * element and table drags, group resizes, spacing, pans, marquees). Part of the editor entry: it
 * composes the sub-features' gesture services.
 */
@Injectable()
export class EditorPointerService {
   private readonly store = inject(ProjectStore);
   private readonly gesture = inject(PointerGestureService);
   private readonly canvasView = inject(CanvasViewService);
   private readonly snap = inject(CanvasSnapService);
   private readonly viewport = inject(EditorViewportService);
   private readonly tools = inject(EditorToolService);
   private readonly grids = inject(GridTableService);
   private readonly penPrefs = inject(PenPrefsService);
   private readonly drawTool = inject(DrawToolService);
   private readonly elementGestures = inject(ElementGestureService);
   private readonly groupTransform = inject(GroupTransformService);
   private readonly relLink = inject(RelationshipLinkService);
   private readonly deckFocus = inject(DeckFocusService);
   private readonly deckPanels = inject(DeckPanelsService);
   private readonly placement = inject(SlidePlacementService);
   private readonly dblClick = inject(CanvasDblClickService);
   private readonly laserInput = inject(LaserInputService);
   private readonly destroyRef = inject(DestroyRef);
   /** Moves waiting for the next animation frame (only the latest, except while drawing). */
   private pendingMoves: PointerEvent[] = [];
   private moveFrame = 0;

   constructor() {
      // A native listener: an idle mouse move costs no change detection, and moves are
      // handled once per frame (the pen keeps every sample so strokes stay smooth).
      const onMove = (event: PointerEvent): void => this.onPointerMove(event);
      window.addEventListener('pointermove', onMove);
      this.destroyRef.onDestroy(() => {
         window.removeEventListener('pointermove', onMove);
         cancelAnimationFrame(this.moveFrame);
      });
   }

   /** Run the moves still waiting for their frame now (before a release or key acts on them). */
   flushPointerMoves(): void {
      cancelAnimationFrame(this.moveFrame);
      this.moveFrame = 0;
      const moves = this.pendingMoves;
      this.pendingMoves = [];
      for (const event of moves) this.handlePointerMove(event);
   }

   // Marquee (screen coords relative to the canvas)
   private readonly marqueeStart = signal<{ x: number; y: number } | null>(null);

   private readonly marqueeCurrent = signal<{ x: number; y: number } | null>(null);

   readonly marqueeRect = computed<{
      left: number;
      top: number;
      width: number;
      height: number;
   } | null>(() => {
      const s = this.marqueeStart();
      const c = this.marqueeCurrent();
      if (!s || !c) {
         return null;
      }
      return {
         left: Math.min(s.x, c.x),
         top: Math.min(s.y, c.y),
         width: Math.abs(s.x - c.x),
         height: Math.abs(s.y - c.y),
      };
   });

   private marqueeAdditive = false;

   // --- canvas pointer (pan / marquee) ---

   onCanvasPointerDown(event: PointerEvent): void {
      // Clicking away closes a grid cell editor even when the click does not move focus.
      if (this.grids.editingCell()) {
         this.grids.endEdit();
      }
      if (
         !this.deckFocus.focusedDeck() &&
         (event.button === 1 || (event.button === 0 && (this.gesture.spaceDown || this.tools.activeTool() === 'hand')))
      ) {
         event.preventDefault();
         this.gesture.mode = 'pan';
         this.tools.panning.set(true);
         this.gesture.startClientX = event.clientX;
         this.gesture.startClientY = event.clientY;
         const v = this.store.viewport();
         this.gesture.startViewportX = v.x;
         this.gesture.startViewportY = v.y;
         return;
      }
      if (event.button !== 0) {
         return;
      }
      const tool = this.tools.activeTool();
      if (tool !== 'select' && tool !== 'hand' && tool !== 'laser' && this.store.canEdit() && this.store.projectId()) {
         event.preventDefault();
         if (tool === 'table') {
            this.drawTool.addTableAt(event.clientX, event.clientY);
            this.tools.afterPlace();
            return;
         }
         if (tool === 'sequence') {
            this.drawTool.addSequenceAt(event.clientX, event.clientY);
            this.tools.afterPlace();
            return;
         }
         if (tool === 'slide') {
            // A click adds a slide: the first where you click, later ones stacked on the shown one.
            void this.placement.addSlide(this.viewport.toWorld(event.clientX, event.clientY));
            this.tools.afterPlace();
            return;
         }
         if (tool === 'freedraw' && this.penPrefs.eraser()) {
            this.drawTool.beginErase(event);
            return;
         }
         this.drawTool.beginDraw(tool, event);
         return;
      }
      // Grabbing a master or layout item drawn under a shown slide or layout gives that frame its own
      // copy, selected and (while the button is held) dragged like any item.
      if (tool === 'select' && this.store.canEdit() && !PointerGestureService.additive(event)) {
         const inherited = this.dblClick.inheritedMasterItemAt(this.viewport.toWorld(event.clientX, event.clientY));
         if (inherited) {
            event.preventDefault();
            void this.dblClick.grabInherited(inherited.item, inherited.frame, event);
            return;
         }
      }
      this.marqueeAdditive = PointerGestureService.additive(event);
      if (!this.marqueeAdditive) {
         this.store.clearSelection();
      }
      const p = this.viewport.screenPoint(event.clientX, event.clientY);
      this.marqueeStart.set(p);
      this.marqueeCurrent.set(p);
      this.gesture.mode = 'marquee';
   }

   // --- global pointer + keyboard ---

   /**
    * Items on the canvas are moved by our own pointer handling. A native HTML drag
    * (selected text in a code block, an <img>) would draw the browser's translucent
    * drag image at the item's old spot and swallow the pointer moves, so block it.
    */
   onNativeDragStart(event: DragEvent): void {
      const target = event.target as Node | null;
      const el = target instanceof HTMLElement ? target : target?.parentElement;
      if (el?.closest('input, textarea, [contenteditable="true"]')) return;
      if (el && this.viewport.canvasRef().nativeElement.contains(el)) {
         event.preventDefault();
      }
   }

   onPointerMove(event: PointerEvent): void {
      this.gesture.lastPointer = event;
      this.gesture.shiftHeld = event.shiftKey;
      if (this.gesture.mode === 'draw') {
         this.pendingMoves.push(event);
      } else {
         this.pendingMoves = [event];
      }
      if (!this.moveFrame) {
         this.moveFrame = requestAnimationFrame(() => this.flushPointerMoves());
      }
   }

   handlePointerMove(event: PointerEvent): void {
      if (this.gesture.mode === 'duplicating') {
         return; // copies are still being created; the drag resumes from lastPointer
      }
      this.gesture.broadcastCursor(event);
      if (this.relLink.linkSourceColumnId() || this.relLink.relinkState()) {
         this.relLink.linkCursor.set(this.viewport.toWorld(event.clientX, event.clientY));
         return;
      }
      if (this.relLink.activeSegment()) {
         this.relLink.moveActiveSegment(event.clientX, event.clientY);
         return;
      }
      if (this.gesture.mode === 'draw') {
         this.drawTool.updateDraw(event.clientX, event.clientY, event.shiftKey, event.altKey);
         return;
      }
      if (this.gesture.mode === 'erase') {
         this.drawTool.eraseAt(event.clientX, event.clientY);
         return;
      }
      if (this.gesture.mode === 'element') {
         this.elementGestures.moveElements(event.clientX, event.clientY);
         return;
      }
      if (this.gesture.mode === 'element-resize') {
         this.elementGestures.resizeElement(event);
         return;
      }
      if (this.gesture.mode === 'group-resize') {
         this.groupTransform.groupResizeMove(event);
         return;
      }
      if (this.gesture.mode === 'spacing') {
         this.groupTransform.spacingMove(event);
         return;
      }
      if (this.gesture.mode === 'element-rotate') {
         this.elementGestures.rotateElement(event);
         return;
      }
      if (this.gesture.mode === 'arrow-endpoint') {
         this.elementGestures.moveEndpoint(event.clientX, event.clientY);
         return;
      }
      if (this.gesture.mode === 'arrow-bend') {
         this.elementGestures.moveBend(event.clientX, event.clientY);
         return;
      }
      if (this.gesture.mode === 'pan') {
         const dx = event.clientX - this.gesture.startClientX;
         const dy = event.clientY - this.gesture.startClientY;
         const v = this.store.viewport();
         this.store.setViewport(this.gesture.startViewportX + dx, this.gesture.startViewportY + dy, v.zoom);
      } else if (this.gesture.mode === 'node' && this.gesture.dragTableId) {
         if (this.gesture.belowDragThreshold(event.clientX, event.clientY)) {
            return;
         }
         this.gesture.movingItems.set(true);
         let { dx, dy } = this.gesture.dragDelta(event.clientX, event.clientY);
         const smart = this.snap.smartDelta(
            this.gesture.dragTableId,
            this.gesture.nodeExtras?.elements.keys() ?? [],
            this.gesture.multiDragStart.keys(),
            dx,
            dy,
            this.gesture.nodeExtras?.sequences.keys() ?? []
         );
         dx += smart?.ox ?? 0;
         dy += smart?.oy ?? 0;
         const grid = this.snap.gridSnap();
         // The tables' actual (snapped) move, so routes carried with them stay attached.
         let moved: { x: number; y: number } | null = null;
         const tables = new Map<string, { x: number; y: number }>();
         for (const [id, start] of this.gesture.multiDragStart) {
            const nx = grid && !smart?.snappedX ? snapToGrid(start.x + dx) : Math.round(start.x + dx);
            const ny = grid && !smart?.snappedY ? snapToGrid(start.y + dy) : Math.round(start.y + dy);
            tables.set(id, { x: nx, y: ny });
            if (id === this.gesture.dragTableId || !moved) moved = { x: nx - start.x, y: ny - start.y };
         }
         const mx = moved?.x ?? dx;
         const my = moved?.y ?? dy;
         const waypoints = new Map<string, { x: number; y: number }[]>();
         // Keep manual routes attached as their tables move. Both endpoints moving
         // together: translate the whole route rigidly. A single endpoint moving:
         // the waypoint nearest that anchor follows it in y (its horizontal run
         // stays parallel, the vertical run to it shrinks or grows); its x is
         // absorbed by the horizontal run, and every other waypoint stays put.
         for (const [relId, start] of this.gesture.waypointDragStart) {
            if (!start.wp.length) {
               continue;
            }
            if (start.both) {
               waypoints.set(
                  relId,
                  start.wp.map((w) => ({ x: Math.round(w.x + mx), y: Math.round(w.y + my) }))
               );
               continue;
            }
            const near = start.sourceMoved ? 0 : start.wp.length - 1;
            waypoints.set(
               relId,
               start.wp.map((w, i) => ({
                  x: Math.round(w.x),
                  y: Math.round(i === near ? w.y + my : w.y),
               }))
            );
         }
         // Tables, their routes and the items riding along: one state write per frame.
         this.store.moveItemsLocal({ tables, waypoints, ...this.elementGestures.nodeExtrasMoves(mx, my) });
      } else if (this.gesture.mode === 'marquee') {
         this.marqueeCurrent.set(this.viewport.screenPoint(event.clientX, event.clientY));
      }
   }

   onPointerUp(): void {
      this.flushPointerMoves();
      if (this.gesture.mode === 'duplicating') {
         // The copies are still being created; finish the drop once they exist.
         this.gesture.releasedWhileDuplicating = true;
         return;
      }
      this.relLink.commitLinkSnap();
      const edgeGesture =
         this.gesture.mode === 'element-resize' ||
         this.gesture.mode === 'arrow-endpoint' ||
         this.gesture.mode === 'draw';
      const moved =
         this.gesture.mode === 'element' || this.gesture.mode === 'node'
            ? { elements: [...this.store.selectedElementIds()], tables: [...this.store.selectedTableIds()] }
            : null;
      if (this.gesture.mode === 'marquee') {
         this.commitMarquee();
      } else if (this.gesture.mode === 'draw') {
         void this.drawTool.commitDraft(false);
      } else if (this.gesture.mode === 'erase') {
         this.drawTool.commitErase();
      } else if (this.gesture.mode === 'element') {
         this.elementGestures.recordMoveGesture();
      } else if (this.gesture.mode === 'node') {
         this.elementGestures.settleNodeExtras();
      } else if (this.gesture.mode === 'group-resize') {
         this.groupTransform.commitGroupResize();
      } else if (this.gesture.mode === 'spacing') {
         this.groupTransform.commitSpacingDrag();
      } else if (
         this.gesture.mode === 'element-resize' ||
         this.gesture.mode === 'element-rotate' ||
         this.gesture.mode === 'arrow-endpoint' ||
         this.gesture.mode === 'arrow-bend'
      ) {
         this.elementGestures.commitElementGesture();
      }
      this.gesture.mode = 'idle';
      this.tools.panning.set(false);
      this.gesture.dragTableId = null;
      this.gesture.nodeExtras = null;
      this.elementGestures.elementGesture = null;
      this.gesture.gestureActive.set(false);
      this.gesture.movingItems.set(false);
      this.elementGestures.bindHighlight.set(null);
      this.gesture.multiDragStart.clear();
      this.gesture.waypointDragStart.clear();
      this.marqueeStart.set(null);
      this.marqueeCurrent.set(null);
      this.relLink.persistFlippedSides();
      this.relLink.activeSegment.set(null);
      this.relLink.clearLinking();
      this.gesture.gestureScale = 1;
      // Sequence diagrams run their own drags and clear this after their final shift.
      if (moved || edgeGesture) this.snap.smartDragEnd();
      if (moved) {
         this.placement.releaseDroppedOutOfSlides(moved);
      }
   }

   private commitMarquee(): void {
      const s = this.marqueeStart();
      const c = this.marqueeCurrent();
      if (!s || !c) {
         return;
      }
      const v = this.store.viewport();
      const toW = (p: { x: number; y: number }) => ({
         x: (p.x - v.x) / v.zoom,
         y: (p.y - v.y) / v.zoom,
      });
      const a = toW(s);
      const b = toW(c);
      const rect: Rect = {
         minX: Math.min(a.x, b.x),
         minY: Math.min(a.y, b.y),
         maxX: Math.max(a.x, b.x),
         maxY: Math.max(a.y, b.y),
      };

      // A slide's items are seen only through its block (scaled when zoomed out, clipped at
      // its edge): test them against the part of the marquee over the block, in the
      // slide's own coordinates. Items hidden past the edge cannot be picked.
      const rectIn = (id: string): Rect | null => {
         const view = this.canvasView.viewOf(id);
         return view ? this.canvasView.rectThrough(view, rect) : rect;
      };
      const tableIds = this.canvasView
         .visibleTables()
         .filter((t) => {
            const r = rectIn(t.id);
            return !!r && this.boxIntersects(t, r);
         })
         .map((t) => t.id);
      const zoomedRels = this.canvasView.zoomedConnectorIds();
      const relIds = this.canvasView
         .connectors()
         .filter((con) => {
            const view = zoomedRels.get(con.id);
            const r = view ? this.canvasView.rectThrough(view, rect) : rect;
            return !!r && con.mx >= r.minX && con.mx <= r.maxX && con.my >= r.minY && con.my <= r.maxY;
         })
         .map((con) => con.id);
      const elementIds = this.canvasView
         .shownElements()
         .filter((e) => {
            const r = rectIn(e.id);
            return !!r && elementIntersectsRect(e, r);
         })
         .map((e) => e.id);

      // Sequence parts of a slide's diagrams are tested through that slide's block.
      const viewedDiagrams = this.canvasView.zoomedItems().diagrams;
      const diagramRect = (diagramId: string): Rect | null => {
         const view = viewedDiagrams.get(diagramId);
         return view ? this.canvasView.rectThrough(view, rect) : rect;
      };
      const sequenceHits = (find: (r: Rect) => string[], diagramOf: (id: string) => string | undefined): string[] => {
         const out = find(rect).filter((id) => !viewedDiagrams.has(diagramOf(id) ?? ''));
         for (const view of new Set(viewedDiagrams.values())) {
            const r = this.canvasView.rectThrough(view, rect);
            if (r) out.push(...find(r).filter((id) => viewedDiagrams.get(diagramOf(id) ?? '') === view));
         }
         return out;
      };
      const messageIds = sequenceHits(
         (r) => this.messagesInRect(r),
         (id) => this.store.sequenceMessages().find((m) => m.id === id)?.diagramId
      );
      const lifelineIds = this.store
         .lifelines()
         .filter((l) => {
            const d = this.store.sequenceDiagrams().find((x) => x.id === l.diagramId);
            const r = diagramRect(l.diagramId);
            if (!d || !r) return false;
            const left = l.x - l.width / 2;
            return (
               left <= r.maxX && left + l.width >= r.minX && d.originY <= r.maxY && d.originY + d.headerHeight >= r.minY
            );
         })
         .map((l) => l.id);

      const diagramIds = sequenceHits(
         (r) => this.diagramsInRect(r),
         (id) => id
      );
      // A diagram swept up whole is selected as a unit; its parts needn't be listed too.
      const hit = new Set(diagramIds);
      const looseMessages = messageIds.filter(
         (id) => !hit.has(this.store.sequenceMessages().find((m) => m.id === id)?.diagramId ?? '')
      );
      const looseLifelines = lifelineIds.filter(
         (id) => !hit.has(this.store.lifelines().find((l) => l.id === id)?.diagramId ?? '')
      );

      // A marquee that fully encloses a presentation's outline selects that presentation
      // as a whole (like grabbing its border): its shown frame stands in for everything
      // inside the outline, and whatever else the marquee caught stays selected too.
      const sx0 = Math.min(s.x, c.x);
      const sy0 = Math.min(s.y, c.y);
      const sx1 = Math.max(s.x, c.x);
      const sy1 = Math.max(s.y, c.y);
      const enclosed = this.deckPanels
         .slideSets()
         .filter(
            (set) =>
               set.outline.left >= sx0 &&
               set.outline.top >= sy0 &&
               set.outline.left + set.outline.width <= sx1 &&
               set.outline.top + set.outline.height <= sy1
         );
      let tableSel = tableIds;
      let elementSel = elementIds;
      if (enclosed.length) {
         const boxes = enclosed.map((set) => {
            const o = toW({ x: set.outline.left, y: set.outline.top });
            return {
               x0: o.x,
               y0: o.y,
               x1: o.x + set.outline.width / v.zoom,
               y1: o.y + set.outline.height / v.zoom,
            };
         });
         const inside = (b: { x0: number; y0: number; x1: number; y1: number }) =>
            boxes.some((o) => b.x0 >= o.x0 && b.y0 >= o.y0 && b.x1 <= o.x1 && b.y1 <= o.y1);
         const frameIds = enclosed.map((set) => set.frameId);
         tableSel = this.canvasView
            .visibleTables()
            .filter(
               (t) =>
                  tableIds.includes(t.id) &&
                  !inside({ x0: t.x, y0: t.y, x1: t.x + tableWidth(t), y1: t.y + tableHeight(t) })
            )
            .map((t) => t.id);
         elementSel = [
            ...frameIds,
            ...this.canvasView
               .shownElements()
               .filter((e) => elementIds.includes(e.id) && !frameIds.includes(e.id) && !inside(elementBox(e)))
               .map((e) => e.id),
         ];
         this.store.selectPresentation(enclosed[0].name);
      }

      if (this.marqueeAdditive) {
         const nextTables = new Set([...this.store.selectedTableIds(), ...tableSel]);
         const nextRels = new Set([...this.store.selectedRelationshipIds(), ...relIds]);
         const nextEls = new Set([...this.store.selectedElementIds(), ...elementSel]);
         const nextMsgs = new Set([...this.store.selectedMessageIds(), ...looseMessages]);
         const nextLls = new Set([...this.store.selectedLifelineIds(), ...looseLifelines]);
         const nextDiagrams = new Set([...this.store.selectedDiagramIds(), ...diagramIds]);
         this.store.setSelection(
            [...nextTables],
            [...nextRels],
            [...nextEls],
            [...nextMsgs],
            [...nextLls],
            [...nextDiagrams]
         );
      } else {
         this.store.setSelection(tableSel, relIds, elementSel, looseMessages, looseLifelines, diagramIds);
      }
      const names = enclosed.map((set) => set.name);
      this.deckPanels.selectedSlideSets.set(
         this.marqueeAdditive ? [...new Set([...this.deckPanels.selectedSlideSets(), ...names])] : names
      );
   }

   /** Sequence messages whose snapped row line crosses the marquee rect. */
   private messagesInRect(rect: Rect): string[] {
      const lifelines = this.store.lifelines();
      const out: string[] = [];
      for (const d of this.store.sequenceDiagrams()) {
         const lls = lifelines.filter((l) => l.diagramId === d.id);
         if (!lls.length) continue;
         const byId = new Map(lls.map((l) => [l.id, l.x] as const));
         const minX = Math.min(...lls.map((l) => l.x));
         const maxX = Math.max(...lls.map((l) => l.x));
         const hb = d.originY + d.headerHeight;
         for (const m of this.store.sequenceMessages()) {
            if (m.diagramId !== d.id) continue;
            const isBreak = m.style === 'break';
            const fx = byId.get(m.fromLifelineId);
            const tx = byId.get(m.toLifelineId);
            if (!isBreak && (fx === undefined || tx === undefined)) continue;
            const left = isBreak ? minX : Math.min(fx!, tx!);
            const right = isBreak ? maxX : Math.max(fx!, tx!);
            const y = hb + d.rowSpacing * Math.max(1, Math.round((m.y - hb) / d.rowSpacing));
            if (left <= rect.maxX && right >= rect.minX && y >= rect.minY && y <= rect.maxY) {
               out.push(m.id);
            }
         }
      }
      return out;
   }

   /** Sequence diagrams whose bounding box (as drawn) lies entirely inside the marquee rect. */
   private diagramsInRect(rect: Rect): string[] {
      const out: string[] = [];
      for (const d of this.store.sequenceDiagrams()) {
         const b = this.canvasView.diagramBox(d);
         // Only a diagram the marquee fully encloses is picked as a unit; a partial sweep
         // selects just the messages/participants it touches.
         if (b && b.minX >= rect.minX && b.maxX <= rect.maxX && b.minY >= rect.minY && b.maxY <= rect.maxY) {
            out.push(d.id);
         }
      }
      return out;
   }

   private boxIntersects(table: TableModel, rect: Rect): boolean {
      const left = table.x;
      const right = table.x + tableWidth(table);
      const top = table.y;
      const bottom = table.y + tableHeight(table);
      return left <= rect.maxX && right >= rect.minX && top <= rect.maxY && bottom >= rect.minY;
   }
}
