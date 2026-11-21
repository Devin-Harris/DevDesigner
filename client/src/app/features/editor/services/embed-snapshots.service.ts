import { computed, Injectable, inject, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ProjectStore } from '../state/project/project.store';
import { ElementImagesService } from './element-images.service';

/**
 * Live-frame snapshots, opted into per frame (the Snapshot toggle in its address bar),
 * so thumbnails, slide transitions and PDF exports show the page instead of a
 * placeholder card. A page from another site cannot be read directly, so a snapshot
 * shares this tab for a moment: one browser prompt, one video frame cropped to the
 * live frame, and sharing stops at once (the browser's "sharing this tab" bar goes
 * away again). The picture is the element's `fileId`; turning the toggle off clears it.
 */
@Injectable({ providedIn: 'root' })
export class EmbedSnapshotsService {
   private readonly store = inject(ProjectStore);
   private readonly images = inject(ElementImagesService);
   private readonly snackBar = inject(MatSnackBar);

   /** The live frame being captured: its address bar and handles hide meanwhile. */
   readonly capturingId$ = signal<string | null>(null);

   /** Live frames that have a snapshot picture. */
   readonly snapshotIds$ = computed(() => new Set(this.store.elements().filter((e) => e.type === 'embed' && e.fileId).map((e) => e.id)));

   hasSnapshot(id: string): boolean {
      return !!this.store.elements().find((e) => e.id === id)?.fileId;
   }

   /** Snapshot toggle: on takes a picture now, off removes it. */
   async setEnabled(id: string, on: boolean): Promise<void> {
      if (on) await this.capture(id);
      else await this.store.updateElement(id, { fileId: null });
   }

   /** Take (or retake) one frame's snapshot. Must run from a click: it asks to share the tab. */
   async capture(id: string): Promise<void> {
      const projectId = this.store.projectId();
      const frame = document.querySelector<HTMLElement>(`[data-embed-id="${CSS.escape(id)}"]`)?.querySelector('iframe');
      if (!projectId || !frame) return this.toast('Load the page in the frame first.');
      if (!navigator.mediaDevices?.getDisplayMedia) return this.toast('This browser cannot take snapshots.');
      let stream: MediaStream | null = null;
      try {
         stream = await navigator.mediaDevices.getDisplayMedia({
            video: { displaySurface: 'browser' },
            audio: false,
            preferCurrentTab: true,
            selfBrowserSurface: 'include',
         } as DisplayMediaStreamOptions);
         this.capturingId$.set(id);
         const video = document.createElement('video');
         video.muted = true;
         video.srcObject = stream;
         await video.play();
         // Let the prompt close and the address bar / handles hide before grabbing.
         await new Promise((r) => setTimeout(r, 350));
         await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
         const box = frame.getBoundingClientRect();
         const sx = video.videoWidth / window.innerWidth;
         const sy = video.videoHeight / window.innerHeight;
         const x = Math.max(0, box.left);
         const y = Math.max(0, box.top);
         const w = Math.min(window.innerWidth, box.right) - x;
         const h = Math.min(window.innerHeight, box.bottom) - y;
         if (w < 8 || h < 8) throw new Error('Scroll the frame into view, then try again.');
         const canvas = document.createElement('canvas');
         canvas.width = Math.round(w * sx);
         canvas.height = Math.round(h * sy);
         canvas.getContext('2d')!.drawImage(video, x * sx, y * sy, w * sx, h * sy, 0, 0, canvas.width, canvas.height);
         stream.getTracks().forEach((t) => t.stop());
         stream = null;
         this.capturingId$.set(null);
         const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.88));
         if (!blob) throw new Error('The snapshot could not be encoded.');
         const uploaded = await this.images.upload(projectId, blob);
         await this.store.updateElement(id, { fileId: uploaded.fileId });
      } catch (err) {
         const denied = err instanceof DOMException && err.name === 'NotAllowedError';
         if (!denied) this.toast(err instanceof Error ? err.message : 'The snapshot failed.');
      } finally {
         stream?.getTracks().forEach((t) => t.stop());
         this.capturingId$.set(null);
      }
   }

   private toast(message: string): void {
      this.snackBar.open(message, undefined, { duration: 3500 });
   }
}
