import type { CanvasElementModel } from '@devdesigner/shared';
import { elementBox, elementCenter } from '../element-geometry.helper';

/** Default padding of a scrollable frame (room kept around its content when scrolled to an end). */
export const FRAME_SCROLL_PAD = 0;

/** Plain frames that clip what they hold (clip-content or scrollable), smallest first. */
export function clipFramesOf(elements: readonly CanvasElementModel[]): CanvasElementModel[] {
   return elements
      .filter((e) => e.type === 'frame' && (e.clipContent || e.scrollable) && !e.slide)
      .sort((a, b) => a.width * a.height - b.width * b.height);
}

/**
 * The clip frame holding an element: the smallest one its centre lies in, on the same
 * slide (or both off slides). A scrollable frame instead holds what starts (top-left)
 * inside it, since its content is expected to run past its edges. Frames never hold frames.
 */
export function holdingFrame(
   el: CanvasElementModel,
   clipFrames: readonly CanvasElementModel[]
): CanvasElementModel | undefined {
   if (el.type === 'frame') return undefined;
   const c = elementCenter(el);
   let box: { x0: number; y0: number } | null = null;
   return clipFrames.find((fr) => {
      if (fr.id === el.id || (fr.slideId ?? null) !== (el.slideId ?? null)) return false;
      const p = fr.scrollable ? (box ??= elementBox(el)) : { x0: c.x, y0: c.y };
      return p.x0 >= fr.x && p.x0 <= fr.x + fr.width && p.y0 >= fr.y && p.y0 <= fr.y + fr.height;
   });
}

export interface FrameScrollExtent {
   frame: CanvasElementModel;
   /** Ids of the elements the frame holds (they scroll with it). */
   members: string[];
   /** The member drawn on top (the layer drawing it draws the scrollbars). */
   top: string;
   /** Members' bounds, world coords. */
   content: { x0: number; y0: number; x1: number; y1: number };
   /** The frame's padding on every side (world px). */
   padding: number;
   /**
    * Scroll range per axis, as offsets from the frame's own position (negative reaches back
    * past the top/left so the padding shows there). Scrolling starts at min (the top-left).
    */
   minScroll: number;
   maxScroll: number;
   minScrollX: number;
   maxScrollX: number;
}

/** True when a frame's content (with its padding) runs past it on either axis. */
export function overflows(ext: FrameScrollExtent): boolean {
   return ext.maxScroll - ext.minScroll > 0.5 || ext.maxScrollX - ext.minScrollX > 0.5;
}

/** Every scrollable frame with what it holds and how far it scrolls. */
export function frameScrollExtents(elements: readonly CanvasElementModel[]): Map<string, FrameScrollExtent> {
   const clipFrames = clipFramesOf(elements);
   const out = new Map<string, FrameScrollExtent>();
   if (!clipFrames.some((f) => f.scrollable)) return out;
   const topZ = new Map<string, number>();
   for (const el of elements) {
      const f = holdingFrame(el, clipFrames);
      if (!f?.scrollable) continue;
      const box = elementBox(el);
      let ext = out.get(f.id);
      if (!ext) {
         ext = {
            frame: f,
            members: [],
            top: el.id,
            content: { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 },
            padding: Math.max(0, f.scrollPadding ?? FRAME_SCROLL_PAD),
            minScroll: 0,
            maxScroll: 0,
            minScrollX: 0,
            maxScrollX: 0,
         };
         out.set(f.id, ext);
      }
      ext.members.push(el.id);
      if (el.zIndex >= (topZ.get(f.id) ?? -Infinity)) {
         topZ.set(f.id, el.zIndex);
         ext.top = el.id;
      }
      const c = ext.content;
      c.x0 = Math.min(c.x0, box.x0);
      c.y0 = Math.min(c.y0, box.y0);
      c.x1 = Math.max(c.x1, box.x1);
      c.y1 = Math.max(c.y1, box.y1);
   }
   const snap = (v: number): number => (Math.abs(v) < 0.5 ? 0 : v);
   for (const ext of out.values()) {
      const { frame: f, content: c, padding: p } = ext;
      ext.minScroll = snap(Math.min(0, c.y0 - p - f.y));
      ext.maxScroll = snap(Math.max(0, c.y1 + p - (f.y + f.height)));
      ext.minScrollX = snap(Math.min(0, c.x0 - p - f.x));
      ext.maxScrollX = snap(Math.max(0, c.x1 + p - (f.x + f.width)));
   }
   return out;
}
