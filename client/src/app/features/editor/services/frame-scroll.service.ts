import { Injectable, computed, inject, signal } from '@angular/core';
import type { CanvasElementModel } from '@devdesigner/shared';
import { ProjectStore } from '../state/project/project.store';
import { FRAME_SCROLL_PAD, frameScrollExtents, overflows } from '../helpers/render';
import { clipFramesOf, holdingFrame } from '../helpers/render/frame-scroll.helper';
import { hitTestElement } from '../helpers/element-geometry.helper';

export interface FrameScrollOffset {
   x: number;
   y: number;
}

type Rect = { x: number; y: number; width: number; height: number };

/** A scrollable frame's scrollbars (world coords), drawn while it is hovered. */
export interface FrameScrollBars {
   id: string;
   /** The frame's topmost item (whose layer draws the bars). */
   top: string;
   /** Thumbs; `per` = scroll per world unit of thumb travel. */
   v: (Rect & { per: number }) | null;
   h: (Rect & { per: number }) | null;
}

/** Padding handles of the selected scrollable frame, plus the green band while adjusting. */
export interface FramePaddingHandles {
   id: string;
   padding: number;
   /** One grip per side, just inside the padding edge. */
   handles: Array<Rect & { side: 'n' | 's' | 'e' | 'w' }>;
   /** Even-odd path of the padding band (frame minus its padded inside), shown while dragging/hovering. */
   band: string;
   active: boolean;
}

const NONE: FrameScrollOffset = { x: 0, y: 0 };
/** Bar thickness and inset from the frame edge, in screen pixels. */
const BAR = 6;
const BAR_INSET = 3;
/** Padding grip size in screen pixels (long side, short side). */
const GRIP_LONG = 18;
const GRIP_SHORT = 5;

/**
 * How far each scrollable frame is scrolled, for this viewer only (never saved or
 * shared). Content held by the frame is drawn shifted by that amount. Also drives the
 * scrollbars and the padding grips.
 */
@Injectable({ providedIn: 'root' })
export class FrameScrollService {
   private readonly store = inject(ProjectStore);
   private readonly offsets = signal<ReadonlyMap<string, FrameScrollOffset>>(new Map());
   /** The scrollable frame under the pointer (its scrollbars show). */
   readonly hovered$ = signal<string | null>(null);
   /** Frame whose scrollbar thumb is being dragged (its bars stay up meanwhile). */
   private readonly dragging = signal<string | null>(null);
   /** Live padding while a grip is dragged (saved on release). */
   private readonly padDrag = signal<{ id: string; padding: number } | null>(null);
   /** A padding grip is hovered (the band shows). */
   readonly gripHover$ = signal(false);

   readonly extents$ = computed(() => {
      const drag = this.padDrag();
      const els = this.store.elements();
      return frameScrollExtents(
         drag ? els.map((e) => (e.id === drag.id ? { ...e, scrollPadding: drag.padding } : e)) : els
      );
   });

   /** A frame's current scroll, clamped to what its content allows now. */
   readonly offsetOf$ = computed(() => {
      const offsets = this.offsets();
      const extents = this.extents$();
      return (id: string | undefined): FrameScrollOffset => {
         const ext = id ? extents.get(id) : undefined;
         // Unscrolled, a frame shows the start of its content (top-left, padding included).
         const o = (id ? offsets.get(id) : undefined) ?? (ext ? { x: ext.minScrollX, y: ext.minScroll } : undefined);
         if (!ext || !o) return NONE;
         return {
            x: Math.min(ext.maxScrollX, Math.max(ext.minScrollX, o.x)),
            y: Math.min(ext.maxScroll, Math.max(ext.minScroll, o.y)),
         };
      };
   });

   /** SVG transform shifting a held element by its frame's scroll. */
   readonly transformOf$ = computed(() => {
      const offsetOf = this.offsetOf$();
      return (id: string | undefined): string | null => {
         if (!id) return null;
         const o = offsetOf(id);
         return o.x || o.y ? `translate(${-o.x},${-o.y})` : null;
      };
   });

