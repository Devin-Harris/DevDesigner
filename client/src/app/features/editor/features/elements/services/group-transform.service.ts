import { CanvasSnapService } from '../../../services/canvas-snap.service';
import { CanvasViewService } from '../../../services/canvas-view.service';
import { PointerGestureService } from '../../../services/pointer-gesture.service';
import { DEFAULT_FONT_SIZE } from '../../../helpers/render/text-layout';
import { EditorViewportService } from '../../../services/editor-viewport.service';
import { computed, inject, signal, Injectable } from '@angular/core';
import type { CanvasElementModel, UpdateElementDto } from '@devdesigner/shared';
import { ProjectStore } from '../../../state/project/project.store';
import { GRID_MIN_CELL, gridInPixels, serializeGrid } from '../../../helpers/grid-table.helper';
import { absolutePoints, elementBox } from '../../../helpers/element-geometry.helper';
import { snapToGrid } from '../../../helpers/node-metrics.helper';
import { gridRowNeeds } from '../../../helpers/render';
import { DEFAULT_LINE_HEIGHT, fitTextElement, TEXT_MAX_FONT_SIZE, TEXT_MIN_FONT_SIZE } from '../../../helpers/text-metrics';
import { LIST_LINE } from '../helpers/rich-list.helper';
import type { SequenceLayoutSnapshot } from '../../../state/project/models/project-state.model';
import type { SequenceStart } from '../../../models/sequence-start.model';
/** One item of an evenly spaced selection: an element, or a sequence diagram (no `el`). */
interface SpacingItem {
   id: string;
   el?: CanvasElementModel;
   box: { x0: number; y0: number; x1: number; y1: number };
}

/** A resize of several selected items at once: everything scales about one shared box. */
interface GroupResize {
   /** Handle being dragged (nw/ne/sw/se/n/s/e/w), mapped onto the group's box. */
   handle: string;
   box: { x0: number; y0: number; x1: number; y1: number };
   /** Element states at gesture start. */
   elements: CanvasElementModel[];
   diagrams: {
      id: string;
      start: SequenceStart;
      rowSpacing: number;
      before: SequenceLayoutSnapshot;
   }[];
}

/** Resizing a multi-selection as one box, and respacing an evenly spaced selection by its gap handles. */
@Injectable()
export class GroupTransformService {
   private readonly store = inject(ProjectStore);
   private readonly gesture = inject(PointerGestureService);
   private readonly canvasView = inject(CanvasViewService);
   private readonly snap = inject(CanvasSnapService);
   private readonly viewport = inject(EditorViewportService);

   private groupResize: GroupResize | null = null;

   /**
    * Start resizing the whole multi-selection from one item's handle. Returns false
    * (leaving the caller to do a single-item resize) when fewer than two items are
    * selected. Handed to sequence diagrams too, which run their own pointer handling.
    */
   readonly startGroupResize = (handle: string, event: PointerEvent, scaleId?: string): boolean => {
      if (!this.store.canEdit()) {
         return false;
      }
      const elIds = new Set(this.store.selectedElementIds());
      const diagIds = new Set(this.store.selectedDiagramIds());
      const elements = this.store.elements().filter((e) => elIds.has(e.id) && e.type !== 'frame');
      const diagrams = this.store.sequenceDiagrams().filter((d) => diagIds.has(d.id));
      if (elements.length + diagrams.length < 2) {
         return false;
      }
      const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      const grow = (x0: number, y0: number, x1: number, y1: number): void => {
         box.x0 = Math.min(box.x0, x0);
         box.y0 = Math.min(box.y0, y0);
         box.x1 = Math.max(box.x1, x1);
         box.y1 = Math.max(box.y1, y1);
      };
      for (const e of elements) {
         const b = elementBox(e);
         grow(b.x0, b.y0, b.x1, b.y1);
      }
      const seqs: GroupResize['diagrams'] = [];
      for (const d of diagrams) {
         const b = this.canvasView.diagramBox(d);
         const start = this.canvasView.sequenceStart(d.id);
         if (!b || !start) continue;
         grow(b.minX, b.minY, b.maxX, b.maxY);
         seqs.push({ id: d.id, start, rowSpacing: d.rowSpacing, before: this.canvasView.layoutSnapshot(d.id) });
      }
      if (!Number.isFinite(box.x0)) {
         return false;
      }
      this.gesture.mode = 'group-resize';
      this.gesture.gestureActive.set(true);
      this.gesture.startClientX = event.clientX;
      this.gesture.startClientY = event.clientY;
      this.gesture.gestureScale = scaleId ? this.canvasView.itemScale(scaleId) : 1;
      this.groupResize = { handle, box, elements, diagrams: seqs };
      return true;
   };

