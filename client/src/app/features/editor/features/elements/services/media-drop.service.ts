import { inject, Injectable, type Signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ElementImagesService } from '../../../services/element-images.service';
import { ProjectStore } from '../../../state/project/project.store';
import { EditorViewportService } from '../../../services/editor-viewport.service';
import { snapToGrid } from '../../../helpers/node-metrics.helper';
import { CanvasViewService } from '../../../services/canvas-view.service';
import { CanvasSnapService } from '../../../services/canvas-snap.service';
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
   private host!: MediaDropHost;

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
      }
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
      if (this.store.canEdit()) {
         void this.insertImages(files, this.viewport.toWorld(event.clientX, event.clientY));
      }
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
            // Some sources (an SVG from a file picker) report no MIME type; infer it.
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
            const typed = file.type || !byExt[ext] ? file : new Blob([file], { type: byExt[ext] });
            const uploaded = await this.images.upload(projectId, typed);
            const scale = Math.min(1, maxSide / Math.max(uploaded.width, uploaded.height));
            const width = Math.max(8, Math.round(uploaded.width * scale));
            const height = Math.max(8, Math.round(uploaded.height * scale));
            const shift = index * 24;
            const x = Math.round(center.x - width / 2 + shift);
            const y = Math.round(center.y - height / 2 + shift);
            await this.store.addElement({
               type: 'image',
               x: this.snap.gridSnap() ? snapToGrid(x) : x,
               y: this.snap.gridSnap() ? snapToGrid(y) : y,
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
            // eslint-disable-next-line no-console
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
