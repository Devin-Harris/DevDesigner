import { CanvasViewService } from './canvas-view.service';
import { PointerGestureService } from './pointer-gesture.service';
import { computed, inject, signal, Injectable, effect } from '@angular/core';
import { type SlideView, toOuter } from '../helpers/slide-zoom.helper';
import { ProjectStore } from '../state/project/project.store';
import { sequenceDiagramBox } from '../helpers/frame-contents.helper';
import { elementBox, isPathElement, tableBox } from '../helpers/element-geometry.helper';
import { snapToGrid } from '../helpers/node-metrics.helper';
import { smartSnap, smartSnapEdges, snapTargets, type SmartSnap } from '../helpers/smart-guides.helper';
import type { Box } from '../models/geometry.model';
import { EditorViewportService } from './editor-viewport.service';
const GRID_SNAP_KEY = 'dd-grid-snap';

const SMART_GUIDES_KEY = 'dd-smart-guides';

function readStoredSmartGuides(): boolean {
   try {
      return globalThis.localStorage?.getItem(SMART_GUIDES_KEY) === '1';
   } catch {
      return false;
   }
}

function readStoredGrid(): boolean {
   try {
      return globalThis.localStorage?.getItem(GRID_SNAP_KEY) === '1';
   } catch {
      return false;
   }
}

/** What snapping reads from the editor entry; the entry wires it with `connect`. */
export interface CanvasSnapHost {
   /** Each deck's shown slide with its side panels (smart guides snap to the whole block). */
   presentationOutlineBoxes(): { frameId: string; box: Box }[];
}

/** Grid snap and smart guides (alignment snapping to nearby items while dragging or drawing). */
@Injectable()
export class CanvasSnapService {
   private readonly store = inject(ProjectStore);
   private readonly gesture = inject(PointerGestureService);
   private readonly canvasView = inject(CanvasViewService);
   private readonly viewport = inject(EditorViewportService);
   private host!: CanvasSnapHost;

   constructor() {
      // Remember both toggles across refreshes.
      effect(() => {
         const on = this.smartGuides();
         try {
            globalThis.localStorage?.setItem(SMART_GUIDES_KEY, on ? '1' : '0');
         } catch {
            // ignore storage errors
         }
      });
      effect(() => {
         const on = this.gridSnap();
         try {
            globalThis.localStorage?.setItem(GRID_SNAP_KEY, on ? '1' : '0');
         } catch {
            // ignore storage errors
         }
      });
   }

   connect(host: CanvasSnapHost): void {
      this.host = host;
   }

   readonly gridSnap = signal(readStoredGrid());

   /** Snap drags to nearby items' edges, centers and spacing (Figma-style guides). */
   readonly smartGuides = signal(readStoredSmartGuides());

   /** What the moving selection snaps against, captured when a drag starts. */
   smartBase: { box: Box; parts: Box[]; targets: Box[]; view?: SlideView } | null = null;

   /** Guides for the current drag, in world (or slide-inner) coordinates. */
   readonly smartSnapState = signal<{ snap: SmartSnap; view?: SlideView } | null>(null);

