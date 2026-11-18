import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { isEmbedUrl, isLocalEmbedUrl } from '@devdesigner/shared';
import { ProjectStore } from '../state/project/project.store';

const OPT_OUT_KEY = 'devdesigner.liveFrames.off';

/**
 * Live frames (`embed` elements): which one is being interacted with, reload
 * counters, and the viewer's per-project choice to show placeholders instead of
 * loading other people's URLs. Nothing here is saved to the project.
 */
@Injectable({ providedIn: 'root' })
export class EmbedFramesService {
   private readonly store = inject(ProjectStore);

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