   /**
    * Scale every item of a group resize about the group's box: the opposite edge
    * (or, with Alt, the centre) stays put, Shift keeps proportions, and items keep
    * their relative placement. Each item resizes the way it does on its own (text
    * and grids rescale their font, diagrams re-spread spines and rows).
    */
   groupResizeMove(ev: PointerEvent): void {
      const g = this.groupResize;
      if (!g) {
         return;
      }
      const b = g.box;
      const zoom = this.store.viewport().zoom * this.gesture.gestureScale;
      const dx = (ev.clientX - this.gesture.startClientX) / zoom;
      const dy = (ev.clientY - this.gesture.startClientY) / zoom;
      const h = g.handle;
      const left = h.includes('w');
      const right = h.includes('e');
      const top = h.includes('n');
      const bottom = h.includes('s');
      const horiz = left || right;
      const vert = top || bottom;
      const W = Math.max(1, b.x1 - b.x0);
      const H = Math.max(1, b.y1 - b.y0);
      const f = ev.altKey ? 2 : 1;
      const gx = (left ? -dx : dx) * f;
      const gy = (top ? -dy : dy) * f;
      let sx = horiz ? (W + gx) / W : 1;
      let sy = vert ? (H + gy) / H : 1;
      if (ev.shiftKey) {
         if (horiz && vert) {
            // Project onto the box diagonal so the corner tracks the cursor smoothly.
            sx = sy = 1 + (gx * W + gy * H) / (W * W + H * H);
         } else if (horiz) {
            sy = sx;
         } else {
            sx = sy;
         }
      } else if (this.snap.gridSnap$() && !ev.altKey) {
         // Land the dragged edge(s) on the grid.
         if (horiz) {
            sx = right ? (snapToGrid(b.x0 + W * sx) - b.x0) / W : (b.x1 - snapToGrid(b.x1 - W * sx)) / W;
         }
         if (vert) {
            sy = bottom ? (snapToGrid(b.y0 + H * sy) - b.y0) / H : (b.y1 - snapToGrid(b.y1 - H * sy)) / H;
         }
      }
      sx = Math.max(0.05, sx);
      sy = Math.max(0.05, sy);
      const ax = ev.altKey ? (b.x0 + b.x1) / 2 : left ? b.x1 : b.x0;
      const ay = ev.altKey ? (b.y0 + b.y1) / 2 : top ? b.y1 : b.y0;
      const mx = (x: number): number => ax + (x - ax) * sx;
      const my = (y: number): number => ay + (y - ay) * sy;

      for (const e of g.elements) {
         if (e.type === 'line' || e.type === 'arrow' || e.type === 'freedraw') {
            const pts = absolutePoints(e).map((p) => ({ x: mx(p.x), y: my(p.y) }));
            const o = pts[0];
            this.store.patchElementLocal(e.id, {
               x: o.x,
               y: o.y,
               points: pts.map((p) => ({ x: p.x - o.x, y: p.y - o.y })),
            });
            continue;
         }
         const x = mx(e.x);
         const y = my(e.y);
         const w = Math.max(8, e.width * sx);
         const hh = Math.max(8, e.height * sy);
         // Where an item whose size is content-driven sits inside its scaled slot:
         // pinned the same way the group is (opposite edge, or centre with Alt).
         const place = (cw: number, ch: number): { x: number; y: number } => ({
            x: ev.altKey || !horiz ? x + (w - cw) / 2 : left ? x + w - cw : x,
            y: ev.altKey || !vert ? y + (hh - ch) / 2 : top ? y + hh - ch : y,
         });
         if (e.type === 'text') {
            const startFont = e.fontSize ?? DEFAULT_FONT_SIZE;
            const diag = e.width * e.width + e.height * e.height;
            const k = diag > 0 ? (w * e.width + hh * e.height) / diag : 1;
            let fontSize = Math.min(TEXT_MAX_FONT_SIZE, Math.max(TEXT_MIN_FONT_SIZE, startFont * k));
            fontSize = Math.round(fontSize * 2) / 2;
            const size = fitTextElement(e, {
               fontSize,
               width: e.wrap ? e.width * (fontSize / startFont) : undefined,
            });
            const p = place(size.width, size.height);
            this.store.patchElementLocal(e.id, {
               x: Math.round(p.x),
               y: Math.round(p.y),
               width: size.width,
               height: size.height,
               fontSize,
            });
         } else if (e.type === 'grid') {
            const r = this.gridResize(e, w, hh);
            const p = place(r.width, r.height);
            this.store.patchElementLocal(e.id, { ...r, x: p.x, y: p.y });
         } else {
            this.store.patchElementLocal(e.id, { x, y, width: w, height: hh });
         }
      }

      for (const d of g.diagrams) {
         const rowSpacing = Math.max(20, d.rowSpacing * sy);
         this.store.resizeSequenceTo(d.id, d.start.xs, ax, sx, rowSpacing, my(d.start.originY), d.start.rows);
      }
   }

