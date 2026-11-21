import { GroupTransformService } from './group-transform.service';
import { CanvasSnapService } from '../../../services/canvas-snap.service';
import { CanvasViewService } from '../../../services/canvas-view.service';
import { EditorToolService } from '../../../services/editor-tool.service';
import { PointerGestureService } from '../../../services/pointer-gesture.service';
import type { SequenceStart } from '../../../models/sequence-start.model';
import { EditorViewportService } from '../../../services/editor-viewport.service';
import { Injectable, inject, signal } from '@angular/core';
import { type CanvasElementModel, type ElementBinding } from '@devdesigner/shared';
import { type ItemMoves, ProjectStore } from '../../../state/project/project.store';
import { GridTableService } from '../../../services/grid-table.service';
import { gridCellAt } from '../../../helpers/grid-table.helper';
import type {
   ResizeDownEvent,
   ShapeBendEvent,
   ShapeEndpointEvent,
   ShapePointerEvent,
} from '../../canvas/components/canvas-shapes/canvas-shapes.component';
import { absolutePoints, elementBox, hitTestElement } from '../../../helpers/element-geometry.helper';
import { chordNormal } from '../../../helpers/freedraw-path.helper';
import { snapToGrid } from '../../../helpers/node-metrics.helper';
import type { Box } from '../../../models/geometry.model';
import { type ElementGesture, type ElementGestureHost } from './element-gesture.helpers';
import { ElementResize } from './element-resize';
import { ElementDuplicateDrag } from './element-duplicate-drag';

/**
 * Pointer gestures on canvas elements: press/select, move (carrying frame contents, tables and
 * diagrams), resize, rotate, endpoint and bend drags with arrow binding, and Alt-drag duplication.
 */
@Injectable()
export class ElementGestureService {
   /** Methods moved to element-duplicate-drag.ts. */
   private readonly elementDuplicateDrag = new ElementDuplicateDrag(this);

   /** Methods moved to element-resize.ts. */
   private readonly elementResize = new ElementResize(this);

   readonly store = inject(ProjectStore);
   readonly gesture = inject(PointerGestureService);
   readonly canvasView = inject(CanvasViewService);
   readonly snap = inject(CanvasSnapService);
   readonly viewport = inject(EditorViewportService);
   private readonly tools = inject(EditorToolService);
   private readonly grids = inject(GridTableService);
   readonly groupTransform = inject(GroupTransformService);
   host!: ElementGestureHost;

   connect(host: ElementGestureHost): void {
      this.host = host;
   }

   elementGesture: ElementGesture | null = null;

   /** Boxes of the shapes/tables the arrow being drawn or dragged binds to (drawn as highlights). */
   readonly bindHighlight$ = signal<readonly { x: number; y: number; width: number; height: number }[]>([]);

   // --- canvas element pointer (select / move / resize / rotate / endpoint) ---

   /**
    * Unfilled shapes are grabbable anywhere inside, so a click can land on several
    * stacked outlines. Pick the innermost (smallest) of the unfilled shapes at the
    * point, down to the first opaque element, instead of whichever was drawn last.
    */
   private pickInnermostAt(clicked: CanvasElementModel, event: PointerEvent): CanvasElementModel {
      const unfilled = (e: CanvasElementModel): boolean =>
         (e.type === 'rectangle' || e.type === 'ellipse' || e.type === 'diamond' || e.type === 'triangle') &&
         (e.fillStyle === 'none' || !e.backgroundColor);
      if (!unfilled(clicked)) {
         return clicked;
      }
      const world = this.viewport.toWorld(event.clientX, event.clientY);
      const hits = this.canvasView
         .shownElements()
         .filter((e) => e.type !== 'frame' && hitTestElement(e, world))
         .reverse();
      let best = clicked;
      let bestArea = Infinity;
      for (const e of hits) {
         const b = elementBox(e);
         const area = (b.x1 - b.x0) * (b.y1 - b.y0);
         if (area < bestArea) {
            best = e;
            bestArea = area;
         }
         if (!unfilled(e)) {
            break;
         }
      }
      return best;
   }

