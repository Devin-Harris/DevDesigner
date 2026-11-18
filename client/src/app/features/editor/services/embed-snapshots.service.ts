import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { isEmbedUrl } from '@devdesigner/shared';
import { ProjectStore } from '../state/project/project.store';
import { ElementImagesService } from './element-images.service';
import { EmbedFramesService } from './embed-frames.service';

/** How often visible live frames are re-captured while sharing is on. */
const POLL_MS = 60_000;
/** After a frame finishes loading, wait this long (scripts, fonts) before its first capture. */
const SETTLE_MS = 2_500;

/**
 * Automatic live-frame snapshots, so thumbnails, slide transitions and PDF exports show
 * the page instead of a placeholder card. A page from another site cannot be read
 * directly, so this shares the current tab once (one browser prompt covers every live
 * frame until the page is closed or reloaded) and, while that lasts, now and then
 * crops each live frame that is fully on screen out of a video frame of the tab.
 * Nothing is captured while a frame is selected or being used (its toolbar and
 * handles would be in the picture).
 */
@Injectable({ providedIn: 'root' })
export class EmbedSnapshotsService {
   private readonly store = inject(ProjectStore);
   private readonly images = inject(ElementImagesService);
   private readonly frames = inject(EmbedFramesService);

   /** Sharing is on for this page. */
   readonly active = signal(false);
   /** The user turned the prompt down this page load: don't ask again until reload. */
   private declined = false;
   private stream: MediaStream | null = null;
   private video: HTMLVideoElement | null = null;
   private timer: ReturnType<typeof setInterval> | null = null;
   private busy = false;
   /** Last capture per frame (url it showed + time), to skip needless re-uploads. */
   private readonly last = new Map<string, { url: string; at: number }>();

   constructor() {
      inject(DestroyRef).onDestroy(() => this.stop());
   }

   /**
    * Called from a user gesture (a live frame's address was just entered): asks once to
    * share this tab so live frames can be snapshotted. Later calls do nothing.
    */
   async ensureSharing(): Promise<void> {
      if (this.stream || this.declined || !navigator.mediaDevices?.getDisplayMedia || !this.store.canEdit()) return;
      try {
         this.stream = await navigator.mediaDevices.getDisplayMedia({
            video: { displaySurface: 'browser', frameRate: 1 },
            audio: false,
            preferCurrentTab: true,
            selfBrowserSurface: 'include',
         } as DisplayMediaStreamOptions);
      } catch {
         this.declined = true;
         return;
      }
      const video = document.createElement('video');
      video.muted = true;
      video.srcObject = this.stream;
      await video.play().catch(() => undefined);
      this.video = video;
      this.active.set(true);
      // The user stopped sharing from the browser's own bar.
      this.stream.getVideoTracks()[0]?.addEventListener('ended', () => this.stop());
      this.timer = setInterval(() => void this.captureAll(), POLL_MS);
      setTimeout(() => void this.captureAll(), SETTLE_MS);
   }

   /** A live frame finished loading: capture it soon (if sharing is on). */
   frameLoaded(): void {
      if (this.active()) setTimeout(() => void this.captureAll(), SETTLE_MS);
   }

   stop(): void {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.stream?.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.video = null;
      this.active.set(false);
   }

   private async captureAll(): Promise<void> {
      const video = this.video;
      const projectId = this.store.projectId();
      if (!video || !projectId || this.busy || document.hidden || !this.store.canEdit()) return;
      this.busy = true;
      try {
         const selected = new Set(this.store.selectedElementIds());
         const interacting = this.frames.interactingId();
         for (const el of this.store.elements()) {
            if (el.type !== 'embed' || !isEmbedUrl(el.text) || selected.has(el.id) || el.id === interacting) continue;
            const host = document.querySelector<HTMLElement>(`[data-embed-id="${CSS.escape(el.id)}"]`);
            const frame = host?.querySelector('iframe.ready');
            if (!frame) continue;
            const prev = this.last.get(el.id);
            if (prev && prev.url === el.text && Date.now() - prev.at < POLL_MS / 2) continue;
            const box = frame.getBoundingClientRect();
            // Only frames wholly on screen and big enough to be worth a picture.
            if (box.left < 0 || box.top < 0 || box.right > window.innerWidth || box.bottom > window.innerHeight) continue;
            if (box.width < 80 || box.height < 50) continue;
            const blob = await this.grab(video, box);
            if (!blob) continue;
            const uploaded = await this.images.upload(projectId, blob);
            this.last.set(el.id, { url: el.text ?? '', at: Date.now() });
            await this.store.updateElementSilently(el.id, { fileId: uploaded.fileId });
         }
      } catch {
         // A failed capture just leaves the previous snapshot; the next poll tries again.
      } finally {
         this.busy = false;
      }
   }

   private grab(video: HTMLVideoElement, box: DOMRect): Promise<Blob | null> {
      const sx = video.videoWidth / window.innerWidth;
      const sy = video.videoHeight / window.innerHeight;
      if (!sx || !sy) return Promise.resolve(null);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(box.width * sx);
      canvas.height = Math.round(box.height * sy);
      canvas
         .getContext('2d')!
         .drawImage(video, box.left * sx, box.top * sy, box.width * sx, box.height * sy, 0, 0, canvas.width, canvas.height);
      return new Promise((r) => canvas.toBlob(r, 'image/webp', 0.85));
   }
}