   /** The current drag's guides in canvas-screen px, for the overlay. */
   readonly smartGuideMarks = computed(() => {
      const st = this.smartSnapState();
      if (!st) return null;
      const v = this.store.viewport();
      const sp = (x: number, y: number) => {
         const p = st.view ? toOuter(st.view, { x, y }) : { x, y };
         return { x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y };
      };
      const seg = (axis: 'x' | 'y', pos: number, a: number, b: number) => {
         const p = axis === 'x' ? sp(pos, a) : sp(a, pos);
         const q = axis === 'x' ? sp(pos, b) : sp(b, pos);
         return { x1: p.x, y1: p.y, x2: q.x, y2: q.y };
      };
      return {
         lines: st.snap.guides.map((g) => seg(g.axis, g.pos, g.from, g.to)),
         gaps: st.snap.gaps.map((g) => {
            // A gap along x is a horizontal segment at y = cross.
            const s = seg(g.axis === 'x' ? 'y' : 'x', g.cross, g.a, g.b);
            const label = String(Math.round(g.b - g.a));
            const horiz = g.axis === 'x';
            const lx = (s.x1 + s.x2) / 2;
            const ly = (s.y1 + s.y2) / 2;
            const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
            // Room the label needs along the line (text width, or its height when vertical).
            const half = horiz ? label.length * 3.2 + 4 : 9;
            const T = 3; // end-tick half length
            const ticks = horiz
               ? [
                    { x1: s.x1, y1: s.y1 - T, x2: s.x1, y2: s.y1 + T },
                    { x1: s.x2, y1: s.y2 - T, x2: s.x2, y2: s.y2 + T },
                 ]
               : [
                    { x1: s.x1 - T, y1: s.y1, x2: s.x1 + T, y2: s.y1 },
                    { x1: s.x2 - T, y1: s.y2, x2: s.x2 + T, y2: s.y2 },
                 ];
            if (len > 2 * half + 6) {
               // Two lines: element -> label, label -> next element.
               const segs = horiz
                  ? [
                       { x1: s.x1, y1: ly, x2: lx - half, y2: ly },
                       { x1: lx + half, y1: ly, x2: s.x2, y2: ly },
                    ]
                  : [
                       { x1: lx, y1: s.y1, x2: lx, y2: ly - half },
                       { x1: lx, y1: ly + half, x2: lx, y2: s.y2 },
                    ];
               return { segs: [...segs, ...ticks], label, lx, ly };
            }
            // Too tight for the label inline: keep the line whole and set the label beside it.
            return { segs: [s, ...ticks], label, lx: horiz ? lx : lx + half + 4, ly: horiz ? ly - 9 : ly };
         }),
      };
   });

   /** Snap a world coordinate to the grid when grid-snap is enabled, else pass through. */
   readonly snapWorld = (n: number): number => (this.gridSnap() ? snapToGrid(n) : n);

   toggleGrid(): void {
      this.gridSnap.update((v) => !v);
   }

   /** Smart-guide hooks handed to sequence diagrams, which run their own drags. */
   readonly smartDrag = (
      diagramId: string,
      items: { diagrams: Iterable<string>; elements: Iterable<string>; tables: Iterable<string> },
      dx: number,
      dy: number
   ): SmartSnap | null => this.smartDelta(diagramId, items.elements, items.tables, dx, dy, items.diagrams);

   readonly smartDragEnd = (): void => {
      this.smartBase = null;
      this.smartSnapState.set(null);
   };

   toggleSmartGuides(): void {
      this.smartGuides.update((v) => !v);
   }

   /**
    * Smart-guide correction for a drag by (dx, dy) of the given items, grabbed by
    * `grabbedId`. Targets are the visible items nearest the selection in the same
    * space (the canvas, or the grabbed item's slide, whose frame counts too).
    */
   smartDelta(
      grabbedId: string,
      elementIds: Iterable<string>,
      tableIds: Iterable<string>,
      dx: number,
      dy: number,
      diagramIds: Iterable<string> = []
   ): SmartSnap | null {
      if (!this.smartGuides()) {
         this.smartSnapState.set(null);
         return null;
      }
      const base = this.ensureSmartBase(grabbedId, elementIds, tableIds, diagramIds);
      if (!base) return null;
      const moved = { x0: base.box.x0 + dx, y0: base.box.y0 + dy, x1: base.box.x1 + dx, y1: base.box.y1 + dy };
      const parts = base.parts.map((b) => ({ x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy }));
      const snap = smartSnap(
         moved,
         base.targets,
         this.store.viewport().zoom * this.canvasView.itemScale(grabbedId),
         parts
      );
      // Shift constrains the drag to one axis; don't let a snap pull it off.
      if (this.gesture.shiftHeld && dx === 0) Object.assign(snap, { ox: 0, snappedX: false });
      if (this.gesture.shiftHeld && dy === 0) Object.assign(snap, { oy: 0, snappedY: false });
      this.smartSnapState.set(snap.guides.length || snap.gaps.length ? { snap, view: base.view } : null);
      return snap;
   }

