import { GroupTransformService } from './group-transform.service';
import { CanvasSnapService } from '../../../services/canvas-snap.service';
import { CanvasViewService } from '../../../services/canvas-view.service';
import { EditorToolService } from '../../../services/editor-tool.service';
import { PointerGestureService } from '../../../services/pointer-gesture.service';
import { DEFAULT_FONT_SIZE } from '../../../helpers/render/text-layout';
import type { SequenceStart } from '../../../models/sequence-start.model';
import { EditorViewportService } from '../../../services/editor-viewport.service';
import { inject, signal, Injectable, type WritableSignal } from '@angular/core';
import type { CanvasElementModel } from '@devdesigner/shared';
import { presentationOf, presentationSlides } from '@devdesigner/shared';
import { ProjectStore, type ItemMoves } from '../../../state/project/project.store';
import { GridTableService } from '../../../services/grid-table.service';
import { gridCellAt } from '../../../helpers/grid-table.helper';
import {
   type ResizeDownEvent,
   type ShapeBendEvent,
   type ShapeEndpointEvent,
   type ShapePointerEvent,
} from '../../canvas/components/canvas-shapes/canvas-shapes.component';
import { frameContents } from '../../../helpers/frame-contents.helper';
import { absolutePoints, elementBox, hitTestElement, tableBox } from '../../../helpers/element-geometry.helper';
import { chordNormal } from '../../../helpers/freedraw-path.helper';
import { snapToGrid } from '../../../helpers/node-metrics.helper';
import { fitTextElement, TEXT_MAX_FONT_SIZE, TEXT_MIN_FONT_SIZE } from '../../../helpers/text-metrics';
import { type SmartSnap } from '../../../helpers/smart-guides.helper';
import type { Box } from '../../../models/geometry.model';
import { PANEL_MIN_H } from '../../../shared/constants/slide-panels.constants';
import type { ResizeHandle } from '../../canvas/components/canvas-shapes/canvas-shapes.component';
/** What element gestures reach in the editor entry; the entry wires it with `connect`. */
export interface ElementGestureHost {
   readonly selectedSlideSets: WritableSignal<string[]>;
   /** Slide frame boxes as last synced (duplicated slides are recorded so they don't drag the deck). */
   readonly slideBounds: Map<string, { x: number; y: number; w: number; h: number }>;
   handlePointerMove(event: PointerEvent): void;
   onPointerUp(): void;
   beginNodeDrag(tableId: string): void;
   syncSlideMoves(): void;
   newPresentationName(): string;
}

/** The element being moved/resized/rotated and its state at gesture start. */
export interface ElementGesture {
   id: string;
   /** Starting geometry of the element(s) at gesture start (for delta math). */
   start: { x: number; y: number; width: number; height: number; angle: number };
   /** The element's full state at gesture start (for undo history). */
   snapshot: CanvasElementModel;
   /** Additional selected elements moved together (id -> start x/y), move only. */
   others?: Map<string, { x: number; y: number }>;
   /** Tables carried along by a moved frame (id -> start x/y). */
   tables?: Map<string, { x: number; y: number }>;
   /** Manual relationship routes between two carried tables (id -> start waypoints). */
   waypoints?: Map<string, { x: number; y: number }[]>;
   /** Sequence diagrams carried along by a moved frame (id -> start layout). */
   sequences?: Map<string, SequenceStart>;
   handle?: ResizeHandle;
   which?: 'start' | 'end';
   /** Original points (absolute) for an endpoint drag. */
   points?: { x: number; y: number }[];
}

/**
 * Pointer gestures on canvas elements: press/select, move (carrying frame contents, tables and
 * diagrams), resize, rotate, endpoint and bend drags with arrow binding, and Alt-drag duplication.
 */
@Injectable()
export class ElementGestureService {
   private readonly store = inject(ProjectStore);
   private readonly gesture = inject(PointerGestureService);
   private readonly canvasView = inject(CanvasViewService);
   private readonly snap = inject(CanvasSnapService);
   private readonly viewport = inject(EditorViewportService);
   private readonly tools = inject(EditorToolService);
   private readonly grids = inject(GridTableService);
   private readonly groupTransform = inject(GroupTransformService);
   private host!: ElementGestureHost;