   /**
    * When 2+ selected elements sit in one row or column with equal gaps, a handle
    * in the middle of each gap: dragging it respaces every gap at once.
    */
   private readonly evenSpacing = computed<{
      axis: 'x' | 'y';
      gap: number;
      items: SpacingItem[];
   } | null>(() => {
      if (!this.store.canEdit()) return null;
      const ids = new Set(this.store.selectedElementIds());
      const diagIds = new Set(this.store.selectedDiagramIds());
      if (ids.size + diagIds.size < 2 || this.store.selectedTableIds().length) return null;
      const items: SpacingItem[] = this.store
         .elements()
         .filter((e) => ids.has(e.id) && e.type !== 'frame')
         .map((el) => ({ id: el.id, el, box: elementBox(el) }));
      if (items.length !== ids.size) return null;
      for (const d of this.store.sequenceDiagrams()) {
         if (!diagIds.has(d.id)) continue;
         const db = this.canvasView.diagramBox(d);
         if (!db) return null;
         items.push({ id: d.id, box: { x0: db.minX, y0: db.minY, x1: db.maxX, y1: db.maxY } });
      }
      if (items.length < 2) return null;
      for (const axis of ['x', 'y'] as const) {
         const lo = axis === 'x' ? 'x0' : 'y0';
         const hi = axis === 'x' ? 'x1' : 'y1';
         const sorted = [...items].sort((p, q) => p.box[lo] - q.box[lo]);
         const gaps = sorted.slice(1).map((it, i) => it.box[lo] - sorted[i].box[hi]);
         if (gaps.some((g) => g < 0)) continue;
         if (Math.max(...gaps) - Math.min(...gaps) > 1.5) continue;
         return { axis, gap: gaps.reduce((sum, g) => sum + g, 0) / gaps.length, items: sorted };
      }
      return null;
   });

   /**
    * A lone selected list (bulleted / numbered text block): gap marks between its
    * lines; dragging one changes the block's line spacing, so every item moves apart.
    */
   private readonly listSpacing = computed<{
      el: CanvasElementModel;
      lines: number;
      pitch: number;
   } | null>(() => {
      if (!this.store.canEdit()) return null;
      const ids = this.store.selectedElementIds();
      if (ids.length !== 1 || this.store.selectedTableIds().length || this.store.selectedDiagramIds().length) {
         return null;
      }
      const el = this.store.elements().find((e) => e.id === ids[0]);
      const text = el?.text ?? '';
      if (!el || el.type !== 'text' || el.wrap || !LIST_LINE.test(text)) return null;
      const lines = text.split('\n').length;
      if (lines < 2) return null;
      const fontSize = el.fontSize ?? DEFAULT_FONT_SIZE;
      return { el, lines, pitch: fontSize * (el.lineHeight ?? DEFAULT_LINE_HEIGHT) };
   });

