import {
   ChangeDetectionStrategy,
   Component,
   DestroyRef,
   computed,
   effect,
   inject,
   input,
   signal,
   untracked,
} from '@angular/core';
import type { CanvasElementModel } from '@devdesigner/shared';
import { ElementImagesService } from '../../../../services/element-images.service';
import { MediaActionsService, cleanMedia } from '../../../../services/media-actions.service';
import { ProjectStore } from '../../../../state/project/project.store';
import { cropFor, mediaSourceRect, type Rect } from '../../../../helpers/media.helper';
import { imageView } from '../../../../helpers/render';

type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

type Edge = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

/** Smallest crop box side, in world px. */
const MIN_SIDE = 8;

/**
 * Inline crop for an image element, drawn in world coordinates inside the canvas'
 * world layer. The whole source shows faded; the kept part is the box. Drag a
 * handle to move that edge of the box (the picture stays put), drag inside the box
 * to move it over the picture, or drag the faded picture to slide it under the box. Enter / Esc / clicking elsewhere finishes; the
 * result is saved as one change (box + crop).
 */
@Component({
   selector: 'dd-image-crop-overlay',
   changeDetection: ChangeDetectionStrategy.OnPush,
   templateUrl: './image-crop-overlay.component.html',
   styleUrl: './image-crop-overlay.component.scss',
})
export class ImageCropOverlayComponent {
   readonly element = input.required<CanvasElementModel>();

   private readonly store = inject(ProjectStore);
   private readonly images = inject(ElementImagesService);
   private readonly media = inject(MediaActionsService);

