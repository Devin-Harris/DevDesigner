import { Injectable, computed, inject, signal } from '@angular/core';
import type { CanvasElementModel, CreateElementDto, MediaClipShape, MediaClipStyle, MediaConfig } from '@devdesigner/shared';
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
         clipShape: clipStyleOf(shape),
      });
      await this.store.batchHistory(async () => {
         // Lines anchored to the shape stay anchored, now to the picture in its place.
         await this.store.freezeBoundLines(shape.id, image.id);
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

   /**
    * A picture dropped onto a shape: it fills the shape's box (cropped to cover,
    * centered), clipped to its outline, in the shape's place in the stack; the shape
    * is removed. One undo step.
    */
   async fillShapeWithImage(
      shape: CanvasElementModel,
      file: { fileId: string; width: number; height: number },
      base: Omit<CreateElementDto, 'type' | 'x' | 'y' | 'width' | 'height' | 'angle'>
   ): Promise<void> {
      if (!this.store.canEdit() || !isClipShape(shape)) {
         return;
      }
      const box = { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
      const media = cleanMedia({
         crop: coverCrop(file.width / file.height, box.width / box.height),
         clip: shape.type as MediaClipShape,
         clipRadius: shape.type === 'rectangle' ? rectCornerRadius(shape) : undefined,
         clipShape: clipStyleOf(shape),
      });
      let createdId: string | undefined;
      await this.store.batchHistory(async () => {
         const created = await this.store.addElement({
            ...base,
            ...box,
            type: 'image',
            angle: shape.angle,
            zIndex: shape.zIndex,
            fileId: file.fileId,
            media: media ?? undefined,
         });
         createdId = created?.id;
         if (createdId) {
            await this.store.freezeBoundLines(shape.id, createdId);
            await this.store.deleteElement(shape.id);
         }
      });
      if (createdId) {
         this.store.selectElement(createdId);
      }
   }

   /**
    * Drop a picture's clip shape and crop: the whole picture shows again where it sat,
    * and the shape that clipped it comes back (just under it) in the clipped box, with
    * lines anchored to the clipped picture moved back onto it. One undo step.
    */
   async releaseClip(id: string): Promise<void> {
      const el = this.store.elements().find((e) => e.id === id);
      if (!el) {
         return;
      }
      const source = mediaSourceRect(el, el.media?.crop);
      const clip = el.media?.clip;
      await this.store.batchHistory(async () => {
         if (clip) {
            const style = el.media?.clipShape ?? {};
            const shape = await this.store.addElement(
               {
                  type: clip,
                  x: el.x,
                  y: el.y,
                  width: el.width,
                  height: el.height,
                  angle: el.angle,
                  zIndex: el.zIndex,
                  slideId: el.slideId,
                  strokeColor: style.strokeColor ?? el.strokeColor,
                  backgroundColor: style.backgroundColor,
                  fillStyle: style.fillStyle ?? 'none',
                  strokeWidth: style.strokeWidth ?? 2,
                  strokeStyle: style.strokeStyle ?? 'solid',
                  opacity: style.opacity ?? 100,
                  strokeOpacity: style.strokeOpacity,
                  fillOpacity: style.fillOpacity,
                  cornerRadius: clip === 'rectangle' ? (style.cornerRadius ?? el.media?.clipRadius) : undefined,
                  text: style.text,
               },
               false
            );
            if (shape) {
               await this.store.freezeBoundLines(id, shape.id);
               // Just under the picture.
               const order = this.store
                  .elements()
                  .filter((e) => e.id !== shape.id)
                  .sort((a, b) => a.zIndex - b.zIndex)
                  .map((e) => e.id);
               order.splice(order.indexOf(id), 0, shape.id);
               this.store.reorderElements(order);
            }
         }
         await this.store.updateElement(id, {
            x: source.x,
            y: source.y,
            width: source.width,
            height: source.height,
            media: cleanMedia({
               ...el.media,
               crop: undefined,
               clip: undefined,
               clipRadius: undefined,
               clipShape: undefined,
            }),
         });
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

/** The look of a clipping shape, kept on the picture so releasing the clip restores it. */
function clipStyleOf(shape: CanvasElementModel): MediaClipStyle {
   const style: MediaClipStyle = {
      strokeColor: shape.strokeColor,
      backgroundColor: shape.backgroundColor,
      fillStyle: shape.fillStyle,
      strokeWidth: shape.strokeWidth,
      strokeStyle: shape.strokeStyle,
      opacity: shape.opacity,
      strokeOpacity: shape.strokeOpacity,
      fillOpacity: shape.fillOpacity,
      cornerRadius: shape.cornerRadius,
      text: shape.text || undefined,
   };
   return Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined && v !== null)) as MediaClipStyle;
}

/** Whether a picture can be clipped to this element's outline. */
export function isClipShape(el: CanvasElementModel): boolean {
   return CLIP_SHAPES.has(el.type);
}

/** The centered crop that makes a picture of `imageAspect` cover a box of `boxAspect`. */
export function coverCrop(imageAspect: number, boxAspect: number): NonNullable<MediaConfig['crop']> {
   if (!(imageAspect > 0) || !(boxAspect > 0)) {
      return { x: 0, y: 0, width: 1, height: 1 };
   }
   if (imageAspect > boxAspect) {
      const width = boxAspect / imageAspect;
      return { x: (1 - width) / 2, y: 0, width, height: 1 };
   }
   const height = imageAspect / boxAspect;
   return { x: 0, y: (1 - height) / 2, width: 1, height };
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
   if (media.clip && media.clipShape) out.clipShape = media.clipShape;
   return Object.keys(out).length ? out : null;
}