   connect(host: ElementGestureHost): void {
      this.host = host;
   }

   elementGesture: ElementGesture | null = null;

   /** Box of the shape/table an arrow endpoint will bind to (drawn as a highlight). */
   readonly bindHighlight = signal<{
      x: number;
      y: number;
      width: number;
      height: number;
   } | null>(null);

   // --- canvas element pointer (select / move / resize / rotate / endpoint) ---

   /**
    * Unfilled shapes are grabbable anywhere inside, so a click can land on several
    * stacked outlines. Pick the innermost (smallest) of the unfilled shapes at the
    * point, down to the first opaque element, instead of whichever was drawn last.
    */
   private pickInnermostAt(clicked: CanvasElementModel, event: PointerEvent): CanvasElementModel {
      const unfilled = (e: CanvasElementModel): boolean =>
         (e.type === 'rectangle' || e.type === 'ellipse' || e.type === 'diamond') &&
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
         if (cell) {
            this.grids.selectCell({ id: el.id, ...cell }, ev.shiftKey);
            this.beginCellDragSelect(el.id);
            return;
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

   /**
    * Everything fully inside any frame being moved (nested frames included) rides
    * along with it: elements, tables, and the manual routes between carried tables.
    * `extra` adds selected tables / diagrams (members of a mixed-kind group) that
    * move rigidly with the grabbed element. Null when nothing rides along.
    */
   private carriedByFrames(
      moving: { has(id: string): boolean },
      extra?: { tableIds: ReadonlySet<string>; diagramIds: ReadonlySet<string> }
   ): {
      elements: Map<string, { x: number; y: number }>;
      tables: Map<string, { x: number; y: number }>;
      waypoints: Map<string, { x: number; y: number }[]>;
      sequences: Map<string, SequenceStart>;
   } | null {
      const all = this.store.elements();
      const hasFrame = all.some((e) => e.type === 'frame' && moving.has(e.id));
      if (!hasFrame && !extra?.tableIds.size && !extra?.diagramIds.size) {
         return null;
      }
      const inner = hasFrame
         ? frameContents(
              { has: (id) => moving.has(id) } as ReadonlySet<string>,
              all,
              this.store.tables(),
              this.store.sequenceDiagrams(),
              this.store.lifelines(),
              this.store.sequenceMessages(),
              this.store.shownSlideIds()
           )
         : {
              elementIds: new Set<string>(),
              tableIds: new Set<string>(),
              diagramIds: new Set<string>(),
           };
      // Selected tables / diagrams (a group of mixed kinds) travel with the element.
      extra?.tableIds.forEach((id) => inner.tableIds.add(id));
      extra?.diagramIds.forEach((id) => inner.diagramIds.add(id));
      const elements = new Map<string, { x: number; y: number }>();
      for (const e of all) {
         if (inner.elementIds.has(e.id)) {
            elements.set(e.id, { x: e.x, y: e.y });
         }
      }
      const tables = new Map<string, { x: number; y: number }>();
      for (const t of this.store.tables()) {
         if (inner.tableIds.has(t.id)) {
            tables.set(t.id, { x: t.x, y: t.y });
         }
      }
      const waypoints = new Map<string, { x: number; y: number }[]>();
      if (tables.size) {
         const locs = this.canvasView.columnLocations();
         for (const rel of this.store.relationships()) {
            const st = locs.get(rel.sourceColumnId)?.table.id;
            const tt = locs.get(rel.targetColumnId)?.table.id;
            if (st && tt && tables.has(st) && tables.has(tt) && rel.waypoints?.length) {
               waypoints.set(
                  rel.id,
                  rel.waypoints.map((w) => ({ ...w }))
               );
            }
         }
      }
      const sequences = new Map<string, SequenceStart>();
      for (const id of inner.diagramIds) {
         const start = this.canvasView.sequenceStart(id);
         if (start) {
            sequences.set(id, start);
         }
      }
      return { elements, tables, waypoints, sequences };
   }

   /** Add freshly created copies (inside a duplicated frame) to the running drag. */
   private attachCarried(elementIds: string[], tableIds: string[], diagramIds: string[]): void {
      const g = this.elementGesture;
      if (!g?.others) {
         return;
      }
      for (const id of elementIds) {
         const e = this.store.elements().find((x) => x.id === id);
         if (e) {
            g.others.set(id, { x: e.x, y: e.y });
         }
      }
      g.tables = new Map(
         this.store
            .tables()
            .filter((t) => tableIds.includes(t.id))
            .map((t) => [t.id, { x: t.x, y: t.y }])
      );
      g.sequences = new Map(
         diagramIds
            .map((id) => [id, this.canvasView.sequenceStart(id)] as const)
            .filter((e): e is readonly [string, SequenceStart] => !!e[1])
      );
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
      const grid = this.snap.gridSnap();
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

   /**
    * Resize a shape by a corner handle. Shift keeps proportions, Alt resizes about
    * the center, and grid snap (when on) snaps the dimensions.
    */
   resizeElement(ev: PointerEvent): void {
      const g = this.elementGesture;
      if (!g?.handle) {
         return;
      }
      const s = g.start;
      const zoom = this.store.viewport().zoom * this.gesture.gestureScale;
      const dx = (ev.clientX - this.gesture.startClientX) / zoom;
      const dy = (ev.clientY - this.gesture.startClientY) / zoom;
      const left = g.handle === 'nw' || g.handle === 'sw' || g.handle === 'w';
      const top = g.handle === 'nw' || g.handle === 'ne' || g.handle === 'n';
      // A side (not a corner) of a shape resizes on that axis only.
      const onlyX = g.handle === 'e' || g.handle === 'w';
      const onlyY = g.handle === 'n' || g.handle === 's';
      const cx = s.x + s.width / 2;
      const cy = s.y + s.height / 2;
      const factor = ev.altKey ? 2 : 1;

      const resized = this.store.elements().find((e) => e.id === g.id);
      if (onlyX && resized?.type === 'text') {
         // A side handle on text fixes its width: it wraps and the height follows the text.
         let width = Math.max(24, s.width + (left ? -dx : dx) * factor);
         if (this.snap.gridSnap()) {
            width = Math.max(24, snapToGrid(width));
         }
         const wrapped: CanvasElementModel = { ...resized, wrap: true };
         const size = fitTextElement(wrapped, { width });
         const nx = ev.altKey ? cx - width / 2 : left ? s.x + s.width - width : s.x;
         this.store.patchElementLocal(g.id, {
            x: Math.round(nx),
            width,
            height: size.height,
            wrap: true,
         });
         return;
      }
      // Text has no top/bottom side handles (its height follows its text).
      if (onlyY && resized?.type === 'text') {
         return;
      }
      // Pictures keep their proportions by default; Shift frees them (inverse of shapes).
      // A side drag stretches on its one axis, pictures too.
      const keepProportions = onlyX || onlyY ? false : resized?.type === 'image' ? !ev.shiftKey : ev.shiftKey;

      const grow = onlyY ? 0 : (left ? -dx : dx) * factor;
      const growY = onlyX ? 0 : (top ? -dy : dy) * factor;
      let width: number;
      let height: number;
      if (keepProportions && s.width > 0 && s.height > 0) {
         // Project the drag onto the box's diagonal so the corner tracks the cursor
         // smoothly instead of jumping between the two axes.
         const diag = s.width * s.width + s.height * s.height;
         const frameMinH = this.store.slideFrames().some((f) => f.id === g.id) ? PANEL_MIN_H / s.height : 0;
         const minScale = Math.max(8 / Math.min(s.width, s.height), frameMinH);
         let scale = Math.max(minScale, 1 + (grow * s.width + growY * s.height) / diag);
         const smart =
            ev.altKey || resized?.type === 'text'
               ? null
               : this.resizeSnap(g.id, s, left, top, s.width * scale, s.height * scale);
         if (smart?.snappedX || smart?.snappedY) {
            const w = s.width * scale + (smart.snappedX ? (left ? -smart.ox : smart.ox) : 0);
            const h = s.height * scale + (smart.snappedY ? (top ? -smart.oy : smart.oy) : 0);
            // Follow whichever edge snapped (X wins when both did).
            scale = Math.max(minScale, smart.snappedX ? w / s.width : h / s.height);
         } else if (this.snap.gridSnap()) {
            // Snap one dimension and derive the other so the ratio survives snapping.
            scale = Math.max(minScale, snapToGrid(s.width * scale) / s.width);
         }
         width = s.width * scale;
         height = s.height * scale;
      } else {
         // A slide frame is never shorter than the panels pinned to it.
         const minH = this.store.slideFrames().some((f) => f.id === g.id) ? PANEL_MIN_H : 8;
         width = Math.max(8, s.width + grow);
         height = Math.max(minH, s.height + growY);
         const smart =
            ev.altKey || resized?.type === 'text'
               ? null
               : this.resizeSnap(g.id, s, left, top, width, height, { x: !onlyY, y: !onlyX });
         // The axis a side drag leaves alone keeps its size exactly (no grid snapping either).
         if (!onlyY) {
            if (smart?.snappedX) width = Math.max(8, width + (left ? -smart.ox : smart.ox));
            else if (this.snap.gridSnap()) width = Math.max(8, snapToGrid(width));
         }
         if (!onlyX) {
            if (smart?.snappedY) height = Math.max(minH, height + (top ? -smart.oy : smart.oy));
            else if (this.snap.gridSnap()) height = Math.max(minH, snapToGrid(height));
         }
      }

      let x: number;
      let y: number;
      if (ev.altKey) {
         x = cx - width / 2;
         y = cy - height / 2;
      } else {
         x = left ? s.x + s.width - width : s.x;
         y = top ? s.y + s.height - height : s.y;
      }

      // Resizing a TEXT element scales its font (like Excalidraw): the handles
      // never change where the text wraps, only how big it is. The dragged corner
      // projects onto the box diagonal, and the opposite corner stays anchored.
      const el = this.store.elements().find((e) => e.id === g.id);
      if (el?.type === 'text') {
         const startFont = g.snapshot.fontSize ?? DEFAULT_FONT_SIZE;
         const diag = s.width * s.width + s.height * s.height;
         const raw = diag > 0 ? 1 + (grow * s.width + growY * s.height) / diag : 1;
         let fontSize = startFont * Math.max(0.05, raw);
         fontSize = Math.min(TEXT_MAX_FONT_SIZE, Math.max(TEXT_MIN_FONT_SIZE, fontSize));
         fontSize = Math.round(fontSize * 2) / 2;
         // A fixed-width block scales its width with the font so its wrapping is unchanged.
         const size = fitTextElement(el, {
            fontSize,
            width: el.wrap ? s.width * (fontSize / startFont) : undefined,
         });
         const tx = ev.altKey ? cx - size.width / 2 : left ? s.x + s.width - size.width : s.x;
         const ty = ev.altKey ? cy - size.height / 2 : top ? s.y + s.height - size.height : s.y;
         this.store.patchElementLocal(g.id, {
            x: Math.round(tx),
            y: Math.round(ty),
            width: size.width,
            height: size.height,
            fontSize,
         });
         return;
      }

      if (el?.type === 'grid') {
         // Columns share the new width proportionally; rows scale too but never
         // shrink below what their text needs, so cell content is never clipped.
         // Text scales with the table like a text box does: by the drag projected onto
         // the box diagonal, so a corner drag in any direction grows/shrinks it evenly.
         const r = this.groupTransform.gridResize(g.snapshot, width, height);
         const w = r.width;
         const h = r.height;
         this.store.patchElementLocal(g.id, {
            ...r,
            x: ev.altKey ? cx - w / 2 : left ? s.x + s.width - w : s.x,
            y: ev.altKey ? cy - h / 2 : top ? s.y + s.height - h : s.y,
         });
         return;
      }

      if (el?.type === 'freedraw') {
         // Scale the stroke's points from the start box into the new one.
         const sx = width / s.width;
         const sy = height / s.height;
         const pts = absolutePoints(g.snapshot).map((p) => ({ x: x + (p.x - s.x) * sx, y: y + (p.y - s.y) * sy }));
         const o = pts[0] ?? { x, y };
         this.store.patchElementLocal(g.id, {
            x: o.x,
            y: o.y,
            width,
            height,
            points: pts.map((p) => ({ x: p.x - o.x, y: p.y - o.y })),
         });
         return;
      }

      this.store.patchElementLocal(g.id, { x, y, width, height });
   }

   /** Smart-guide snap of the dragged corner's edges for a resize to (width, height). */
   private resizeSnap(
      id: string,
      s: { x: number; y: number; width: number; height: number; angle?: number | null },
      left: boolean,
      top: boolean,
      width: number,
      height: number,
      /** Which axes are being resized (a side drag moves one edge only). */
      axes: { x: boolean; y: boolean } = { x: true, y: true }
   ): SmartSnap | null {
      // Rotated boxes have no axis-aligned edges to line up.
      if (s.angle) return null;
      const x0 = left ? s.x + s.width - width : s.x;
      const y0 = top ? s.y + s.height - height : s.y;
      const box = { x0, y0, x1: x0 + width, y1: y0 + height };
      return this.snap.smartEdges(
         id,
         box,
         axes.x ? [left ? box.x0 : box.x1] : [],
         axes.y ? [top ? box.y0 : box.y1] : []
      );
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

   /** Drag a line/arrow endpoint, binding to a table/element under the cursor. */
   moveEndpoint(clientX: number, clientY: number): void {
      const g = this.elementGesture;
      if (!g?.points || !g.which) {
         return;
      }
      const el = this.store.elements().find((e) => e.id === g.id);
      if (!el) {
         return;
      }
      let world = this.viewport.toWorld(clientX, clientY);
      const target = this.bindingTargetAt(world, g.id);
      this.bindHighlight.set(target?.box ?? null);
      const binding = target?.binding ?? null;
      const pts = g.points.map((p) => ({ ...p }));
      const idx = g.which === 'start' ? 0 : pts.length - 1;
      if (!binding) {
         // The neighbouring point anchors the Shift angle lock.
         const anchor = pts[g.which === 'start' ? 1 : pts.length - 2] ?? pts[idx];
         if (this.gesture.shiftHeld) {
            // Lock to 45° steps around the anchor, keeping the cursor's distance along it.
            const vx = world.x - anchor.x;
            const vy = world.y - anchor.y;
            const step = Math.PI / 4;
            const ang = Math.round(Math.atan2(vy, vx) / step) * step;
            const ux = Math.cos(ang);
            const uy = Math.sin(ang);
            let len = vx * ux + vy * uy;
            const px = anchor.x + ux * len;
            const py = anchor.y + uy * len;
            const box = {
               x0: Math.min(px, anchor.x),
               y0: Math.min(py, anchor.y),
               x1: Math.max(px, anchor.x),
               y1: Math.max(py, anchor.y),
            };
            // Snap along the locked direction: slide the point until its x or y hits a guide.
            const smart = this.snap.smartEdges(
               g.id,
               box,
               Math.abs(ux) > 1e-6 ? [px] : [],
               Math.abs(uy) > 1e-6 ? [py] : []
            );
            const lx = smart?.snappedX ? (px + smart.ox - anchor.x) / ux : null;
            const ly = smart?.snappedY ? (py + smart.oy - anchor.y) / uy : null;
            const pick = [lx, ly]
               .filter((v): v is number => v !== null)
               .sort((a, b) => Math.abs(a - len) - Math.abs(b - len))[0];
            if (pick !== undefined) {
               len = pick;
               if (smart && pick !== lx)
                  Object.assign(smart, { snappedX: false, guides: smart.guides.filter((q) => q.axis === 'y') });
               if (smart && pick !== ly)
                  Object.assign(smart, { snappedY: false, guides: smart.guides.filter((q) => q.axis === 'x') });
               this.snap.smartSnapState.set(
                  smart?.guides.length ? { snap: smart, view: this.snap.smartBase?.view } : null
               );
            } else if (this.snap.gridSnap()) {
               len = snapToGrid(len);
            }
            world = { x: Math.round(anchor.x + ux * len), y: Math.round(anchor.y + uy * len) };
         } else {
            const box = {
               x0: Math.min(world.x, anchor.x),
               y0: Math.min(world.y, anchor.y),
               x1: Math.max(world.x, anchor.x),
               y1: Math.max(world.y, anchor.y),
            };
            const smart = this.snap.smartEdges(g.id, box, [world.x], [world.y]);
            const grid = this.snap.gridSnap();
            world = {
               x: smart?.snappedX ? world.x + smart.ox : grid ? snapToGrid(world.x) : Math.round(world.x),
               y: smart?.snappedY ? world.y + smart.oy : grid ? snapToGrid(world.y) : Math.round(world.y),
            };
         }
      } else {
         this.snap.smartSnapState.set(null);
      }
      pts[idx] = world;
      // Points are stored relative to the element origin (its first point).
      const origin = pts[0];
      const relative = pts.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y }));
      this.store.patchElementLocal(g.id, {
         x: origin.x,
         y: origin.y,
         points: relative,
         ...(g.which === 'start' ? { startBinding: binding } : { endBinding: binding }),
      });
   }

   /** The table or element under a world point that a bound endpoint can attach to. */
   bindingTargetAt(
      world: { x: number; y: number },
      excludeElementId: string
   ): {
      binding: { targetKind: 'element' | 'table' | 'message'; targetId: string };
      box: { x: number; y: number; width: number; height: number };
   } | null {
      const toRect = (b: Box) => ({ x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 });
      // Sequence message labels are small and sit on top of everything: check first.
      for (const [id, box] of this.canvasView.messageBoxes()) {
         if (this.pointInBox(world, box)) {
            return { binding: { targetKind: 'message', targetId: id }, box: toRect(box) };
         }
      }
      for (const table of this.store.tables()) {
         const box = tableBox(table);
         if (this.pointInBox(world, box)) {
            return { binding: { targetKind: 'table', targetId: table.id }, box: toRect(box) };
         }
      }
      // Topmost element first (elements render in ascending zIndex order).
      const elements = this.canvasView.shownElements().reverse();
      for (const el of elements) {
         if (el.id === excludeElementId || el.type === 'line' || el.type === 'arrow' || el.type === 'frame') {
            continue;
         }
         const box = elementBox(el);
         if (this.pointInBox(world, box)) {
            return { binding: { targetKind: 'element', targetId: el.id }, box: toRect(box) };
         }
      }
      return null;
   }

   private pointInBox(p: { x: number; y: number }, box: Box): boolean {
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
         const scaled = el.type === 'text';
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

   /**
    * Switch an in-progress move (element or table drag) into a duplicate-drag: put
    * the originals back where the drag began, clone the selection in place, and
    * carry on dragging the copies from the same pointer origin. Works when Alt is
    * held at pointer-down or pressed part-way through the drag.
    */
   async duplicateAndDrag(): Promise<void> {
      const kind = this.gesture.mode;
      if (this.gesture.dragCopied || (kind !== 'element' && kind !== 'node') || !this.store.canEdit()) {
         return;
      }
      this.gesture.dragCopied = true;
      const grabbedElement = this.elementGesture?.id ?? null;
      const grabbedTable = this.gesture.dragTableId;
      if (kind === 'element') {
         const g = this.elementGesture;
         this.store.moveItemsLocal({
            elements: g?.others,
            tables: g?.tables,
            waypoints: g?.waypoints,
            sequences: [...(g?.sequences ?? [])].map(([id, seq]) => ({
               diagramId: id,
               startXs: seq.xs,
               dx: 0,
               startOriginY: seq.originY,
               dy: 0,
               startRows: seq.rows,
            })),
         });
      } else {
         this.store.moveItemsLocal({
            tables: this.gesture.multiDragStart,
            waypoints: new Map([...this.gesture.waypointDragStart].map(([relId, start]) => [relId, start.wp])),
            ...this.nodeExtrasMoves(0, 0),
         });
      }
      this.gesture.mode = 'duplicating';
      let resume: (() => void) | null = null;
      let created: string[] = [];
      const selectedIds = this.store.selectedElementIds();
      const slideNames =
         kind === 'element'
            ? [
                 ...new Set(
                    this.store
                       .slideFrames()
                       .filter((f) => selectedIds.includes(f.id))
                       .map((f) => presentationOf(f))
                 ),
              ]
            : [];
      if (slideNames.length) {
         // Alt-dragging presentations' slides copies each whole presentation: every slide
         // with its contents, under a new name, dragged off as one set. Anything else
         // selected is copied alongside.
         // The originals were put back above; bring their other (hidden) slides back with
         // them now, before copies exist that the catch-up could mistake for their own slides.
         this.host.syncSlideMoves();
         const copied = new Set<string>();
         const allCopies = new Map<string, CanvasElementModel>();
         const tableCopies: string[] = [];
         const sequenceCopies: string[] = [];
         const selectedCopies: string[] = [];
         const names: string[] = [];
         for (const presentation of slideNames) {
            const frames = presentationSlides(this.store.slideFrames(), presentation);
            const frameIds = new Set(frames.map((f) => f.id));
            const inner = frameContents(
               frameIds,
               this.store.elements(),
               this.store.tables(),
               this.store.sequenceDiagrams(),
               this.store.lifelines(),
               this.store.sequenceMessages(),
               this.store.shownSlideIds()
            );
            const name = this.host.newPresentationName();
            names.push(name);
            const sources = this.store.elements().filter((e) => frameIds.has(e.id) || inner.elementIds.has(e.id));
            sources.forEach((e) => copied.add(e.id));
            // One optimistic clone per presentation: the copies show at once.
            const cloned = this.store.cloneItems(inner.tableIds, inner.diagramIds, sources, 0, 0, {
               presentation: name,
            });
            cloned.copies.forEach((c, id) => allCopies.set(id, c));
            tableCopies.push(...cloned.tables.values());
            sequenceCopies.push(...cloned.diagrams.values());
            const shown = frames.find((f) => selectedIds.includes(f.id));
            const shownCopy = shown && cloned.copies.get(shown.id);
            if (shownCopy) {
               this.store.setActiveSlide(shownCopy.id);
               selectedCopies.push(shownCopy.id);
            }
         }
         // The rest of the selection (not part of a copied presentation) is copied too.
         const rest = new Set(selectedIds.filter((id) => !copied.has(id)));
         if (rest.size) {
            const inner = this.carriedByFrames(rest);
            const sources = this.store.elements().filter((e) => rest.has(e.id) || inner?.elements.has(e.id));
            const cloned = this.store.cloneItems(
               new Set(inner?.tables.keys() ?? []),
               new Set(inner?.sequences.keys() ?? []),
               sources,
               0,
               0
            );
            cloned.copies.forEach((c, id) => allCopies.set(id, c));
            tableCopies.push(...cloned.tables.values());
            sequenceCopies.push(...cloned.diagrams.values());
            for (const id of rest) {
               const c = cloned.copies.get(id);
               if (c) selectedCopies.push(c.id);
            }
         }
         created = [...allCopies.values()].map((c) => c.id);
         const grabbed =
            (grabbedElement && allCopies.get(grabbedElement)) ||
            allCopies.get(selectedIds.find((id) => allCopies.has(id)) ?? '');
         if (grabbed) {
            resume = () => {
               this.store.setSelection([], [], selectedCopies);
               // Record where the copied slides start, so the release catches the hidden ones up
               // (as in a plain slide drag) instead of moving every slide on each pointer move.
               for (const c of allCopies.values()) {
                  if (c.type === 'frame' && c.slide) {
                     this.host.slideBounds.set(c.id, { x: c.x, y: c.y, w: c.width, h: c.height });
                  }
               }
               this.beginElementDrag(grabbed);
               // Only what's on the shown slides (and the rest of the selection) rides along.
               const g = this.elementGesture;
               const carried = g?.others && this.carriedByFrames(g.others);
               if (g?.others && carried) {
                  for (const [id, pos] of carried.elements) g.others.set(id, pos);
                  g.tables = carried.tables;
                  g.waypoints = carried.waypoints;
                  g.sequences = carried.sequences;
               }
               this.host.selectedSlideSets.set(names);
            };
         }
      } else if (kind === 'element') {
         const selected = new Set(this.store.selectedElementIds());
         // Duplicating a frame duplicates what's inside it too (tables, sequence
         // diagrams, and elements), and the copies travel with the copied frame.
         const inner = this.carriedByFrames(selected);
         // One optimistic clone of selected + inner items: shows at once, one undo step,
         // bindings between copies remap and a copied slide's contents follow its copy.
         const sources = this.store.elements().filter((e) => selected.has(e.id) || inner?.elements.has(e.id));
         const cloned = this.store.cloneItems(
            new Set(inner?.tables.keys() ?? []),
            new Set(inner?.sequences.keys() ?? []),
            sources,
            0,
            0
         );
         const copies = cloned.copies;
         const tableCopies = [...cloned.tables.values()];
         const sequenceCopies = [...cloned.diagrams.values()];
         created = [...copies.values()].map((c) => c.id);
         // An Alt-dragged slide becomes the one shown (only one slide is on the canvas).
         const slideCopy = [...copies.values()].find((c) => c.type === 'frame' && c.slide);
         if (slideCopy) {
            this.store.setActiveSlide(slideCopy.id);
         }
         const grabbed = (grabbedElement && copies.get(grabbedElement)) || [...copies.values()][0];
         if (grabbed) {
            const innerElementCopies = [...(inner?.elements.keys() ?? [])]
               .map((id) => copies.get(id)?.id)
               .filter((id): id is string => !!id);
            resume = () => {
               // Select only what was selected; the inner copies ride along as carried content.
               const selectedCopies = [...selected].map((id) => copies.get(id)?.id).filter((id): id is string => !!id);
               this.store.setSelection([], [], selectedCopies);
               this.beginElementDrag(grabbed);
               this.attachCarried(innerElementCopies, tableCopies, sequenceCopies);
            };
         }
      } else {
         const cloned = this.store.cloneItems(
            new Set(this.store.selectedTableIds()),
            new Set(),
            [],
            0,
            0,
            // Only selected relationships between the copied tables are copied.
            { relationshipIds: new Set(this.store.selectedRelationshipIds()) }
         );
         const ids = cloned.tables;
         created = [...ids.values()];
         const relCopies = cloned.relationships;
         this.store.setSelection(created, relCopies, []);
         const grabbed = (grabbedTable && ids.get(grabbedTable)) || created[0];
         if (grabbed) {
            resume = () => this.host.beginNodeDrag(grabbed);
         }
      }
      if (this.gesture.mode !== 'duplicating' || !resume) {
         // Nothing was copied (or the gesture was cancelled meanwhile).
         this.gesture.releasedWhileDuplicating = false;
         if (this.gesture.mode === 'duplicating') {
            this.gesture.mode = 'idle';
            this.gesture.gestureActive.set(false);
         }
         return;
      }
      // The snap targets were taken with the originals moving: now they stay put and
      // the copies move, so measure against them afresh.
      this.snap.smartBase = null;
      resume();
      if (this.gesture.lastPointer) {
         this.host.handlePointerMove(this.gesture.lastPointer);
      }
      if (this.gesture.releasedWhileDuplicating) {
         // The button was let go before the copies existed: land them where it was dropped.
         this.gesture.releasedWhileDuplicating = false;
         this.host.onPointerUp();
      }
   }
}
