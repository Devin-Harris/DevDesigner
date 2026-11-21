import { DEFAULT_FONT_SIZE } from '../../../helpers/render/text-layout';
import { CODE_FONT_SIZE } from '../../../helpers/render/code-block.render';
import { type CanvasElementModel, type ElementBinding } from '@devdesigner/shared';
import {
   type RotatedBox,
   absolutePoints,
   elementBox,
   focusAt,
   tableBox,
} from '../../../helpers/element-geometry.helper';
import { snapToGrid } from '../../../helpers/node-metrics.helper';
import { TEXT_MAX_FONT_SIZE, TEXT_MIN_FONT_SIZE, fitTextElement } from '../../../helpers/text-metrics';
import type { SmartSnap } from '../../../helpers/smart-guides.helper';
import type { Box } from '../../../models/geometry.model';
import { PANEL_MIN_H } from '../../../shared/constants/slide-panels.constants';
import { CONTENT_SCALE_TYPES } from './element-gesture.helpers';
import type { ElementGestureService } from './element-gesture.service';

/** Resize, endpoint moves and arrow binding for element gestures. */
export class ElementResize {
   constructor(private readonly host: ElementGestureService) {}

   /**
    * Resize a shape by a corner handle. Shift keeps proportions, Alt resizes about
    * the center, and grid snap (when on) snaps the dimensions.
    */
   resizeElement(ev: PointerEvent): void {
      const g = this.host.elementGesture;
      if (!g?.handle) {
         return;
      }
      const s = g.start;
      const zoom = this.host.store.viewport().zoom * this.host.gesture.gestureScale;
      const dx = (ev.clientX - this.host.gesture.startClientX) / zoom;
      const dy = (ev.clientY - this.host.gesture.startClientY) / zoom;
      const left = g.handle === 'nw' || g.handle === 'sw' || g.handle === 'w';
      const top = g.handle === 'nw' || g.handle === 'ne' || g.handle === 'n';
      // A side (not a corner) of a shape resizes on that axis only.
      const onlyX = g.handle === 'e' || g.handle === 'w';
      const onlyY = g.handle === 'n' || g.handle === 's';
      const cx = s.x + s.width / 2;
      const cy = s.y + s.height / 2;
      const factor = ev.altKey ? 2 : 1;

      const resized = this.host.store.elements().find((e) => e.id === g.id);
      if (onlyX && resized?.type === 'text') {
         // A side handle on text fixes its width: it wraps and the height follows the text.
         let width = Math.max(24, s.width + (left ? -dx : dx) * factor);
         // The dragged edge lines up with other items and the slide edges (smart guides).
         const smart = this.resizeSnap(g.id, s, left, false, width, s.height, { x: true, y: false }, ev.altKey);
         if (smart?.snappedX) {
            width = Math.max(24, width + (left ? -smart.ox : smart.ox) * factor);
         } else if (this.host.snap.gridSnap$()) {
            width = Math.max(24, snapToGrid(width));
         }
         const wrapped: CanvasElementModel = { ...resized, wrap: true };
         const size = fitTextElement(wrapped, { width });
         const nx = ev.altKey ? cx - width / 2 : left ? s.x + s.width - width : s.x;
         this.host.store.patchElementLocal(g.id, {
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
      // Ctrl (Cmd) + resize scales the object with its content (font included) instead
      // of adding room around it: proportions are kept, a side drag scales evenly too.
      if (
         (ev.ctrlKey || ev.metaKey) &&
         resized &&
         CONTENT_SCALE_TYPES.has(resized.type) &&
         s.width > 0 &&
         s.height > 0
      ) {
         const grow = onlyY ? 0 : (left ? -dx : dx) * factor;
         const growY = onlyX ? 0 : (top ? -dy : dy) * factor;
         const raw = onlyX
            ? 1 + grow / s.width
            : onlyY
              ? 1 + growY / s.height
              : 1 + (grow * s.width + growY * s.height) / (s.width * s.width + s.height * s.height);
         const startFont = g.snapshot.fontSize ?? (resized.type === 'code' ? CODE_FONT_SIZE : DEFAULT_FONT_SIZE);
         const clampFont = (f: number): number => Math.min(TEXT_MAX_FONT_SIZE, Math.max(TEXT_MIN_FONT_SIZE, f));
         let fontSize = clampFont(startFont * Math.max(0.05, raw));
         // 1) Match the scale of another object of the same kind (same font size) when
         //    the dragged edge is within a few screen pixels of that size.
         const tol = 6 / this.host.store.viewport().zoom;
         const extent = onlyY ? s.height : s.width;
         let match: number | null = null;
         for (const e of this.host.store.elements()) {
            if (e.id === g.id || e.type !== resized.type || e.fontSize == null) continue;
            const off = Math.abs((e.fontSize - fontSize) / startFont) * extent * factor;
            if (off <= tol && (match === null || Math.abs(e.fontSize - fontSize) < Math.abs(match - fontSize))) {
               match = e.fontSize;
            }
         }
         if (match !== null) {
            fontSize = match;
            this.host.snap.smartSnapState.set(null);
         } else {
            // 2) Line the scaled box up with nearby items (smart guides).
            const k0 = fontSize / startFont;
            const smart = this.resizeSnap(
               g.id,
               s,
               left,
               top,
               s.width * k0,
               s.height * k0,
               { x: !onlyY, y: !onlyX },
               ev.altKey
            );
            if (smart?.snappedX || smart?.snappedY) {
               const w = s.width * k0 + (smart.snappedX ? (left ? -smart.ox : smart.ox) * factor : 0);
               const h = s.height * k0 + (smart.snappedY ? (top ? -smart.oy : smart.oy) * factor : 0);
               fontSize = clampFont(startFont * (smart.snappedX ? w / s.width : h / s.height));
            } else {
               // 3) Otherwise the font steps in half points.
               fontSize = Math.round(fontSize * 2) / 2;
            }
         }
         // The box follows the font so content and box stay in step.
         const k = fontSize / startFont;
         const width = Math.max(8, s.width * k);
         const height = Math.max(8, s.height * k);
         this.host.store.patchElementLocal(g.id, {
            x: ev.altKey ? cx - width / 2 : left ? s.x + s.width - width : onlyY ? cx - width / 2 : s.x,
            y: ev.altKey ? cy - height / 2 : top ? s.y + s.height - height : onlyX ? cy - height / 2 : s.y,
            width,
            height,
            fontSize,
         });
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
         const frameMinH = this.host.store.slideFrames().some((f) => f.id === g.id) ? PANEL_MIN_H / s.height : 0;
         const minScale = Math.max(8 / Math.min(s.width, s.height), frameMinH);
         let scale = Math.max(minScale, 1 + (grow * s.width + growY * s.height) / diag);
         const smart =
            resized?.type === 'text'
               ? null
               : this.resizeSnap(g.id, s, left, top, s.width * scale, s.height * scale, undefined, ev.altKey);
         if (smart?.snappedX || smart?.snappedY) {
            const w = s.width * scale + (smart.snappedX ? (left ? -smart.ox : smart.ox) * factor : 0);
            const h = s.height * scale + (smart.snappedY ? (top ? -smart.oy : smart.oy) * factor : 0);
            // Follow whichever edge snapped (X wins when both did).
            scale = Math.max(minScale, smart.snappedX ? w / s.width : h / s.height);
         } else if (this.host.snap.gridSnap$()) {
            // Snap one dimension and derive the other so the ratio survives snapping.
            scale = Math.max(minScale, snapToGrid(s.width * scale) / s.width);
         }
         width = s.width * scale;
         height = s.height * scale;
      } else {
         // A slide frame is never shorter than the panels pinned to it.
         const minH = this.host.store.slideFrames().some((f) => f.id === g.id) ? PANEL_MIN_H : 8;
         width = Math.max(8, s.width + grow);
         height = Math.max(minH, s.height + growY);
         const smart =
            resized?.type === 'text'
               ? null
               : this.resizeSnap(g.id, s, left, top, width, height, { x: !onlyY, y: !onlyX }, ev.altKey);
         // The axis a side drag leaves alone keeps its size exactly (no grid snapping either).
         if (!onlyY) {
            if (smart?.snappedX) width = Math.max(8, width + (left ? -smart.ox : smart.ox) * factor);
            else if (this.host.snap.gridSnap$()) width = Math.max(8, snapToGrid(width));
         }
         if (!onlyX) {
            if (smart?.snappedY) height = Math.max(minH, height + (top ? -smart.oy : smart.oy) * factor);
            else if (this.host.snap.gridSnap$()) height = Math.max(minH, snapToGrid(height));
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
      const el = this.host.store.elements().find((e) => e.id === g.id);
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
         this.host.store.patchElementLocal(g.id, {
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
         const r = this.host.groupTransform.gridResize(g.snapshot, width, height);
         const w = r.width;
         const h = r.height;
         this.host.store.patchElementLocal(g.id, {
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
         this.host.store.patchElementLocal(g.id, {
            x: o.x,
            y: o.y,
            width,
            height,
            points: pts.map((p) => ({ x: p.x - o.x, y: p.y - o.y })),
         });
         return;
      }

      this.host.store.patchElementLocal(g.id, { x, y, width, height });
   }

   /** Smart-guide snap of the dragged corner's edges for a resize to (width, height). */
   resizeSnap(
      id: string,
      s: { x: number; y: number; width: number; height: number; angle?: number | null },
      left: boolean,
      top: boolean,
      width: number,
      height: number,
      /** Which axes are being resized (a side drag moves one edge only). */
      axes: { x: boolean; y: boolean } = { x: true, y: true },
      /** Alt: resizing about the centre, so both edges of an axis move (mirrored). */
      centred = false
   ): SmartSnap | null {
      // Rotated boxes have no axis-aligned edges to line up.
      if (s.angle) return null;
      const x0 = centred ? s.x + (s.width - width) / 2 : left ? s.x + s.width - width : s.x;
      const y0 = centred ? s.y + (s.height - height) / 2 : top ? s.y + s.height - height : s.y;
      const box = { x0, y0, x1: x0 + width, y1: y0 + height };
      // Dragged edge first; when centred the opposite edge snaps too.
      const xs = !axes.x ? [] : centred ? [left ? box.x0 : box.x1, left ? box.x1 : box.x0] : [left ? box.x0 : box.x1];
      const ys = !axes.y ? [] : centred ? [top ? box.y0 : box.y1, top ? box.y1 : box.y0] : [top ? box.y0 : box.y1];
      const snap = this.host.snap.smartEdges(id, box, xs, ys);
      // Express the correction as a move of the dragged edge (the opposite edge mirrors it).
      if (snap && centred) {
         if (snap.edgeX === 1) snap.ox = -snap.ox;
         if (snap.edgeY === 1) snap.oy = -snap.oy;
      }
      return snap;
   }

   /** Drag a line/arrow endpoint, binding to a table/element under the cursor. */
   moveEndpoint(clientX: number, clientY: number): void {
      const g = this.host.elementGesture;
      if (!g?.points || !g.which) {
         return;
      }
      const el = this.host.store.elements().find((e) => e.id === g.id);
      if (!el) {
         return;
      }
      let world = this.host.viewport.toWorld(clientX, clientY);
      const target = this.host.gesture.noBindHeld ? null : this.bindingTargetAt(world, g.id);
      this.host.bindHighlight$.set(target ? [target.box] : []);
      const binding = target?.binding ?? null;
      const pts = g.points.map((p) => ({ ...p }));
      const idx = g.which === 'start' ? 0 : pts.length - 1;
      if (!binding) {
         // The neighbouring point anchors the Shift angle lock.
         const anchor = pts[g.which === 'start' ? 1 : pts.length - 2] ?? pts[idx];
         if (this.host.gesture.shiftHeld) {
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
            const smart = this.host.snap.smartEdges(
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
               this.host.snap.smartSnapState.set(
                  smart?.guides.length ? { snap: smart, view: this.host.snap.smartBase?.view } : null
               );
            } else if (this.host.snap.gridSnap$()) {
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
            const smart = this.host.snap.smartEdges(g.id, box, [world.x], [world.y]);
            const grid = this.host.snap.gridSnap$();
            world = {
               x: smart?.snappedX ? world.x + smart.ox : grid ? snapToGrid(world.x) : Math.round(world.x),
               y: smart?.snappedY ? world.y + smart.oy : grid ? snapToGrid(world.y) : Math.round(world.y),
            };
         }
      } else {
         this.host.snap.smartSnapState.set(null);
      }
      pts[idx] = world;
      // Points are stored relative to the element origin (its first point).
      const origin = pts[0];
      const relative = pts.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y }));
      this.host.store.patchElementLocal(g.id, {
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
      binding: ElementBinding;
      box: { x: number; y: number; width: number; height: number };
   } | null {
      // Where on the target the end was dropped: it stays there as the target moves.
      const withFocus = (b: ElementBinding, box: RotatedBox): ElementBinding => {
         const focus = focusAt(box, world);
         return focus ? { ...b, focus } : b;
      };
      const toRect = (b: Box) => ({ x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 });
      // Sequence message labels are small and sit on top of everything: check first.
      for (const [id, box] of this.host.canvasView.messageBoxes()) {
         if (this.host.pointInBox(world, box)) {
            return { binding: withFocus({ targetKind: 'message', targetId: id }, box), box: toRect(box) };
         }
      }
      for (const table of this.host.store.tables()) {
         const box = tableBox(table);
         if (this.host.pointInBox(world, box)) {
            return { binding: withFocus({ targetKind: 'table', targetId: table.id }, box), box: toRect(box) };
         }
      }
      // Topmost element first (elements render in ascending zIndex order).
      const elements = this.host.canvasView.shownElements().reverse();
      for (const el of elements) {
         if (el.id === excludeElementId || el.type === 'line' || el.type === 'arrow' || el.type === 'frame') {
            continue;
         }
         const box = elementBox(el);
         if (this.host.pointInBox(world, box)) {
            return {
               binding: withFocus({ targetKind: 'element', targetId: el.id }, { ...box, angle: el.angle }),
               box: toRect(box),
            };
         }
      }
      return null;
   }
}
