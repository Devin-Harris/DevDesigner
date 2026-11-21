import { Injectable, computed, inject, signal } from '@angular/core';
import type { CanvasElementModel, MediaClipShape, MediaConfig } from '@devdesigner/shared';
import { ProjectStore } from '../state/project/project.store';
import type { AlignAction } from '../models/toolbar-actions';
import { rectCornerRadius } from '../helpers/render';
import { cropFor, isFullCrop, mediaSourceRect } from '../helpers/media.helper';

const CLIP_SHAPES: ReadonlySet<string> = new Set<MediaClipShape>(['rectangle', 'ellipse', 'diamond']);

/**
 * Image-element actions shared by the floating toolbar and the editor: the inline
 * crop session (which picture is being cropped), clip to shape, and media settings.
 */
@Injectable({ providedIn: 'root' })
export class MediaActionsService {
   private readonly store = inject(ProjectStore);

   /** The image element being cropped inline, or null. */
   readonly croppingId = signal<string | null>(null);
   /** Latest align request from the align panel while cropping (seq makes repeats count). */
   readonly cropAlign = signal<{ action: AlignAction; seq: number } | null>(null);

   /** The selection when it is exactly one picture and one shape to clip it to. */
   readonly clipPair$ = computed<{ image: CanvasElementModel; shape: CanvasElementModel } | null>(() => {
      const ids = this.store.selectedElementIds();
      if (ids.length !== 2) {
         return null;
      }
      const els = ids.map((id) => this.store.elements().find((e) => e.id === id));
      const image = els.find((e) => e?.type === 'image');
      const shape = els.find((e) => !!e && CLIP_SHAPES.has(e.type));
      return image && shape ? { image, shape } : null;
   });

   startCrop(id: string): void {
      if (this.store.canEdit()) {
         this.croppingId.set(id);
      }
   }

   /** Align the clip shape in the picture being cropped (from the align panel). */
   requestCropAlign(action: AlignAction): void {
      this.cropAlign.set({ action, seq: (this.cropAlign()?.seq ?? 0) + 1 });
   }

   stopCrop(): void {
      this.croppingId.set(null);
   }

   /** Merge into an image's media config (dropping it when nothing is left). */
   setMedia(id: string, patch: Partial<MediaConfig>): Promise<void> {
      const el = this.store.elements().find((e) => e.id === id);
      if (!el) {
         return Promise.resolve();
      }
      return this.store.updateElement(id, { media: cleanMedia({ ...el.media, ...patch }) });
   }

   /**
    * Clip to shape (like a clipping mask): the picture takes the shape's box and
    * outline, keeping the picture where it is (so the shape becomes a window onto
    * it), and the shape itself is removed. One undo step.
    */
   async clipToShape(): Promise<void> {
      const pair = this.clipPair$();
      if (!pair || !this.store.canEdit()) {
         return;
      }
      const { image, shape } = pair;
      const source = mediaSourceRect(image, image.media?.crop);
      const box = { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
      const media = cleanMedia({
         ...image.media,
         crop: cropFor(box, source),
         clip: shape.type as MediaClipShape,
         clipRadius: shape.type === 'rectangle' ? rectCornerRadius(shape) : undefined,
      });
      await this.store.batchHistory(async () => {
         await this.store.updateElement(image.id, {
            ...box,
            angle: shape.angle,
            // Take the shape's place in the stack.
            zIndex: shape.zIndex,
            media,
         });
         await this.store.deleteElement(shape.id);
      });
      this.store.selectElement(image.id);
   }

   /** Drop a picture's clip shape and crop: the whole picture shows again where it sits. */
   async releaseClip(id: string): Promise<void> {
      const el = this.store.elements().find((e) => e.id === id);
      if (!el) {
         return;
      }
      const source = mediaSourceRect(el, el.media?.crop);
      await this.store.updateElement(id, {
         x: source.x,
         y: source.y,
         width: source.width,
         height: source.height,
         media: cleanMedia({ ...el.media, crop: undefined, clip: undefined, clipRadius: undefined }),
      });
   }

   /** Show the whole picture again (crop removed, at the scale it was shown at). */
   async resetCrop(id: string): Promise<void> {
      const el = this.store.elements().find((e) => e.id === id);
      if (!el?.media?.crop) {
         return;
      }
      const source = mediaSourceRect(el, el.media.crop);
      await this.store.updateElement(id, {
         x: source.x,
         y: source.y,
         width: source.width,
         height: source.height,
         media: cleanMedia({ ...el.media, crop: undefined }),
      });
   }
}

/** A media config without empty fields (and without a no-op crop), or null when empty. */
export function cleanMedia(media: MediaConfig): MediaConfig | null {
   const out: MediaConfig = {};
   if (media.crop && !isFullCrop(media.crop)) out.crop = media.crop;
   if (media.clip) out.clip = media.clip;
   if (media.clip === 'rectangle' && media.clipRadius) out.clipRadius = media.clipRadius;
   if (media.playback) out.playback = media.playback;
   if (media.loop !== undefined) out.loop = media.loop;
   if (media.muted !== undefined) out.muted = media.muted;
   if (media.start !== undefined && media.start > 0) out.start = media.start;
   if (media.end !== undefined && media.end > 0) out.end = media.end;
   if (media.alt) out.alt = media.alt;
   return Object.keys(out).length ? out : null;
}