   private listSpacingDrag: { el: CanvasElementModel; pitch: number } | null = null;

   /** Screen-space marks for {@link listSpacing}, on the block's left edge. */
   private readonly listSpacingHandles = computed(() => {
      const s = this.listSpacing();
      if (!s || (this.gesture.gestureActive() && !this.spacingActive())) return null;
      const v = this.store.viewport();
      const fontSize = s.el.fontSize ?? DEFAULT_FONT_SIZE;
      const lh = s.el.lineHeight ?? DEFAULT_LINE_HEIGHT;
      // Centered across the block, between the lines; the value shows only while dragging.
      const x = (s.el.x + s.el.width / 2) * v.zoom + v.x;
      const dragging = this.spacingActive();
      const T = 3;
      // The gap shown is the leading between two lines' glyphs (pitch minus the font size).
      const lead = Math.max(2, s.pitch - fontSize * 0.8);
      return Array.from({ length: s.lines - 1 }, (_, i) => {
         const boundary = s.el.y + 2 + (i + 1) * s.pitch;
         const y1 = (boundary - lead / 2) * v.zoom + v.y;
         const y2 = (boundary + lead / 2) * v.zoom + v.y;
         const label = `${Number(lh.toFixed(2))}×`;
         return {
            vertical: false,
            line: { x1: x, y1, x2: x, y2 },
            ticks: [
               { x1: x - T, y1, x2: x + T, y2: y1 },
               { x1: x - T, y1: y2, x2: x + T, y2 },
            ],
            label: dragging && i === 0 ? label : '',
            lx: x + 10 + label.length * 3,
            ly: (y1 + y2) / 2 + 4,
            left: x,
            top: (y1 + y2) / 2,
            span: Math.max(12, y2 - y1),
         };
      });
   });

   /** True while a gap handle is being dragged (keeps the guides on screen). */
   private readonly spacingActive = signal(false);

   /**
    * Screen-space gap marks for {@link evenSpacing}, drawn like the smart-guide
    * gap marks (line, end ticks, distance label) with a grab area on each line.
    */
   readonly spacingHandles$ = computed(() => {
      const s = this.evenSpacing();
      if (!s) return this.listSpacingHandles();
      if (this.gesture.gestureActive() && !this.spacingActive()) return null;
      const v = this.store.viewport();
      const sx = (x: number): number => x * v.zoom + v.x;
      const sy = (y: number): number => y * v.zoom + v.y;
      const T = 3;
      return s.items.slice(1).map((it, k) => {
         const a = s.items[k].box;
         const b = it.box;
         const label = String(Math.round(s.axis === 'x' ? b.x0 - a.x1 : b.y0 - a.y1));
         if (s.axis === 'x') {
            const y = sy((Math.max(a.y0, b.y0) + Math.min(a.y1, b.y1)) / 2);
            const x1 = sx(a.x1);
            const x2 = sx(b.x0);
            return {
               vertical: true,
               line: { x1, y1: y, x2, y2: y },
               ticks: [
                  { x1, y1: y - T, x2: x1, y2: y + T },
                  { x1: x2, y1: y - T, x2, y2: y + T },
               ],
               label,
               lx: (x1 + x2) / 2,
               ly: y - 9,
               left: (x1 + x2) / 2,
               top: y,
               span: Math.max(12, x2 - x1),
            };
         }
         const x = sx((Math.max(a.x0, b.x0) + Math.min(a.x1, b.x1)) / 2);
         const y1 = sy(a.y1);
         const y2 = sy(b.y0);
         return {
            vertical: false,
            line: { x1: x, y1, x2: x, y2 },
            ticks: [
               { x1: x - T, y1, x2: x + T, y2: y1 },
               { x1: x - T, y1: y2, x2: x + T, y2 },
            ],
            label,
            lx: x + 6 + label.length * 3,
            ly: (y1 + y2) / 2,
            left: x,
            top: (y1 + y2) / 2,
            span: Math.max(12, y2 - y1),
         };
      });
   });