   onElementPointerDown(payload: ShapePointerEvent): void {
      if (this.grids.editingCell()) {
         this.grids.endEdit();
      }
      const clicked = this.store.elements().find((e) => e.id === payload.id);
      if (!clicked) {
         this.host.selectedSlideSets.set([]);
         return;
      }
      const el = this.pickInnermostAt(clicked, payload.event);
      // A click inside an already-selected table works on its cells: click selects a
      // cell, Shift+click or a drag extends the selection (the table does not move).
      const sel = this.store.selectedElementIds();
      const ev = payload.event;
      if (
         el.type === 'grid' &&
         sel.length === 1 &&
         sel[0] === el.id &&
         !ev.ctrlKey &&
         !ev.metaKey &&
         !this.store.groupIdOf(el.id)
      ) {
         const cell = gridCellAt(el, this.viewport.toWorld(ev.clientX, ev.clientY));
         // With cells already picked (or Shift held) a drag extends the cell selection;
         // otherwise a drag moves the table and a plain click picks the cell.
         if (cell && (this.grids.range()?.id === el.id || ev.shiftKey || !this.store.canEdit())) {
            this.grids.selectCell({ id: el.id, ...cell }, ev.shiftKey);
            this.beginCellDragSelect(el.id);
            return;
         }
         if (cell) {
            this.selectCellOnClick(el.id, cell, ev);
         }
      }
      // Dragging part of the selection keeps whole-selected presentations selected.
      if (PointerGestureService.additive(payload.event) || !this.store.selectedElementIds().includes(el.id)) {
         this.host.selectedSlideSets.set([]);
      }
      if (PointerGestureService.additive(payload.event)) {
         this.store.selectElement(el.id, true);
         return;
      }
      if (!this.store.selectedElementIds().includes(el.id)) {
         this.store.selectElement(el.id, false);
      }
      if (el.type === 'grid') {
         // First click selects the whole table (styling applies to all of it).
         this.grids.clearCellSelection();
      }
      if (!this.store.canEdit()) {
         return;
      }
      this.gesture.startClientX = payload.event.clientX;
      this.gesture.startClientY = payload.event.clientY;
      this.gesture.gestureScale = this.canvasView.itemScale(payload.id);
      this.gesture.gestureActive.set(true);
      this.gesture.dragCopied = false;
      this.beginElementDrag(el);
      if (payload.event.altKey) {
         void this.duplicateAndDrag();
      }
   }

