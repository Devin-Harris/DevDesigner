import { computed, effect, inject, Injectable, signal, untracked, type Signal } from '@angular/core';
import { layoutOf, masterOf, presentableSlides, presentationOf, type CanvasElementModel } from '@devdesigner/shared';
import { ThemeService } from '../../../../../core/theme/theme.service';
import { ProjectStore } from '../../../state/project/project.store';
import { elementBox, tableBox } from '../../../helpers/element-geometry.helper';
import { contentForFrame, sequenceDiagramBox } from '../../../helpers/frame-contents.helper';
import { placeholderGhosts } from '../../../helpers/layout-placeholders';
import { SlideRenderService } from './slide-render.service';

/** Debounce between an edit and re-rendering the thumbnails it touched. */
const RENDER_DEBOUNCE_MS = 350;

/**
 * Slide, layout and master thumbnails for every slides-panel part of one editor. Each
 * mounted part registers the frames it shows; one debounced watcher renders the union,
 * and only frames whose inputs changed (perf P2.6 / P3.5). Before, each of the up to ten
 * mounted parts kept its own cache and re-rendered the same slides independently.
 */
@Injectable()
export class SlideThumbnailsService {
   private readonly store = inject(ProjectStore);
   private readonly render = inject(SlideRenderService);
   private readonly theme = inject(ThemeService);

   private readonly sources = signal<readonly Signal<readonly CanvasElementModel[]>[]>([]);
   private readonly _thumbs = signal<ReadonlyMap<string, string>>(new Map());
   /** Data-URL thumbnail per frame id. */
   readonly thumbs = this._thumbs.asReadonly();
   /** Inputs each thumbnail was last rendered from. */
   private readonly deps = new Map<string, readonly unknown[]>();
   private token = 0;

   /** Every frame some mounted part shows, once each. */
   private readonly wanted = computed(() => {
      const byId = new Map<string, CanvasElementModel>();
      for (const source of this.sources()) for (const f of source()) byId.set(f.id, f);
      return [...byId.values()];
   });

   private readonly watch = effect((onCleanup) => {
      const frames = this.wanted();
      // Anything that can appear on a slide.
      this.store.elements();
      this.store.tables();
      this.store.relationships();
      this.store.sequenceDiagrams();
      this.store.lifelines();
      this.store.sequenceMessages();
      this.theme.dark$();
      const timer = setTimeout(() => void untracked(() => this.refresh(frames)), RENDER_DEBOUNCE_MS);
      onCleanup(() => clearTimeout(timer));
   });

   /** Show thumbnails for `frames` until the returned release is called. */
   register(frames: Signal<readonly CanvasElementModel[]>): () => void {
      this.sources.update((list) => [...list, frames]);
      return () => this.sources.update((list) => list.filter((s) => s !== frames));
   }

   /**
    * Re-render only the frames whose content changed. Store rows are immutable, so a
    * frame is unchanged when it and every row drawn on it are the same object references
    * as at its last render; edits elsewhere on the canvas render nothing.
    */
   private async refresh(frames: readonly CanvasElementModel[]): Promise<void> {
      const ids = new Set(frames.map((f) => f.id));
      const deps = new Map(frames.map((f) => [f.id, this.inputs(f)]));
      const dirty = frames.filter((f) => !sameInputs(this.deps.get(f.id), deps.get(f.id)!));
      const removed = [...this._thumbs().keys()].some((id) => !ids.has(id));
      if (!dirty.length && !removed) return;
      const token = (this.token += 1);
      const rendered = dirty.length ? await this.render.render(dirty, { fonts: false, ghosts: true }) : [];
      if (token !== this.token) return;
      const next = new Map([...this._thumbs()].filter(([id]) => ids.has(id)));
      for (const r of rendered) next.set(r.id, SlideRenderService.dataUrl(r.svg));
      // Clean frames adopt the new rows too, so later comparisons stay cheap ref checks.
      for (const f of frames) this.deps.set(f.id, deps.get(f.id)!);
      for (const id of [...this.deps.keys()]) if (!ids.has(id)) this.deps.delete(id);
      this._thumbs.set(next);
   }