   private spacingDrag: {
      axis: 'x' | 'y';
      gap: number;
      items: SpacingItem[];
      /** Diagrams' layouts at drag start (shiftSequence works from these). */
      seqStarts: Map<string, { start: SequenceStart; before: SequenceLayoutSnapshot }>;
   } | null = null;

   startSpacingDrag(event: PointerEvent): void {
      const s = this.evenSpacing();
      const list = s ? null : this.listSpacing();
      if ((!s && !list) || event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      const seqStarts = new Map<string, { start: SequenceStart; before: SequenceLayoutSnapshot }>();
      for (const it of s?.items ?? []) {
         if (it.el) continue;
         const start = this.canvasView.sequenceStart(it.id);
         if (start) seqStarts.set(it.id, { start, before: this.canvasView.layoutSnapshot(it.id) });
      }
      this.spacingDrag = s ? { ...s, seqStarts } : null;
      this.listSpacingDrag = list ? { el: list.el, pitch: list.pitch } : null;
      this.gesture.mode = 'spacing';
      this.spacingActive.set(true);
      this.gesture.gestureActive.set(true);
      this.gesture.startClientX = event.clientX;
      this.gesture.startClientY = event.clientY;
      (event.target as Element).setPointerCapture?.(event.pointerId);
   }

   spacingMove(ev: PointerEvent): void {
      const l = this.listSpacingDrag;
      if (l) {
         const fontSize = l.el.fontSize ?? DEFAULT_FONT_SIZE;
         const delta = (ev.clientY - this.gesture.startClientY) / this.store.viewport().zoom;
         // Each gap grows by the drag distance; Alt for fine steps, else 0.05 steps.
         let lineHeight = Math.max(0.8, Math.min(5, (l.pitch + delta) / fontSize));
         lineHeight = ev.altKey ? Math.round(lineHeight * 100) / 100 : Math.round(lineHeight * 20) / 20;
         const size = fitTextElement({ ...l.el, lineHeight });
         this.store.patchElementLocal(l.el.id, { lineHeight, width: size.width, height: size.height });
         return;
      }
      const g = this.spacingDrag;
      if (!g) return;
      const zoom = this.store.viewport().zoom;
      const delta =
         (g.axis === 'x' ? ev.clientX - this.gesture.startClientX : ev.clientY - this.gesture.startClientY) / zoom;
      // Smart guides: nudge the step so one of the moving items lands on a guide.
      const step = this.snap.smartSpacing(
         g.items.filter((it) => it.el).map((it) => it.id),
         g.items.filter((it) => !it.el).map((it) => it.id),
         g.items.map((it) => it.box),
         g.axis,
         Math.max(-g.gap, delta)
      );
      let gap = Math.max(0, g.gap + step);
      if (!ev.altKey && Math.abs(step - delta) < 1e-6) gap = Math.round(gap);
      let cursor = g.items[0].box[g.axis === 'x' ? 'x1' : 'y1'];
      g.items.forEach((it, i) => {
         if (i === 0) return;
         const start = it.box[g.axis === 'x' ? 'x0' : 'y0'];
         const target = cursor + gap;
         const shift = target - start;
         cursor = target + (g.axis === 'x' ? it.box.x1 - it.box.x0 : it.box.y1 - it.box.y0);
         if (it.el) {
            this.store.patchElementLocal(it.id, g.axis === 'x' ? { x: it.el.x + shift } : { y: it.el.y + shift });
            return;
         }
         const seq = g.seqStarts.get(it.id);
         if (!seq) return;
         const r = Math.round(shift);
         const { xs, originY, rows } = seq.start;
         this.store.shiftSequence(it.id, xs, g.axis === 'x' ? r : 0, originY, g.axis === 'y' ? r : 0, rows);
      });
   }

   commitSpacingDrag(): void {
      const g = this.spacingDrag;
      const l = this.listSpacingDrag;
      this.spacingDrag = null;
      this.listSpacingDrag = null;
      this.spacingActive.set(false);
      if (l) {
         const cur = this.store.elements().find((e) => e.id === l.el.id);
         if (cur && (cur.lineHeight ?? DEFAULT_LINE_HEIGHT) !== (l.el.lineHeight ?? DEFAULT_LINE_HEIGHT)) {
            void this.store.commitElementGeometry(
               l.el.id,
               { lineHeight: l.el.lineHeight ?? DEFAULT_LINE_HEIGHT, width: l.el.width, height: l.el.height },
               { lineHeight: cur.lineHeight, width: cur.width, height: cur.height }
            );
         }
         return;
      }
      this.snap.smartDragEnd();
      if (!g) return;
      const now = new Map(this.store.elements().map((e) => [e.id, e] as const));
      void this.store.batchHistory(async () => {
         await Promise.all(
            g.items.slice(1).map(({ el }) => {
               const cur = el && now.get(el.id);
               if (!el || !cur || (cur.x === el.x && cur.y === el.y)) return null;
               return this.store.commitElementGeometry(el.id, { x: el.x, y: el.y }, { x: cur.x, y: cur.y });
            })
         );
         for (const [id, { before }] of g.seqStarts) {
            const after = this.canvasView.layoutSnapshot(id);
            for (const [lid, x] of after.lifelineXs) this.store.moveLifeline(lid, x);
            for (const [mid, y] of after.messageYs) this.store.moveMessage(mid, y);
            void this.store.updateSequenceConfig(id, { rowSpacing: after.rowSpacing, originY: after.originY });
            this.store.recordSequenceLayout(id, before, after);
         }
      });
   }

   /** Persist a finished group resize as one undo step. */
   commitGroupResize(): void {
      const g = this.groupResize;
      this.groupResize = null;
      if (!g) {
         return;
      }
      const now = new Map(this.store.elements().map((e) => [e.id, e] as const));
      const pick = (e: CanvasElementModel): UpdateElementDto =>
         e.type === 'line' || e.type === 'arrow' || e.type === 'freedraw'
            ? { x: e.x, y: e.y, points: e.points }
            : {
                 x: e.x,
                 y: e.y,
                 width: e.width,
                 height: e.height,
                 ...(e.type === 'text' ? { fontSize: e.fontSize, wrap: e.wrap ?? false } : {}),
                 ...(e.type === 'grid' ? { text: e.text ?? '', fontSize: e.fontSize } : {}),
              };
      void this.store.batchHistory(async () => {
         await Promise.all(
            g.elements.map((snap) => {
               const el = now.get(snap.id);
               return el ? this.store.commitElementGeometry(snap.id, pick(snap), pick(el)) : null;
            })
         );
         for (const d of g.diagrams) {
            const after = this.canvasView.layoutSnapshot(d.id);
            for (const [lid, x] of after.lifelineXs) this.store.moveLifeline(lid, x);
            for (const [mid, y] of after.messageYs) this.store.moveMessage(mid, y);
            void this.store.updateSequenceConfig(d.id, {
               rowSpacing: after.rowSpacing,
               originY: after.originY,
            });
            this.store.recordSequenceLayout(d.id, d.before, after);
         }
      });
   }

   /**
    * A grid table resized to (about) `width` x `height`: columns share the width,
    * rows scale but never below what their text needs, and the font follows the
    * drag projected onto the box diagonal.
    */
   gridResize(
      snapshot: CanvasElementModel,
      width: number,
      height: number
   ): { width: number; height: number; text: string; fontSize: number } {
      const start = gridInPixels(snapshot);
      const sw = snapshot.width;
      const sh = snapshot.height;
      const sx = width / Math.max(1, sw);
      const sy = height / Math.max(1, sh);
      const cols = start.cols.map((c) => Math.max(GRID_MIN_CELL, c * sx));
      const startFont = snapshot.fontSize ?? 14;
      const diag = sw * sw + sh * sh;
      const k = diag > 0 ? (width * sw + height * sh) / diag : 1;
      const fontSize = Math.round(Math.min(96, Math.max(6, startFont * k)) * 2) / 2;
      const needs = gridRowNeeds({ ...snapshot, fontSize }, start, cols);
      const rows = start.rows.map((r, i) => Math.max(GRID_MIN_CELL, needs[i], r * sy));
      return {
         width: cols.reduce((a, b) => a + b, 0),
         height: rows.reduce((a, b) => a + b, 0),
         text: serializeGrid({ ...start, cols, rows }),
         fontSize,
      };
   }
}