   protected readonly edges: readonly Edge[] = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];
   /** The box being cropped to and where the whole source lands (world px). */
   protected readonly draft = signal<{ box: Rect; src: Rect } | null>(null);
   private start: { box: Rect; src: Rect } | null = null;
   /** Align requests already handled (only newer ones apply). */
   private alignSeq = this.media.cropAlign()?.seq ?? 0;

   /** The still picture to crop against (a video's first frame, a GIF's first frame). */
   protected readonly picture = computed(() => {
      const fileId = this.element().fileId;
      const kind = this.images.kind(fileId);
      return kind === 'image' ? this.images.url(fileId) : (this.images.posterUrl(fileId) ?? this.images.url(fileId));
   });
   /** The clip shape (ellipse, diamond, rounded rect) the kept part is shown through. */
   protected readonly clipCss = computed(
      () => imageView(this.element(), this.element().fileId ?? '').clip?.css ?? null
   );
   /** Line the clip shape up with an edge or the centre of the picture. */
   protected align(mode: AlignMode): void {
      const d = this.draft();
      if (!d) {
         return;
      }
      const { box, src } = d;
      const x =
         mode === 'left'
            ? src.x
            : mode === 'right'
              ? src.x + src.width - box.width
              : mode === 'hcenter'
                ? src.x + (src.width - box.width) / 2
                : box.x;
      const y =
         mode === 'top'
            ? src.y
            : mode === 'bottom'
              ? src.y + src.height - box.height
              : mode === 'vcenter'
                ? src.y + (src.height - box.height) / 2
                : box.y;
      this.draft.set({ box: { ...box, x, y }, src });
   }

   /** Handles stay ~10 screen px whatever the zoom. */
   protected readonly handleSize = computed(() => 10 / this.store.viewport().zoom);
   protected readonly origin = computed(() => {
      const e = this.element();
      return `${e.x + e.width / 2}px ${e.y + e.height / 2}px`;
   });
   protected readonly rotate = computed(() =>
      this.element().angle ? `rotate(${(this.element().angle * 180) / Math.PI}deg)` : null
   );

   constructor() {
      effect(() => {
         const e = this.element();
         untracked(() => {
            if (!this.draft()) {
               const box = { x: e.x, y: e.y, width: e.width, height: e.height };
               this.draft.set({ box, src: mediaSourceRect(box, e.media?.crop) });
            }
         });
      });
      const onKey = (ev: KeyboardEvent): void => {
         if (ev.key === 'Enter' || ev.key === 'Escape') {
            ev.preventDefault();
            ev.stopPropagation();
            void this.commit();
         }
      };
      window.addEventListener('keydown', onKey, true);
      // The bottom-left align panel aligns the clip shape while cropping.
      effect(() => {
         const req = this.media.cropAlign();
         untracked(() => {
            if (req && req.seq !== this.alignSeq) {
               this.alignSeq = req.seq;
               if (req.action !== 'dist-h' && req.action !== 'dist-v') {
                  this.align(req.action as AlignMode);
               }
            }
         });
      });
      inject(DestroyRef).onDestroy(() => window.removeEventListener('keydown', onKey, true));
   }

   protected begin(edge: Edge | 'move' | 'pan', event: PointerEvent): void {
      if (event.button !== 0) {
         return;
      }
      event.stopPropagation();
      event.preventDefault();
      const d = this.draft();
      if (!d) {
         return;
      }
      this.start = { box: { ...d.box }, src: { ...d.src } };
      const x0 = event.clientX;
      const y0 = event.clientY;
      const zoom = this.store.viewport().zoom;
      const angle = this.element().angle || 0;
      const move = (ev: PointerEvent): void => {
         // Screen delta -> the element's unrotated frame.
         const sx = (ev.clientX - x0) / zoom;
         const sy = (ev.clientY - y0) / zoom;
         const dx = sx * Math.cos(-angle) - sy * Math.sin(-angle);
         const dy = sx * Math.sin(-angle) + sy * Math.cos(-angle);
         this.draft.set(
            edge === 'pan'
               ? this.pan(dx, dy)
               : edge === 'move'
                 ? this.moveBox(dx, dy)
                 : this.resize(edge, dx, dy, ev.shiftKey)
         );
      };
      const up = (): void => {
         window.removeEventListener('pointermove', move);
         window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
   }

   /** Move the box (the clip shape) over the picture, staying inside it. */
   private moveBox(dx: number, dy: number): { box: Rect; src: Rect } {
      const { box, src } = this.start!;
      const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
      const x = src.width >= box.width ? clamp(box.x + dx, src.x, src.x + src.width - box.width) : box.x + dx;
      const y = src.height >= box.height ? clamp(box.y + dy, src.y, src.y + src.height - box.height) : box.y + dy;
      return { box: { ...box, x, y }, src };
   }

   /** Slide the picture under the box, never uncovering the box. */
   private pan(dx: number, dy: number): { box: Rect; src: Rect } {
      const { box, src } = this.start!;
      const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
      const x = src.width >= box.width ? clamp(src.x + dx, box.x + box.width - src.width, box.x) : src.x + dx;
      const y = src.height >= box.height ? clamp(src.y + dy, box.y + box.height - src.height, box.y) : src.y + dy;
      return { box, src: { ...src, x, y } };
   }

   /** Move the dragged edges of the box, inside the picture (Shift keeps the box's shape). */
   private resize(edge: Edge, dx: number, dy: number, keepAspect: boolean): { box: Rect; src: Rect } {
      const { box, src } = this.start!;
      let x0 = box.x;
      let y0 = box.y;
      let x1 = box.x + box.width;
      let y1 = box.y + box.height;
      const lx = Math.min(src.x, x0);
      const ly = Math.min(src.y, y0);
      const hx = Math.max(src.x + src.width, x1);
      const hy = Math.max(src.y + src.height, y1);
      if (edge.includes('w')) x0 = Math.min(Math.max(x0 + dx, lx), x1 - MIN_SIDE);
      if (edge.includes('e')) x1 = Math.max(Math.min(x1 + dx, hx), x0 + MIN_SIDE);
      if (edge.includes('n')) y0 = Math.min(Math.max(y0 + dy, ly), y1 - MIN_SIDE);
      if (edge.includes('s')) y1 = Math.max(Math.min(y1 + dy, hy), y0 + MIN_SIDE);
      if (keepAspect && edge.length === 2) {
         const ratio = box.width / box.height;
         const w = x1 - x0;
         const h = y1 - y0;
         if (w / h > ratio) {
            const nw = h * ratio;
            if (edge.includes('w')) x0 = x1 - nw;
            else x1 = x0 + nw;
         } else {
            const nh = w / ratio;
            if (edge.includes('n')) y0 = y1 - nh;
            else y1 = y0 + nh;
         }
      }
      return { box: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, src };
   }

   protected finish(event: PointerEvent): void {
      event.stopPropagation();
      event.preventDefault();
      void this.commit();
   }

   private async commit(): Promise<void> {
      const d = this.draft();
      const e = this.element();
      this.media.stopCrop();
      if (!d) {
         return;
      }
      const same = d.box.x === e.x && d.box.y === e.y && d.box.width === e.width && d.box.height === e.height;
      const before = mediaSourceRect(e, e.media?.crop);
      if (same && before.x === d.src.x && before.y === d.src.y) {
         return;
      }
      // A rotated picture keeps its angle about the new box's own centre; shift the box
      // so the kept part does not jump.
      let { x, y } = d.box;
      let src = d.src;
      const angle = e.angle || 0;
      if (angle) {
         const ocx = e.x + e.width / 2;
         const ocy = e.y + e.height / 2;
         const ncx = d.box.x + d.box.width / 2;
         const ncy = d.box.y + d.box.height / 2;
         const rx = ocx + (ncx - ocx) * Math.cos(angle) - (ncy - ocy) * Math.sin(angle);
         const ry = ocy + (ncx - ocx) * Math.sin(angle) + (ncy - ocy) * Math.cos(angle);
         x += rx - ncx;
         y += ry - ncy;
         src = { ...src, x: src.x + rx - ncx, y: src.y + ry - ncy };
      }
      const box = { x, y, width: d.box.width, height: d.box.height };
      await this.store.updateElement(e.id, {
         ...box,
         media: cleanMedia({ ...e.media, crop: cropFor(box, src) }),
      });
   }
}