   /** Everything a frame's thumbnail is drawn from (the rows `SlideRenderService` uses). */
   private inputs(frame: CanvasElementModel): readonly unknown[] {
      const slideFrames = this.store.slideFrames();
      const mine = contentForFrame(
         frame.id,
         !!frame.slide,
         this.store.elements(),
         this.store.tables(),
         this.store.sequenceDiagrams(),
         this.store.lifelines(),
         this.store.sequenceMessages(),
         layoutOf(frame, slideFrames)?.id,
         masterOf(frame, slideFrames)?.id
      );
      // Fields ({{slide}} / {{total}}) change with the deck's order and size.
      const deckOrder = presentableSlides(slideFrames)
         .filter((f) => presentationOf(f) === presentationOf(frame))
         .map((f) => f.id)
         .join();
      // Rows not assigned to any slide are offered to every frame and cropped away when
      // outside it, so only those overlapping the frame affect its picture.
      const f = { x0: frame.x, y0: frame.y, x1: frame.x + frame.width, y1: frame.y + frame.height };
      const overlaps = (b: { x0: number; y0: number; x1: number; y1: number } | null): boolean =>
         !!b && b.x1 >= f.x0 && b.x0 <= f.x1 && b.y1 >= f.y0 && b.y0 <= f.y1;
      const elements = mine.elements.filter(
         (e) => e.id === frame.id || e.slideId === frame.id || overlaps(elementBox(e))
      );
      const tables = mine.tables.filter((t) => t.slideId === frame.id || overlaps(tableBox(t)));
      const diagrams = mine.diagrams.filter(
         (d) => d.slideId === frame.id || overlaps(sequenceDiagramBox(d, mine.lifelines, mine.messages))
      );
      const diagramIds = new Set(diagrams.map((d) => d.id));
      const columns = new Set(tables.flatMap((t) => t.columns.map((c) => c.id)));
      const relationships = this.store
         .relationships()
         .filter((r) => columns.has(r.sourceColumnId) || columns.has(r.targetColumnId));
      // Layout items arrive as re-stacked copies; compare the stored rows instead.
      const rows = new Map(this.store.elements().map((e) => [e.id, e] as const));
      return [
         frame,
         // Thumbnails bake in the theme's colors.
         this.theme.dark$(),
         deckOrder,
         ...elements.map((e) => rows.get(e.id) ?? e),
         // Empty placeholders are drawn from their layout slot: redraw when either changes.
         ...placeholderGhosts(frame.id, this.store.elements()).sources,
         ...tables,
         ...diagrams,
         ...mine.lifelines.filter((l) => diagramIds.has(l.diagramId)),
         ...mine.messages.filter((m) => diagramIds.has(m.diagramId)),
         ...relationships,
      ];
   }
}

/**
 * Whether a frame's thumbnail inputs are unchanged. `[0]` is the frame; rows that are
 * not the same reference still match when they differ only by the frame's own move
 * (the picture is cropped to the frame, so dragging a whole slide looks identical).
 */
export function sameInputs(a: readonly unknown[] | undefined, b: readonly unknown[]): boolean {
   if (!a || a.length !== b.length) return false;
   const fa = a[0] as CanvasElementModel;
   const fb = b[0] as CanvasElementModel;
   const dx = fb.x - fa.x;
   const dy = fb.y - fa.y;
   return a.every(
      (v, i) => v === b[i] || (typeof v === 'object' && v !== null && shiftedKey(v, 0, 0) === shiftedKey(b[i], dx, dy))
   );
}

/** A row's JSON with its world-space position fields shifted back by (dx, dy). */
function shiftedKey(row: unknown, dx: number, dy: number): string {
   const r = row as Record<string, unknown>;
   const out: Record<string, unknown> = { ...r };
   if (typeof r['x'] === 'number') out['x'] = (r['x'] as number) - dx;
   if (typeof r['y'] === 'number') out['y'] = (r['y'] as number) - dy;
   if (typeof r['originY'] === 'number') out['originY'] = (r['originY'] as number) - dy;
   if (Array.isArray(r['waypoints'])) {
      out['waypoints'] = (r['waypoints'] as { x: number; y: number }[]).map((p) => ({
         ...p,
         x: p.x - dx,
         y: p.y - dy,
      }));
   }
   return JSON.stringify(out);
}