   /** Scrollbars of the hovered frame, sized for the current zoom. */
   readonly bars$ = computed((): FrameScrollBars | null => {
      const id = this.dragging() ?? this.hovered$();
      const ext = id ? this.extents$().get(id) : undefined;
      if (!id || !ext || !overflows(ext)) return null;
      const zoom = this.store.viewport().zoom || 1;
      const t = BAR / zoom;
      const inset = BAR_INSET / zoom;
      const f = ext.frame;
      const o = this.offsetOf$()(id);
      const spanY = ext.maxScroll - ext.minScroll;
      const spanX = ext.maxScrollX - ext.minScrollX;
      let v: FrameScrollBars['v'] = null;
      let h: FrameScrollBars['h'] = null;
      if (spanY > 0.5) {
         const track = f.height - 2 * inset - (spanX > 0.5 ? t + inset : 0);
         const len = Math.max(t * 3, (track * f.height) / (f.height + spanY));
         v = {
            x: f.x + f.width - inset - t,
            y: f.y + inset + ((track - len) * (o.y - ext.minScroll)) / spanY,
            width: t,
            height: len,
            per: spanY / Math.max(1e-6, track - len),
         };
      }
      if (spanX > 0.5) {
         const track = f.width - 2 * inset - (spanY > 0.5 ? t + inset : 0);
         const len = Math.max(t * 3, (track * f.width) / (f.width + spanX));
         h = {
            x: f.x + inset + ((track - len) * (o.x - ext.minScrollX)) / spanX,
            y: f.y + f.height - inset - t,
            width: len,
            height: t,
            per: spanX / Math.max(1e-6, track - len),
         };
      }
      return { id, top: ext.top, v, h };
   });

   /** Grips for the selected scrollable frame (one selected element only). */
   readonly paddingHandles$ = computed((): FramePaddingHandles | null => {
      const selected = this.store.selectedElementIds();
      if (selected.length !== 1 || !this.store.canEdit()) return null;
      const id = selected[0];
      const f = this.store.elements().find((e) => e.id === id);
      if (!f || f.type !== 'frame' || !f.scrollable) return null;
      const drag = this.padDrag();
      const p = Math.max(0, drag?.id === id ? drag.padding : (f.scrollPadding ?? FRAME_SCROLL_PAD));
      const zoom = this.store.viewport().zoom || 1;
      const L = GRIP_LONG / zoom;
      const S = GRIP_SHORT / zoom;
      const cx = f.x + f.width / 2;
      const cy = f.y + f.height / 2;
      const handles: FramePaddingHandles['handles'] = [
         { side: 'n', x: cx - L / 2, y: f.y + p - S / 2, width: L, height: S },
         { side: 's', x: cx - L / 2, y: f.y + f.height - p - S / 2, width: L, height: S },
         { side: 'w', x: f.x + p - S / 2, y: cy - L / 2, width: S, height: L },
         { side: 'e', x: f.x + f.width - p - S / 2, y: cy - L / 2, width: S, height: L },
      ];
      const inner = { x: f.x + p, y: f.y + p, w: Math.max(0, f.width - 2 * p), h: Math.max(0, f.height - 2 * p) };
      const band =
         `M${f.x},${f.y}h${f.width}v${f.height}h${-f.width}Z` +
         `M${inner.x},${inner.y}h${inner.w}v${inner.h}h${-inner.w}Z`;
      return { id, padding: p, handles, band, active: !!drag || this.gripHover$() };
   });

   /** element id -> the clipping (or scrollable) frame holding it. */
   private readonly holders$ = computed(() => {
      const els = this.store.elements();
      const frames = clipFramesOf(els);
      const out = new Map<string, CanvasElementModel>();
      if (!frames.length) return out;
      for (const el of els) {
         const f = holdingFrame(el, frames);
         if (f) out.set(el.id, f);
      }
      return out;
   });

   /** How far an element is drawn shifted by the scrollable frame holding it (drawn = model - shift). */
   scrollShiftOf(id: string): FrameScrollOffset {
      const f = this.holders$().get(id);
      return f?.scrollable ? this.offsetOf$()(f.id) : NONE;
   }

   /** Whether a world point is outside the frame clipping this element (so it can't be hit there). */
   clippedAt(id: string, p: { x: number; y: number }): boolean {
      const f = this.holders$().get(id);
      return !!f && (p.x < f.x || p.x > f.x + f.width || p.y < f.y || p.y > f.y + f.height);
   }

   /**
    * A marquee rect as it applies to an element: cut to the frame clipping it and shifted
    * by that frame's scroll (null when the marquee misses the frame's visible area).
    */
   clipRect<R extends { minX: number; minY: number; maxX: number; maxY: number }>(id: string, r: R): R | null {
      const f = this.holders$().get(id);
      if (!f) return r;
      const minX = Math.max(r.minX, f.x);
      const minY = Math.max(r.minY, f.y);
      const maxX = Math.min(r.maxX, f.x + f.width);
      const maxY = Math.min(r.maxY, f.y + f.height);
      if (minX > maxX || minY > maxY) return null;
      const o = f.scrollable ? this.offsetOf$()(f.id) : NONE;
      return { ...r, minX: minX + o.x, minY: minY + o.y, maxX: maxX + o.x, maxY: maxY + o.y };
   }