   /**
    * Smart-guide correction for a resize / endpoint drag of one element: only the
    * moving edge positions `xs` / `ys` (world coords) snap. `box` spans the guides.
    */
   smartEdges(
      id: string,
      box: Box,
      xs: number[],
      ys: number[],
      draft?: { ctx: string | null; view?: SlideView }
   ): SmartSnap | null {
      if (!this.smartGuides()) {
         this.smartSnapState.set(null);
         return null;
      }
      const base = this.ensureSmartBase(id, [id], [], [], draft ? { ...draft, box } : undefined);
      if (!base) return null;
      const scale = draft ? (draft.view?.scale ?? 1) : this.canvasView.itemScale(id);
      const snap = smartSnapEdges(box, xs, ys, base.targets, this.store.viewport().zoom * scale);
      this.smartSnapState.set(snap.guides.length ? { snap, view: base.view } : null);
      return snap;
   }

   /** Snap targets for a gesture on the given items, built once per gesture. */
   private ensureSmartBase(
      grabbedId: string,
      elementIds: Iterable<string>,
      tableIds: Iterable<string>,
      diagramIds: Iterable<string> = [],
      draft?: { box: Box; ctx: string | null; view?: SlideView }
   ): { box: Box; parts: Box[]; targets: Box[]; view?: SlideView } | null {
      if (!this.smartBase) {
         const moving = new Set([...elementIds, ...tableIds, ...diagramIds]);
         const els = this.store.elements();
         const tables = this.store.tables();
         const diagrams = this.store.sequenceDiagrams();
         const lifelines = this.store.lifelines();
         const messages = this.store.sequenceMessages();
         const grabbed =
            els.find((e) => e.id === grabbedId) ??
            tables.find((t) => t.id === grabbedId) ??
            diagrams.find((d) => d.id === grabbedId);
         // A shape being drawn isn't in the store yet: it brings its own box and space.
         const ctx = draft ? draft.ctx : (grabbed?.slideId ?? null);
         const boxes: Box[] = draft ? [draft.box] : [];
         for (const e of els) if (moving.has(e.id)) boxes.push(elementBox(e));
         for (const t of tables) if (moving.has(t.id)) boxes.push(tableBox(t));
         const diagramBoxes = new Map<string, Box>();
         for (const d of diagrams) {
            const b = sequenceDiagramBox(d, lifelines, messages);
            if (b) diagramBoxes.set(d.id, b);
            if (b && moving.has(d.id)) boxes.push(b);
         }
         if (!boxes.length) return null;
         const box = {
            x0: Math.min(...boxes.map((b) => b.x0)),
            y0: Math.min(...boxes.map((b) => b.y0)),
            x1: Math.max(...boxes.map((b) => b.x1)),
            y1: Math.max(...boxes.map((b) => b.y1)),
         };
         const all: Box[] = [];
         for (const e of els) {
            // Lines/arrows count (their box edges are their ends); freehand strokes don't.
            if (moving.has(e.id) || (isPathElement(e.type) && e.type !== 'line' && e.type !== 'arrow')) continue;
            if ((e.slideId ?? null) === ctx || e.id === ctx) all.push(elementBox(e));
         }
         for (const t of tables) {
            if (!moving.has(t.id) && (t.slideId ?? null) === ctx) all.push(tableBox(t));
         }
         for (const d of diagrams) {
            const b = diagramBoxes.get(d.id);
            if (b && !moving.has(d.id) && (d.slideId ?? null) === ctx) all.push(b);
         }
         // A presentation's dashed outline (around its panels and frame) is a snap target too.
         for (const p of this.host.presentationOutlineBoxes()) {
            if (ctx === null || p.frameId === ctx) all.push(p.box);
         }
         const view = draft
            ? draft.view && draft.view.scale !== 1
               ? draft.view
               : undefined
            : this.canvasView.itemScale(grabbedId) !== 1
              ? this.canvasView.viewOf(grabbedId)
              : undefined;
         this.smartBase = {
            box,
            parts: boxes,
            targets: snapTargets(box, all, ctx ? null : this.viewport.minimapView()),
            view,
         };
      }
      return this.smartBase;
   }
}
