import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ElementImagesService } from '../../../services/element-images.service';
import { ProjectStore } from '../../../state/project/project.store';
import { EditorViewportService } from '../../../services/editor-viewport.service';
import { snapToGrid } from '../../../helpers/node-metrics.helper';
import { CanvasViewService } from '../../../services/canvas-view.service';
import { CanvasSnapService } from '../../../services/canvas-snap.service';
import type { CanvasElementModel } from '@devdesigner/shared';
import { MediaActionsService, isClipShape } from '../../../services/media-actions.service';
import { elementBox } from '../../../helpers/element-geometry.helper';
import { ElementGestureService } from './element-gesture.service';
/** What media drops reach in the rest of the editor; the editor entry wires it with `connect`. */
export interface MediaDropHost {
   importProjectFile(file: unknown, at?: { x: number; y: number }): Promise<number>;
}

/** Images/videos picked, pasted or dropped onto the canvas, and project files dropped on it. */
@Injectable()
export class MediaDropService {
   private readonly store = inject(ProjectStore);
   private readonly snackBar = inject(MatSnackBar);
   private readonly viewport = inject(EditorViewportService);
   private readonly canvasView = inject(CanvasViewService);
   private readonly snap = inject(CanvasSnapService);
   private readonly mediaActions = inject(MediaActionsService);
   private readonly elementGestures = inject(ElementGestureService);
   private host!: MediaDropHost;
   /** The shape a dragged picture would fill if dropped now (highlighted like arrow binding). */
   private dropShapeId: string | null = null;

   connect(host: MediaDropHost): void {
      this.host = host;
   }

   private readonly images = inject(ElementImagesService);

   /** Toolbar "Image": pick one or more files and drop them at the center of the view. */
   pickImages(): void {
      if (!this.store.canEdit() || !this.store.projectId()) {
         return;
      }
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept =
         'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,.svg,video/mp4,video/webm,video/ogg,video/quicktime,.mp4,.webm,.mov';
      input.onchange = () => {
         const files = Array.from(input.files ?? []);
         if (files.length) {
            void this.insertImages(files);
         }
      };
      input.click();
   }

   onCanvasDragOver(event: DragEvent): void {
      if (this.store.canEdit() && event.dataTransfer?.types.includes('Files')) {
         event.preventDefault();
         event.dataTransfer.dropEffect = 'copy';
         // A single picture over a shape fills it; file types aren't readable mid-drag, so
         // only the item count/kind (when the browser exposes it) gates the highlight.
         const items = Array.from(event.dataTransfer.items ?? []).filter((i) => i.kind === 'file');
         const single = items.length === 1 && (!items[0].type || items[0].type.startsWith('image/'));
         const shape = single ? this.shapeAt(this.viewport.toWorld(event.clientX, event.clientY)) : null;
         this.setDropShape(shape);
      }
   }

   /** The drag left the canvas (or was cancelled): clear the shape highlight. */
   onCanvasDragLeave(event: DragEvent): void {
      const to = event.relatedTarget as Node | null;
      if (!to || !(event.currentTarget as Node | null)?.contains(to)) {
         this.setDropShape(null);
      }
   }

   private setDropShape(shape: CanvasElementModel | null): void {
      if ((shape?.id ?? null) === this.dropShapeId) {
         return;
      }
      this.dropShapeId = shape?.id ?? null;
      if (shape) {
         const b = elementBox(shape);
         this.elementGestures.bindHighlight$.set([{ x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 }]);
      } else {
         this.elementGestures.bindHighlight$.set([]);
      }
   }

   /** Topmost rectangle/ellipse/diamond under a world point. */
   private shapeAt(world: { x: number; y: number }): CanvasElementModel | null {
      const els = this.canvasView.shownElements();
      for (let i = els.length - 1; i >= 0; i--) {
         const el = els[i];
         if (!isClipShape(el)) {
            continue;
         }
         // Undo the rotation around the box center, then test the axis-aligned box.
         const cx = el.x + el.width / 2;
         const cy = el.y + el.height / 2;
         const cos = Math.cos(-(el.angle ?? 0));
         const sin = Math.sin(-(el.angle ?? 0));
         const dx = world.x - cx;
         const dy = world.y - cy;
         const lx = dx * cos - dy * sin;
         const ly = dx * sin + dy * cos;
         if (Math.abs(lx) <= el.width / 2 && Math.abs(ly) <= el.height / 2) {
            return el;
         }
      }
      return null;
   }