   /** Pick the cell on release when the press turned out to be a click rather than a move. */
   private selectCellOnClick(id: string, cell: { row: number; col: number }, down: PointerEvent): void {
      const up = (e: PointerEvent): void => {
         window.removeEventListener('pointerup', up);
         if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < 4) {
            this.grids.selectCell({ id, ...cell });
         }
      };
      window.addEventListener('pointerup', up);
   }

   /** Extend a grid's cell selection to whatever cell the pointer is dragged over. */
   private beginCellDragSelect(id: string): void {
      const move = (e: PointerEvent): void => {
         const el = this.store.elements().find((x) => x.id === id);
         const cell = el ? gridCellAt(el, this.viewport.toWorld(e.clientX, e.clientY)) : null;
         if (cell) {
            this.grids.selectCell({ id, ...cell }, true);
         }
      };
      const up = (): void => {
         window.removeEventListener('pointermove', move);
         window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
   }

   /** Start moving the current element selection, grabbed by `el`. */
   beginElementDrag(el: CanvasElementModel): void {
      this.gesture.mode = 'element';
      this.gesture.gestureActive.set(true);
      const others = new Map<string, { x: number; y: number }>();
      for (const id of this.store.selectedElementIds()) {
         const e = this.store.elements().find((x) => x.id === id);
         if (e) {
            others.set(id, { x: e.x, y: e.y });
         }
      }
      const carried = this.gesture.dragCopied
         ? null
         : this.carriedByFrames(others, {
              tableIds: new Set(this.store.selectedTableIds()),
              diagramIds: new Set(this.store.selectedDiagramIds()),
           });
      if (carried) {
         for (const [id, pos] of carried.elements) {
            others.set(id, pos);
         }
      }
      this.elementGesture = {
         id: el.id,
         start: { x: el.x, y: el.y, width: el.width, height: el.height, angle: el.angle },
         snapshot: el,
         others,
         tables: carried?.tables,
         waypoints: carried?.waypoints,
         sequences: carried?.sequences,
      };
   }

   onElementResizeDown(payload: ResizeDownEvent): void {
      const el = this.store.elements().find((e) => e.id === payload.id);
      if (!el || !this.store.canEdit()) {
         return;
      }
      if (this.groupTransform.startGroupResize(payload.handle, payload.event, payload.id)) {
         return;
      }
      this.gesture.mode = 'element-resize';
      this.gesture.gestureActive.set(true);
      this.gesture.startClientX = payload.event.clientX;
      this.gesture.startClientY = payload.event.clientY;
      this.gesture.gestureScale = this.canvasView.itemScale(el.id);
      // A pen stroke's x/y is its first point, not its bounds: resize from the drawn box.
      const pb = el.type === 'freedraw' ? elementBox(el) : null;
      this.elementGesture = {
         id: el.id,
         handle: payload.handle,
         start: pb
            ? {
                 x: pb.x0,
                 y: pb.y0,
                 width: Math.max(1, pb.x1 - pb.x0),
                 height: Math.max(1, pb.y1 - pb.y0),
                 angle: el.angle,
              }
            : { x: el.x, y: el.y, width: el.width, height: el.height, angle: el.angle },
         snapshot: el,
      };
   }

   onElementRotateDown(payload: ShapePointerEvent): void {
      const el = this.store.elements().find((e) => e.id === payload.id);
      if (!el || !this.store.canEdit()) {
         return;
      }
      this.gesture.mode = 'element-rotate';
      this.gesture.gestureActive.set(true);
      this.elementGesture = {
         id: el.id,
         start: { x: el.x, y: el.y, width: el.width, height: el.height, angle: el.angle },
         snapshot: el,
      };
   }

   onElementEndpointDown(payload: ShapeEndpointEvent): void {
      const el = this.store.elements().find((e) => e.id === payload.id);
      if (!el || !this.store.canEdit()) {
         return;
      }
      this.gesture.mode = 'arrow-endpoint';
      this.gesture.gestureActive.set(true);
      this.elementGesture = {
         id: el.id,
         which: payload.which,
         start: { x: el.x, y: el.y, width: el.width, height: el.height, angle: el.angle },
         snapshot: el,
         points: absolutePoints(el),
      };
   }

   onElementBendDown(payload: ShapeBendEvent): void {
      const el = this.store.elements().find((e) => e.id === payload.id);
      if (!el || !this.store.canEdit()) {
         return;
      }
      this.gesture.mode = 'arrow-bend';
      this.gesture.gestureActive.set(true);
      this.elementGesture = {
         id: el.id,
         start: { x: el.x, y: el.y, width: el.width, height: el.height, angle: el.angle },
         snapshot: el,
      };
   }

   /** Drag the bend handle: curvature is the pointer's signed distance from the chord. */
   moveBend(clientX: number, clientY: number): void {
      const g = this.elementGesture;
      const ends = g ? this.canvasView.shapeViews().find((s) => s.id === g.id)?.ends : undefined;
      if (!g || !ends) {
         return;
      }
      const n = chordNormal(ends.start, ends.end);
      if (!n) {
         return;
      }
      const world = this.viewport.toWorld(clientX, clientY);
      const mid = { x: (ends.start.x + ends.end.x) / 2, y: (ends.start.y + ends.end.y) / 2 };
      let curvature = (world.x - mid.x) * n.x + (world.y - mid.y) * n.y;
      // Snap back to a straight line when the handle is dragged close to the chord.
      if (Math.abs(curvature) < 6) {
         curvature = 0;
      }
      this.store.patchElementLocal(g.id, { curvature });
   }

   /** After a move drag, record the net displacement of each element for undo. */
   recordMoveGesture(): void {
      const g = this.elementGesture;
      if (!g?.others) {
         return;
      }
      const moves: { id: string; from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
      for (const [id, from] of g.others) {
         const el = this.store.elements().find((e) => e.id === id);
         if (el && (el.x !== from.x || el.y !== from.y)) {
            moves.push({ id, from, to: { x: el.x, y: el.y } });
         }
      }
      this.store.recordElementMove(moves);
      this.persistSequences(g.sequences?.keys() ?? []);
   }

   /** Persist sequence diagrams that were shifted live (the live shift is local-only). */
   private persistSequences(ids: Iterable<string>): void {
      for (const id of ids) {
         for (const l of this.store.lifelines().filter((x) => x.diagramId === id)) {
            this.store.moveLifeline(l.id, l.x);
         }
         for (const m of this.store.sequenceMessages().filter((x) => x.diagramId === id)) {
            this.store.moveMessage(m.id, m.y);
         }
         const cfg = this.store.sequenceDiagrams().find((x) => x.id === id);
         if (cfg) {
            void this.store.updateSequenceConfig(id, {
               rowSpacing: cfg.rowSpacing,
               originY: cfg.originY,
            });
         }
      }
   }

   /** After a table-grabbed drag, record/persist the elements and diagrams that rode along. */
   settleNodeExtras(): void {
      // The grabbed tables, the relationship bends that moved with them and the riders: one undo step.
      void this.store.batchHistory(async () => {
         this.recordTableDrag();
         this.recordRiders();
      });
   }

   /** Record where the dragged tables and their relationship bends went. */
   private recordTableDrag(): void {
      const tables = [...(this.gesture.multiDragStart ?? new Map<string, { x: number; y: number }>())].flatMap(
         ([id, from]) => {
            const t = this.store.tables().find((x) => x.id === id);
            return t && (t.x !== from.x || t.y !== from.y) ? [{ id, from, to: { x: t.x, y: t.y } }] : [];
         }
      );
      const waypoints = [...(this.gesture.waypointDragStart ?? new Map())].flatMap(([id, start]) => {
         const rel = this.store.relationships().find((r) => r.id === id);
         const to = rel?.waypoints ?? [];
         return rel && JSON.stringify(to) !== JSON.stringify(start.wp) ? [{ id, from: start.wp, to: [...to] }] : [];
      });
      this.store.recordTableDrag(tables, waypoints);
   }

   private recordRiders(): void {
      const ex = this.gesture.nodeExtras;
      if (!ex) {
         return;
      }
      const moves: { id: string; from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
      for (const [id, from] of ex.elements) {
         const el = this.store.elements().find((e) => e.id === id);
         if (el && (el.x !== from.x || el.y !== from.y)) {
            moves.push({ id, from, to: { x: el.x, y: el.y } });
         }
      }
      this.store.recordElementMove(moves);
      this.persistSequences(ex.sequences.keys());
   }

   /** Where the elements/diagrams riding with a grabbed table go when it has moved (mx, my). */
   nodeExtrasMoves(mx: number, my: number): Pick<ItemMoves, 'elements' | 'sequences'> {
      const ex = this.gesture.nodeExtras;
      if (!ex) {
         return {};
      }
      return {
         elements: new Map([...ex.elements].map(([id, p]) => [id, { x: p.x + mx, y: p.y + my }])),
         sequences: [...ex.sequences].map(([id, seq]) => ({
            diagramId: id,
            startXs: seq.xs,
            dx: mx,
            startOriginY: seq.originY,
            dy: my,
            startRows: seq.rows,
         })),
      };
   }

   moveElements(clientX: number, clientY: number): void {
      const g = this.elementGesture;
      if (!g?.others) {
         return;
      }
      // Don't snap an unaligned item to the grid on a plain click.
      if (this.gesture.belowDragThreshold(clientX, clientY)) {
         return;
      }
      this.gesture.movingItems.set(true);
      let { dx, dy } = this.gesture.dragDelta(clientX, clientY);
      const smart = this.snap.smartDelta(
         g.id,
         g.others.keys(),
         g.tables?.keys() ?? [],
         dx,
         dy,
         g.sequences?.keys() ?? []
      );
      dx += smart?.ox ?? 0;
      dy += smart?.oy ?? 0;
      const grid = this.snap.gridSnap$();
      const elements = new Map<string, { x: number; y: number }>();
      for (const [id, start] of g.others) {
         const nx = grid && !smart?.snappedX ? snapToGrid(start.x + dx) : Math.round(start.x + dx);
         const ny = grid && !smart?.snappedY ? snapToGrid(start.y + dy) : Math.round(start.y + dy);
         elements.set(id, { x: nx, y: ny });
      }
      const moves: ItemMoves = { elements };
      // Carry a frame's tables with it by the same (snapped) displacement as the frame.
      const grabbed = g.others.get(g.id);
      const to = elements.get(g.id);
      if (grabbed && to && (g.tables?.size || g.waypoints?.size || g.sequences?.size)) {
         const mx = to.x - grabbed.x;
         const my = to.y - grabbed.y;
         moves.tables = new Map([...(g.tables ?? [])].map(([id, start]) => [id, { x: start.x + mx, y: start.y + my }]));
         moves.waypoints = new Map(
            [...(g.waypoints ?? [])].map(([relId, wp]) => [
               relId,
               wp.map((w) => ({ x: Math.round(w.x + mx), y: Math.round(w.y + my) })),
            ])
         );
         moves.sequences = [...(g.sequences ?? [])].map(([id, seq]) => ({
            diagramId: id,
            startXs: seq.xs,
            dx: mx,
            startOriginY: seq.originY,
            dy: my,
            startRows: seq.rows,
         }));
      }
      // One state write per frame for the whole selection.
      this.store.moveItemsLocal(moves);
   }

   rotateElement(ev: PointerEvent): void {
      const g = this.elementGesture;
      if (!g) {
         return;
      }
      const cx = g.start.x + g.start.width / 2;
      const cy = g.start.y + g.start.height / 2;
      const world = this.viewport.toWorld(ev.clientX, ev.clientY);
      // Handle sits above the top edge, so offset by +90deg to make "up" = 0.
      let angle = Math.atan2(world.y - cy, world.x - cx) + Math.PI / 2;
      if (ev.shiftKey) {
         const step = Math.PI / 12; // snap to 15 degrees
         angle = Math.round(angle / step) * step;
      }
      this.store.patchElementLocal(g.id, { angle });
   }

   pointInBox(p: { x: number; y: number }, box: Box): boolean {
      return p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1;
   }

   /** Persist the element geometry changed by the just-finished gesture (with undo). */
   commitElementGesture(): void {
      const g = this.elementGesture;
      if (!g) {
         return;
      }
      const el = this.store.elements().find((e) => e.id === g.id);
      if (!el) {
         return;
      }
      const snap = g.snapshot;
      if (this.gesture.mode === 'element-resize') {
         const scaled = el.type === 'text' || (el.fontSize ?? null) !== (snap.fontSize ?? null);
         void this.store.commitElementGeometry(
            g.id,
            {
               x: snap.x,
               y: snap.y,
               width: snap.width,
               height: snap.height,
               ...(scaled ? { fontSize: snap.fontSize, wrap: snap.wrap ?? false } : {}),
               ...(el.type === 'grid' ? { text: snap.text ?? '', fontSize: snap.fontSize } : {}),
               ...(el.type === 'freedraw' ? { points: snap.points } : {}),
            },
            {
               x: el.x,
               y: el.y,
               width: el.width,
               height: el.height,
               ...(scaled ? { fontSize: el.fontSize, wrap: el.wrap ?? false } : {}),
               ...(el.type === 'grid' ? { text: el.text ?? '', fontSize: el.fontSize } : {}),
               ...(el.type === 'freedraw' ? { points: el.points } : {}),
            }
         );
      } else if (this.gesture.mode === 'element-rotate') {
         void this.store.commitElementGeometry(g.id, { angle: snap.angle }, { angle: el.angle });
      } else if (this.gesture.mode === 'arrow-bend') {
         void this.store.commitElementGeometry(
            g.id,
            { curvature: snap.curvature ?? 0 },
            { curvature: el.curvature ?? 0 }
         );
      } else if (this.gesture.mode === 'arrow-endpoint') {
         void this.store.commitElementGeometry(
            g.id,
            {
               x: snap.x,
               y: snap.y,
               points: snap.points,
               startBinding: snap.startBinding ?? null,
               endBinding: snap.endBinding ?? null,
            },
            {
               x: el.x,
               y: el.y,
               points: el.points,
               startBinding: el.startBinding ?? null,
               endBinding: el.endBinding ?? null,
            }
         );
      }
   }

   // ---- delegates to element-resize.ts ----
   resizeElement(ev: PointerEvent): void {
      return this.elementResize.resizeElement(ev);
   }
   moveEndpoint(clientX: number, clientY: number): void {
      return this.elementResize.moveEndpoint(clientX, clientY);
   }
   bindingTargetAt(
      world: { x: number; y: number },
      excludeElementId: string
   ): {
      binding: ElementBinding;
      box: { x: number; y: number; width: number; height: number };
   } | null {
      return this.elementResize.bindingTargetAt(world, excludeElementId);
   }

   // ---- delegates to element-duplicate-drag.ts ----
   private carriedByFrames(
      moving: { has(id: string): boolean },
      extra?: { tableIds: ReadonlySet<string>; diagramIds: ReadonlySet<string> }
   ): {
      elements: Map<string, { x: number; y: number }>;
      tables: Map<string, { x: number; y: number }>;
      waypoints: Map<string, { x: number; y: number }[]>;
      sequences: Map<string, SequenceStart>;
   } | null {
      return this.elementDuplicateDrag.carriedByFrames(moving, extra);
   }
   duplicateAndDrag(): Promise<void> {
      return this.elementDuplicateDrag.duplicateAndDrag();
   }
}
export type { ElementGestureHost, ElementGesture } from './element-gesture.helpers';
