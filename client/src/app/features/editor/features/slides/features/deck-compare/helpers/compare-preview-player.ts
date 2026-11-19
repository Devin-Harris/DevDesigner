import { signal } from '@angular/core';
import type { CanvasElementModel, SlideEasing } from '@devdesigner/shared';
import { MorphStage } from '../../../services/morph-stage';
import type { RenderedSlide, SlideRenderService } from '../../../services/slide-render.service';
import { ease } from '../../../helpers/ease.helper';

/** What the player reads from its screen. */
export interface PreviewPlayerDeps {
   render: SlideRenderService;
   /** Where the live morph scene goes (the visible player), if mounted. */
   host(): HTMLElement | undefined;
   easing(): SlideEasing;
   /** Transition length in ms. */
   duration(): number;
   /** There is a slide before: the scene is a live morph stage. */
   morphs(): boolean;
   /** Slides either side of the shown pair (rendered ahead of time). */
   neighbours(): (CanvasElementModel | null)[];
}

/**
 * The DeckMorph preview: renders the slide pair (and its neighbours, cached until the
 * project data changes), builds the live morph stage, and scrubs or plays it.
 */
export class ComparePreviewPlayer {
   /** Picture URLs of the slide before and this slide (null while rendering). */
   readonly srcs = signal<(string | null)[]>([null, null]);
   /** Scrubbed position, 0 = the slide before, 1 = this slide (linear time). */
   readonly progress = signal(1);
   readonly playing = signal(false);

   private morph: MorphStage | null = null;
   private raf = 0;
   private token = 0;
   /** Ids of the slide pair the current pictures belong to. */
   private drawnKey = '';
   /** Rendered slides by frame id, valid until the project data changes. */
   private cache = new Map<string, { r: RenderedSlide; url: string }>();
   private cacheData: readonly unknown[] = [];

   constructor(private readonly deps: PreviewPlayerDeps) {}

   scrub(p: number): void {
      this.stop();
      this.show(p);
   }

   show(p: number): void {
      this.progress.set(Math.min(1, Math.max(0, p)));
      this.morph?.update(ease(this.deps.easing(), this.progress()));
   }

   togglePlay(): void {
      if (this.playing()) {
         this.stop();
         return;
      }
      // At the end, "Restart" just rewinds; pressing again plays.
      if (this.progress() >= 1) {
         this.show(0);
         return;
      }
      const total = this.deps.duration() || 300;
      const begin = performance.now() - this.progress() * total;
      this.playing.set(true);
      const tick = (now: number): void => {
         if (!this.playing()) return;
         const lin = Math.min(1, (now - begin) / total);
         this.show(lin);
         if (lin < 1) this.raf = requestAnimationFrame(tick);
         else this.playing.set(false);
      };
      this.raf = requestAnimationFrame(tick);
   }

   stop(): void {
      cancelAnimationFrame(this.raf);
      this.playing.set(false);
   }

   /** Move the live scene into `host` (the player that is visible now). */
   place(host: HTMLElement | undefined): void {
      if (host && this.morph && this.morph.svg.parentElement !== host) host.appendChild(this.morph.svg);
   }

   /**
    * The pair or the project data changed. Swaps to cached pictures at once when it can;
    * returns how long to wait before drawing (null: nothing to draw).
    */
   update(frames: (CanvasElementModel | null)[], data: readonly unknown[]): number | null {
      const edited = data.length !== this.cacheData.length || data.some((d, i) => d !== this.cacheData[i]);
      if (edited) {
         this.cacheData = data;
         this.clearCache();
      }
      const key = frames.map((f) => f?.id ?? '').join('|');
      const switched = key !== this.drawnKey;
      if (switched) {
         this.drawnKey = key;
         this.token += 1;
         // Already rendered (the usual case when stepping): swap at once.
         if (!this.showCached(frames)) {
            // Not ready yet: never leave the previous pair's pictures up.
            this.srcs.set([null, null]);
            this.morph?.svg.remove();
            this.morph = null;
         }
         if (!edited && frames.every((f) => !f || this.cache.has(f.id))) {
            this.prefetch();
            return null;
         }
      }
      return switched ? 0 : 200;
   }

   async draw(frames: (CanvasElementModel | null)[]): Promise<void> {
      const t = ++this.token;
      const data = this.cacheData;
      await this.renderMissing(frames);
      if (t !== this.token || data !== this.cacheData) return;
      this.showCached(frames);
      this.prefetch();
   }

   dispose(): void {
      this.stop();
      this.token += 1;
      this.clearCache();
   }

   private clearCache(): void {
      this.cache.forEach((c) => URL.revokeObjectURL(c.url));
      this.cache = new Map();
   }

   /** Show the pair from the cache; false when a slide is not rendered yet. */
   private showCached(frames: (CanvasElementModel | null)[]): boolean {
      if (!frames.every((f) => !f || this.cache.has(f.id))) return false;
      const hits = frames.map((f) => (f ? (this.cache.get(f.id) ?? null) : null));
      void this.buildMorph(hits.filter((h) => !!h).map((h) => h.r));
      this.srcs.set(hits.map((h) => h?.url ?? null));
      return true;
   }

   private async buildMorph(rendered: RenderedSlide[]): Promise<void> {
      const host = this.deps.host();
      if (!host) return;
      this.morph?.svg.remove();
      this.morph = null;
      if (rendered.length < 2 || !this.deps.morphs()) return;
      const stage = new MorphStage(rendered[0], rendered[1]);
      host.appendChild(stage.svg);
      await stage.prepare();
      this.morph = stage;
      this.show(this.progress());
   }

   private async renderMissing(frames: (CanvasElementModel | null)[]): Promise<boolean> {
      const missing = frames.filter((f): f is CanvasElementModel => !!f && !this.cache.has(f.id));
      if (!missing.length) return true;
      const cache = this.cache;
      const rendered = await this.deps.render.render(missing, { fonts: true });
      if (cache !== this.cache) return false;
      for (const r of rendered) {
         if (cache.has(r.id)) continue;
         cache.set(r.id, { r, url: URL.createObjectURL(new Blob([r.svg], { type: 'image/svg+xml;charset=utf-8' })) });
      }
      return true;
   }

   /** Render the slides either side of this pair in the background. */
   private prefetch(): void {
      const data = this.cacheData;
      setTimeout(() => {
         if (data !== this.cacheData) return;
         void this.renderMissing(this.deps.neighbours());
      }, 50);
   }
}
