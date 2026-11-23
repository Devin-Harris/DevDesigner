import { Injectable, computed, inject, signal } from '@angular/core';
import type { CanvasElementModel } from '@devdesigner/shared';
import { ProjectStore } from '../state/project/project.store';
import { cornerGeometry, hasLiveCorners, shapeCornerRadii, shapeVertices } from '../helpers/render/shape-primitives';

/** Corner index into the shape's vertices (rectangle: tl, tr, br, bl; diamond: top, right, bottom, left; triangle: apex, br, bl). */
export type CornerIndex = number;

export interface CornerRadiusHandle {
   corner: CornerIndex;
   /** World-space center of the grip. */
   cx: number;
   cy: number;
   radius: number;
}

export interface CornerRadiusHandles {
   id: string;
   /** Grip circle radius in world units. */
   size: number;
   handles: CornerRadiusHandle[];
}

/** Screen pixels: grip radius, its minimum distance from the corner, and the smallest shape that shows grips. */
const GRIP_R = 4;
const MIN_INSET = 14;
const MIN_SIDE = 48;

/**
 * Illustrator-style live corners: a grip sits just inside each corner of the selected
 * rectangle, diamond or triangle; dragging it toward the center rounds every corner
 * together, or only that corner while Alt is held. Previewed locally and saved (with
 * undo) on release.
 */
@Injectable({ providedIn: 'root' })
export class CornerRadiusService {
   private readonly store = inject(ProjectStore);
   /** A drag is in progress (grips stay up even if the shape shrinks under them). */
   private readonly dragging = signal(false);

   readonly handles$ = computed((): CornerRadiusHandles | null => {
      const selected = this.store.selectedElementIds();
      if (selected.length !== 1 || !this.store.canEdit()) return null;
      const el = this.store.elements().find((e) => e.id === selected[0]);
      if (!el || !hasLiveCorners(el)) return null;
      const zoom = this.store.viewport().zoom || 1;
      if (!this.dragging() && Math.min(Math.abs(el.width), Math.abs(el.height)) * zoom < MIN_SIDE) return null;
      const pts = shapeVertices(el);
      const radii = shapeCornerRadii(el);
      const inset = MIN_INSET / zoom;
      const handles = pts.map((p, i) => {
         const g = cornerGeometry(pts, i);
         const r = Math.min(radii[i], g.max);
         // At the arc's center once the radius outgrows the minimum inset (as in Illustrator).
         const d = Math.min(Math.max(inset, r / Math.sin(g.half)), g.max / Math.sin(g.half));
         const at = rotateAbout(el, p.x + g.bx * d, p.y + g.by * d);
         return { corner: i, cx: at.x, cy: at.y, radius: Math.round(r) };
      });
      return { id: el.id, size: GRIP_R / zoom, handles };
   });

   /** Drag a corner grip; Alt (checked live) rounds just that corner. */
   drag(corner: CornerIndex, event: PointerEvent): void {
      const info = this.handles$();
      const el = info && this.store.elements().find((e) => e.id === info.id);
      if (!info || !el) return;
      event.preventDefault();
      event.stopPropagation();
      const snapshot = { ...el };
      const pts = shapeVertices(el);
      const geo = pts.map((_, i) => cornerGeometry(pts, i));
      const start = shapeCornerRadii(el).map((r, i) => Math.min(r, geo[i].max));
      const g = geo[corner];
      const uniformMax = Math.min(...geo.map((c) => c.max));
      const zoom = this.store.viewport().zoom || 1;
      const cos = Math.cos(el.angle ?? 0);
      const sin = Math.sin(el.angle ?? 0);
      let patch: Pick<CanvasElementModel, 'cornerRadius' | 'cornerRadii'> | null = null;
      this.dragging.set(true);
      const move = (e: PointerEvent): void => {
         // Pointer travel, unrotated into the shape's frame, projected on the corner's bisector.
         const dx = (e.clientX - event.clientX) / zoom;
         const dy = (e.clientY - event.clientY) / zoom;
         const lx = dx * cos + dy * sin;
         const ly = -dx * sin + dy * cos;
         const delta = (lx * g.bx + ly * g.by) * Math.sin(g.half);
         if (e.altKey) {
            const radii = [...start];
            radii[corner] = Math.round(Math.min(g.max, Math.max(0, start[corner] + delta)));
            patch = { cornerRadii: radii };
         } else {
            const r = Math.round(Math.min(uniformMax, Math.max(0, start[corner] + delta)));
            patch = { cornerRadius: r, cornerRadii: null };
         }
         this.store.patchElementLocal(el.id, patch);
      };
      const up = (): void => {
         window.removeEventListener('pointermove', move);
         window.removeEventListener('pointerup', up);
         window.removeEventListener('pointercancel', up);
         this.dragging.set(false);
         if (patch) void this.store.commitElementEdit(el.id, snapshot, patch);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
   }
}

/** Rotate a point about the element's center by its angle. */
function rotateAbout(el: CanvasElementModel, x: number, y: number): { x: number; y: number } {
   const a = el.angle ?? 0;
   if (!a) return { x, y };
   const cx = el.x + el.width / 2;
   const cy = el.y + el.height / 2;
   const cos = Math.cos(a);
   const sin = Math.sin(a);
   const dx = x - cx;
   const dy = y - cy;
   return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}
