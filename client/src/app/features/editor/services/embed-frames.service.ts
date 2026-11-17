import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { isEmbedUrl, isLocalEmbedUrl } from '@devdesigner/shared';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ProjectStore } from '../state/project/project.store';
import { ElementImagesService } from './element-images.service';

const OPT_OUT_KEY = 'devdesigner.liveFrames.off';

/**
 * Live frames (`embed` elements): which one is being interacted with, reload
 * counters, and the viewer's per-project choice to show placeholders instead of
 * loading other people's URLs. Nothing here is saved to the project.
 */
@Injectable({ providedIn: 'root' })
export class EmbedFramesService {
   private readonly store = inject(ProjectStore);
   private readonly images = inject(ElementImagesService);
   private readonly snackBar = inject(MatSnackBar);

   /** The live frame being captured: its address bar and selection handles hide meanwhile. */
   readonly capturingId = signal<string | null>(null);

   /** The live frame whose page currently takes the pointer (double-click to enter). */
   readonly interactingId = signal<string | null>(null);
   /** Bumped per element to reload its page. */
   readonly nonces = signal<ReadonlyMap<string, number>>(new Map());
   /** Projects this browser chose not to load live frames for. */
   private readonly optedOut = signal<ReadonlySet<string>>(readOptOut());
   /** Projects whose shared-viewer notice was dismissed this session. */
   private readonly dismissed = signal<ReadonlySet<string>>(new Set());

   readonly embeds = computed(() => this.store.elements().filter((e) => e.type === 'embed' && isEmbedUrl(e.text)));
   /** Opened through someone else's link (not the owner): their URLs may not load here. */
   readonly sharedWithMe = computed(() => this.store.accessMode() !== 'OWNER');
   readonly blocked = computed(() => {
      const id = this.store.projectId();
      return !!id && this.optedOut().has(id);
   });
   readonly hasLocal = computed(() => this.embeds().some((e) => isLocalEmbedUrl(e.text)));
   /** Show the "this project has live frames" notice. */
   readonly noticeShown = computed(() => {
      const id = this.store.projectId();
      return !!id && this.sharedWithMe() && this.embeds().length > 0 && !this.dismissed().has(id);
   });

   constructor() {
      // Selecting anything else hands the pointer back to the canvas.
      effect(() => {
         const sel = this.store.selectedElementIds();
         const id = untracked(this.interactingId);
         if (id && !(sel.length === 1 && sel[0] === id)) this.interactingId.set(null);
      });
   }

   nonce(id: string): number {
      return this.nonces().get(id) ?? 0;
   }

   setBlocked(off: boolean): void {
      const id = this.store.projectId();
      if (!id) return;
      const next = new Set(this.optedOut());
      if (off) next.add(id);
      else next.delete(id);
      this.optedOut.set(next);
      try {
         localStorage.setItem(OPT_OUT_KEY, JSON.stringify([...next]));
      } catch {
         /* storage unavailable: the choice lasts this session */
      }
   }

   dismissNotice(): void {
      const id = this.store.projectId();
      if (id) this.dismissed.set(new Set([...this.dismissed(), id]));
   }

   /**
    * Take a picture of a live frame for thumbnails, slide transitions and exports.
    * A page from another site cannot be read directly, so this asks to share this
    * tab, grabs one video frame and crops it to the frame's box on screen.
    */
   async captureSnapshot(id: string): Promise<void> {
      const projectId = this.store.projectId();
      const host = document.querySelector<HTMLElement>(`[data-embed-id="${CSS.escape(id)}"]`);
      const frame = host?.querySelector('iframe');
      if (!projectId || !frame) {
         this.toast('Load the page in the frame first, then capture it.');
         return;
      }
      if (!navigator.mediaDevices?.getDisplayMedia) {
         this.toast('This browser cannot capture the screen.');
         return;
      }
      let stream: MediaStream | null = null;
      this.capturingId.set(id);
      try {
         stream = await navigator.mediaDevices.getDisplayMedia({
            video: { displaySurface: 'browser' },
            audio: false,
            preferCurrentTab: true,
            selfBrowserSurface: 'include',
         } as DisplayMediaStreamOptions);
         const video = document.createElement('video');
         video.muted = true;
         video.srcObject = stream;
         await video.play();
         // Let the share prompt close and the bar/handles hide before grabbing a frame.
         await new Promise((r) => setTimeout(r, 400));
         await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
         const box = frame.getBoundingClientRect();
         const sx = video.videoWidth / window.innerWidth;
         const sy = video.videoHeight / window.innerHeight;
         const x = Math.max(0, box.left);
         const y = Math.max(0, box.top);
         const w = Math.min(window.innerWidth, box.right) - x;
         const h = Math.min(window.innerHeight, box.bottom) - y;
         if (w < 8 || h < 8) throw new Error('Scroll the frame into view, then capture it.');
         const canvas = document.createElement('canvas');
         canvas.width = Math.round(w * sx);
         canvas.height = Math.round(h * sy);
         canvas.getContext('2d')!.drawImage(video, x * sx, y * sy, w * sx, h * sy, 0, 0, canvas.width, canvas.height);
         stream.getTracks().forEach((t) => t.stop());
         stream = null;
         this.capturingId.set(null);
         const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.9));
         if (!blob) throw new Error('The snapshot could not be encoded.');
         const uploaded = await this.images.upload(projectId, blob);
         await this.store.updateElement(id, { fileId: uploaded.fileId });
         this.toast('Snapshot saved: thumbnails and exports now show it.');
      } catch (err) {
         const denied = err instanceof DOMException && err.name === 'NotAllowedError';
         if (!denied) this.toast(err instanceof Error ? err.message : 'The snapshot failed.');
      } finally {
         stream?.getTracks().forEach((t) => t.stop());
         this.capturingId.set(null);
      }
   }

   private toast(message: string): void {
      this.snackBar.open(message, undefined, { duration: 4000 });
   }

   reload(id: string): void {
      const next = new Map(this.nonces());
      next.set(id, (next.get(id) ?? 0) + 1);
      this.nonces.set(next);
   }
}

function readOptOut(): ReadonlySet<string> {
   try {
      const raw: unknown = JSON.parse(localStorage.getItem(OPT_OUT_KEY) ?? '[]');
      return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []);
   } catch {
      return new Set();
   }
}