   /** Hit test that respects frame clipping and scrolling (the item is drawn shifted). */
   hits(el: CanvasElementModel, p: { x: number; y: number }, tolerance?: number): boolean {
      if (this.clippedAt(el.id, p)) return false;
      const f = this.holders$().get(el.id);
      const o = f?.scrollable ? this.offsetOf$()(f.id) : NONE;
      return hitTestElement(el, { x: p.x + o.x, y: p.y + o.y }, tolerance);
   }

   /** The scrollable, overflowing frame under a world point (smallest first), if any. */
   frameAt(p: { x: number; y: number }): string | null {
      let best: { id: string; area: number } | null = null;
      for (const ext of this.extents$().values()) {
         const f = ext.frame;
         if (!overflows(ext)) continue;
         if (p.x < f.x || p.x > f.x + f.width || p.y < f.y || p.y > f.y + f.height) continue;
         const area = f.width * f.height;
         if (!best || area < best.area) best = { id: f.id, area };
      }
      return best?.id ?? null;
   }

   /** Track the pointer so the hovered frame shows its scrollbars. */
   hover(p: { x: number; y: number } | null): void {
      const id = p ? this.frameAt(p) : null;
      if (id !== this.hovered$()) this.hovered$.set(id);
   }

   /** Drag a scrollbar thumb: the content follows the pointer like a normal scrollbar. */
   dragThumb(axis: 'v' | 'h', event: PointerEvent): void {
      const bars = this.bars$();
      const thumb = bars?.[axis];
      if (!bars || !thumb) return;
      event.preventDefault();
      event.stopPropagation();
      const id = bars.id;
      const zoom = this.store.viewport().zoom || 1;
      let last = axis === 'v' ? event.clientY : event.clientX;
      this.dragging.set(id);
      this.track(
         (e) => {
            const at = axis === 'v' ? e.clientY : e.clientX;
            const d = ((at - last) / zoom) * thumb.per;
            last = at;
            this.scrollBy(id, axis === 'h' ? d : 0, axis === 'v' ? d : 0);
         },
         () => this.dragging.set(null)
      );
   }

   /**
    * Drag a padding grip: the padding (all four sides at once) follows the pointer's
    * distance from that grip's edge, and is saved on release.
    */
   dragPadding(side: 'n' | 's' | 'e' | 'w', event: PointerEvent): void {
      const handles = this.paddingHandles$();
      const f = handles && this.store.elements().find((e) => e.id === handles.id);
      if (!handles || !f) return;
      event.preventDefault();
      event.stopPropagation();
      const zoom = this.store.viewport().zoom || 1;
      const start = side === 'n' || side === 's' ? event.clientY : event.clientX;
      const sign = side === 'n' || side === 'w' ? 1 : -1;
      const max = Math.min(f.width, f.height) / 2;
      const base = handles.padding;
      this.padDrag.set({ id: f.id, padding: base });
      this.track(
         (e) => {
            const at = side === 'n' || side === 's' ? e.clientY : e.clientX;
            const raw = base + (sign * (at - start)) / zoom;
            this.padDrag.set({ id: f.id, padding: Math.round(Math.min(max, Math.max(0, raw))) });
         },
         () => {
            const end = this.padDrag()?.padding ?? base;
            this.padDrag.set(null);
            if (end !== base) void this.store.updateElement(f.id, { scrollPadding: end });
         }
      );
   }

   /**
    * Fix every scrollable frame at the scroll it shows now. Unscrolled, a frame follows its
    * content's top-left; pinned, content being moved or resized stays put under the pointer.
    */
   pin(): void {
      const offsetOf = this.offsetOf$();
      const next = new Map(this.offsets());
      let changed = false;
      for (const id of this.extents$().keys()) {
         if (next.has(id)) continue;
         next.set(id, offsetOf(id));
         changed = true;
      }
      if (changed) this.offsets.set(next);
   }

   scrollBy(id: string, dx: number, dy: number): void {
      const cur = this.offsetOf$()(id);
      const ext = this.extents$().get(id);
      if (!ext) return;
      const next = {
         x: Math.min(ext.maxScrollX, Math.max(ext.minScrollX, cur.x + dx)),
         y: Math.min(ext.maxScroll, Math.max(ext.minScroll, cur.y + dy)),
      };
      this.offsets.update((m) => new Map(m).set(id, next));
   }

   private track(move: (e: PointerEvent) => void, done: () => void): void {
      const up = (): void => {
         done();
         window.removeEventListener('pointermove', move);
         window.removeEventListener('pointerup', up);
         window.removeEventListener('pointercancel', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
   }
}