   onCanvasDrop(event: DragEvent): void {
      const all = Array.from(event.dataTransfer?.files ?? []);
      const json = all.filter((f) => f.type === 'application/json' || /\.json$/i.test(f.name));
      if (json.length) {
         event.preventDefault();
         if (this.store.canEdit()) {
            void this.importDroppedJson(json, this.viewport.toWorld(event.clientX, event.clientY));
         }
         return;
      }
      // Some OSes leave `type` empty (or odd) for media, so fall back to the extension.
      const files = all.filter(
         (f) =>
            f.type.startsWith('image/') ||
            f.type.startsWith('video/') ||
            /\.(svg|png|jpe?g|gif|webp|mp4|m4v|webm|mov|ogv)$/i.test(f.name)
      );
      if (!files.length) {
         return;
      }
      event.preventDefault();
      this.setDropShape(null);
      if (!this.store.canEdit()) {
         return;
      }
      const world = this.viewport.toWorld(event.clientX, event.clientY);
      const shape = files.length === 1 && !/^video\//.test(files[0].type) ? this.shapeAt(world) : null;
      if (shape && !/\.(mp4|m4v|webm|mov|ogv)$/i.test(files[0].name)) {
         void this.fillShape(shape, files[0]);
         return;
      }
      void this.insertImages(files, world);
   }

   /** Upload a dropped picture and clip it into the shape it landed on. */
   private async fillShape(shape: CanvasElementModel, file: File): Promise<void> {
      const projectId = this.store.projectId();
      if (!projectId) {
         return;
      }
      try {
         const uploaded = await this.images.upload(projectId, this.typed(file));
         await this.mediaActions.fillShapeWithImage(shape, uploaded, {
            strokeColor: this.canvasView.defaultStroke(),
            fillStyle: 'none',
            strokeWidth: 0,
            strokeStyle: 'solid',
            opacity: shape.opacity,
         });
      } catch (err) {
         this.snackBar.open(err instanceof Error ? err.message : 'Could not add the image.', undefined, {
            duration: 4000,
         });
      }
   }

   /** Some sources (an SVG from a file picker) report no MIME type; infer it from the extension. */
   private typed(file: File): Blob {
      const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? '';
      const byExt: Record<string, string> = {
         svg: 'image/svg+xml',
         png: 'image/png',
         jpg: 'image/jpeg',
         jpeg: 'image/jpeg',
         gif: 'image/gif',
         webp: 'image/webp',
         mp4: 'video/mp4',
         m4v: 'video/mp4',
         webm: 'video/webm',
         mov: 'video/quicktime',
         ogv: 'video/ogg',
      };
      return file.type || !byExt[ext] ? file : new Blob([file], { type: byExt[ext] });
   }

   /**
    * Upload image files and add each as an image element, centered on `at` (or the
    * middle of the view) and staggered so several don't stack exactly. Large
    * pictures are scaled down to a comfortable on-canvas size, keeping proportions.
    */
   async insertImages(files: File[], at?: { x: number; y: number }): Promise<void> {
      const projectId = this.store.projectId();
      if (!projectId || !this.store.canEdit()) {
         return;
      }
      const rect = this.viewport.canvasRect();
      const v = this.store.viewport();
      const center = at ?? {
         x: (rect.width / 2 - v.x) / v.zoom,
         y: (rect.height / 2 - v.y) / v.zoom,
      };
      const maxSide = 400;
      let index = 0;
      for (const file of files) {
         try {
            const uploaded = await this.images.upload(projectId, this.typed(file));
            const scale = Math.min(1, maxSide / Math.max(uploaded.width, uploaded.height));
            const width = Math.max(8, Math.round(uploaded.width * scale));
            const height = Math.max(8, Math.round(uploaded.height * scale));
            const shift = index * 24;
            const x = Math.round(center.x - width / 2 + shift);
            const y = Math.round(center.y - height / 2 + shift);
            await this.store.addElement({
               type: 'image',
               x: this.snap.gridSnap$() ? snapToGrid(x) : x,
               y: this.snap.gridSnap$() ? snapToGrid(y) : y,
               width,
               height,
               angle: 0,
               strokeColor: this.canvasView.defaultStroke(),
               fillStyle: 'none',
               strokeWidth: 0,
               strokeStyle: 'solid',
               opacity: 100,
               fileId: uploaded.fileId,
            });
            index += 1;
         } catch (err) {
            this.snackBar.open(err instanceof Error ? err.message : 'Could not add the image.', undefined, {
               duration: 4000,
            });
         }
      }
   }

   /** Merge a project file into this project, landing in the visible part of the canvas. */
   /** Dropped project/selection `.json` files: import each like File → Import, at the drop point. */
   private async importDroppedJson(files: File[], at: { x: number; y: number }): Promise<void> {
      let total = 0;
      for (const [i, file] of files.entries()) {
         try {
            let parsed: unknown;
            try {
               parsed = JSON.parse(await file.text());
            } catch {
               throw new Error(`${file.name} is not valid JSON.`);
            }
            const anchor = { x: Math.round(at.x + i * 40), y: Math.round(at.y + i * 40) };
            total += await this.host.importProjectFile(parsed, anchor);
         } catch (err) {
            const e = err as { error?: { message?: string }; message?: string };
            const detail = e?.error?.message ?? e?.message;
            console.error('Could not import file', err);
            this.snackBar.open(`Could not import file${detail ? `: ${detail}` : ''}`, 'Dismiss', {
               duration: 6000,
            });
            return;
         }
      }
      this.snackBar.open(`Imported ${total} item${total === 1 ? '' : 's'}`, undefined, {
         duration: 2500,
      });
   }
}
