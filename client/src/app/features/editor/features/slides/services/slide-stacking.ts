import type { CanvasElementModel } from '@devdesigner/shared';
import { presentationOf, presentationSlides, presentationLayouts } from '@devdesigner/shared';
import { boxToOuter, toInner, toOuter } from '../../../helpers/slide-zoom.helper';
import { frameContents } from '../../../helpers/frame-contents.helper';
import { elementBox, tableBox } from '../../../helpers/element-geometry.helper';
import type { Box } from '../../../models/geometry.model';
import type { SlidePlacementService } from './slide-placement.service';

/** Legacy slide stacking, separation and ordering of dropped slides. */
export class SlideStacking {
   constructor(private readonly host: SlidePlacementService) {}

   /**
    * After a move: slide items dropped wholly outside their block (as drawn, at the
    * slide's zoom) become free canvas items. While zoomed out they are moved to where
    * they appear, so they stay under the pointer.
    */
   releaseDroppedOutOfSlides(ids: { elements: string[]; tables: string[] }): void {
      if (!this.host.store.canEdit()) {
         return;
      }
      const frames = new Map(this.host.store.slideFrames().map((f) => [f.id, f]));
      const shown = this.host.store.shownSlideIds();
      const views = new Map(this.host.canvasView.slideViews().map((v) => [v.frameId, v]));
      const release = { elements: [] as string[], tables: [] as string[], diagrams: [] as string[] };
      const moveTo = new Map<string, { elements: string[]; tables: string[]; diagrams: string[] }>();
      const check = (id: string, slideId: string | undefined, box: Box, kind: 'elements' | 'tables'): void => {
         const f = slideId ? frames.get(slideId) : undefined;
         if (!f || !shown.has(f.id)) return;
         const view = views.get(f.id);
         const drawn = view ? boxToOuter(view, box) : box;
         const outside = drawn.x1 < f.x || drawn.x0 > f.x + f.width || drawn.y1 < f.y || drawn.y0 > f.y + f.height;
         if (!outside) return;
         const one = { elements: kind === 'elements' ? [id] : [], tables: kind === 'tables' ? [id] : [], diagrams: [] };
         const c = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
         const to = view ? toOuter(view, c) : c;
         if (view) {
            this.host.shiftItems(one, to.x - c.x, to.y - c.y);
         }
         // Dropped onto another shown slide: it moves straight there, keeping its theme
         // tokens ($heading, $accent1...) instead of being baked as a free canvas item first.
         const target = [...frames.values()].find(
            (g) =>
               g.id !== f.id &&
               shown.has(g.id) &&
               to.x >= g.x &&
               to.x <= g.x + g.width &&
               to.y >= g.y &&
               to.y <= g.y + g.height
         );
         if (target) {
            const tv = views.get(target.id);
            if (tv) {
               const inner = toInner(tv, to);
               this.host.shiftItems(one, inner.x - to.x, inner.y - to.y);
            }
            const list = moveTo.get(target.id) ?? { elements: [], tables: [], diagrams: [] };
            list[kind].push(id);
            moveTo.set(target.id, list);
            return;
         }
         release[kind].push(id);
      };
      const elementIds = new Set(ids.elements);
      for (const e of this.host.store.elements()) {
         if (elementIds.has(e.id) && e.type !== 'frame') check(e.id, e.slideId, elementBox(e), 'elements');
      }
      const tableIds = new Set(ids.tables);
      for (const t of this.host.store.tables()) {
         if (tableIds.has(t.id)) check(t.id, t.slideId, tableBox(t), 'tables');
      }
      if (release.elements.length || release.tables.length) {
         void this.host.store.assignSlide(release, null);
      }
      for (const [slideId, items] of moveTo) {
         void this.host.store.assignSlide(items, slideId);
      }
   }

   /**
    * Slides used to sit side by side on the canvas. They are now stacked in one spot
    * and own their contents by id, so a slide that owns nothing yet claims what lies
    * inside its frame and moves (with it) onto the first slide's spot. Runs once per
    * such slide; an empty or already-owning slide is left alone.
    */
   async stackLegacySlides(): Promise<void> {
      if (this.host.migratingSlides || !this.host.store.canEdit() || !this.host.store.projectId()) {
         return;
      }
      const frames = this.host.store.slideFrames();
      if (frames.length === 0) {
         return;
      }
      // A presentation's slides gather on its first slide's spot.
      const anchors = new Map<string, CanvasElementModel>();
      for (const f of frames) {
         if (!anchors.has(presentationOf(f))) {
            anchors.set(presentationOf(f), f);
         }
      }
      const elements = this.host.store.elements();
      // A frame is never the content of a slide; undo an earlier mistaken claim.
      const claimedFrames = elements.filter((e) => e.type === 'frame' && e.slideId);
      const tables = this.host.store.tables();
      const diagrams = this.host.store.sequenceDiagrams();
      const owns = (id: string): boolean =>
         elements.some((e) => e.slideId === id) ||
         tables.some((t) => t.slideId === id) ||
         diagrams.some((d) => d.slideId === id);
      // A slide that already owns content but sits away from its presentation's spot (a
      // file or tool laid the slides out side by side) moves back, taking its contents.
      // Checked once per loaded project only: this runs on every edit, and mid-drag the
      // dragged slide is briefly away from the others until syncSlideMoves catches them
      // up; snapping it back then fought the drag and double-shifted slide contents.
      const checkMisplaced = this.host.misplacedCheckedFor !== this.host.store.projectId();
      this.host.misplacedCheckedFor = this.host.store.projectId();
      const misplaced = !checkMisplaced
         ? []
         : frames.filter((f) => {
              const anchor = anchors.get(presentationOf(f))!;
              return owns(f.id) && (f.x !== anchor.x || f.y !== anchor.y);
           });
      // Only slides still sitting elsewhere (saved side by side) are legacy: a slide on
      // the shared spot gets its content through adoption of the shown slide instead.
      const work = frames
         .filter((f) => {
            const anchor = anchors.get(presentationOf(f))!;
            return !owns(f.id) && (f.x !== anchor.x || f.y !== anchor.y);
         })
         .map((f) => {
            const anchor = anchors.get(presentationOf(f))!;
            const asPlain = elements.map((e) => (e.id === f.id ? { ...e, slide: undefined } : e));
            const geo = frameContents(
               new Set([f.id]),
               asPlain,
               tables,
               diagrams,
               this.host.store.lifelines(),
               this.host.store.sequenceMessages(),
               null
            );
            for (const id of [...geo.elementIds]) {
               if (elements.find((e) => e.id === id)?.type === 'frame') {
                  geo.elementIds.delete(id);
               }
            }
            return { f, geo, dx: anchor.x - f.x, dy: anchor.y - f.y };
         })
         // Only slides with something to claim; an empty slide is left where it is (the
         // move lock keeps it with the others from then on).
         .filter((w) => w.geo.elementIds.size || w.geo.tableIds.size || w.geo.diagramIds.size);
      if (!work.length && !claimedFrames.length && !misplaced.length) {
         return;
      }
      this.host.migratingSlides = true;
      try {
         await this.host.store.batchHistory(async () => {
            for (const f of misplaced) {
               const anchor = anchors.get(presentationOf(f))!;
               this.host.shiftSlide(f.id, anchor.x - f.x, anchor.y - f.y);
            }
            for (const fr of claimedFrames) {
               await this.host.store.updateElement(fr.id, { slideId: null });
            }
            for (const { f, geo, dx, dy } of work) {
               const moved = dx !== 0 || dy !== 0;
               if (moved) {
                  await this.host.store.updateElement(f.id, { x: f.x + dx, y: f.y + dy });
               }
               for (const id of geo.elementIds) {
                  const e = this.host.store.elements().find((x) => x.id === id);
                  if (e) {
                     await this.host.store.updateElement(id, {
                        slideId: f.id,
                        ...(moved ? { x: e.x + dx, y: e.y + dy } : {}),
                     });
                  }
               }
               for (const id of geo.tableIds) {
                  const t = this.host.store.tables().find((x) => x.id === id);
                  if (t) {
                     await this.host.store.updateTable(id, { slideId: f.id });
                     if (moved) {
                        this.host.store.moveTable(id, t.x + dx, t.y + dy);
                     }
                  }
               }
               for (const id of geo.diagramIds) {
                  const start = this.host.canvasView.sequenceStart(id);
                  await this.host.store.updateSequenceConfig(id, { slideId: f.id });
                  if (start && moved) {
                     this.host.store.shiftSequence(id, start.xs, dx, start.originY, dy, start.rows);
                     await this.host.store.updateSequenceConfig(id, { originY: start.originY + dy });
                     for (const [lifelineId, x] of start.xs) {
                        this.host.store.moveLifeline(lifelineId, x + dx);
                     }
                  }
               }
               if (moved) {
                  for (const rel of this.host.store.relationships()) {
                     if (rel.waypoints?.length) {
                        const locs = this.host.canvasView.columnLocations();
                        const st = locs.get(rel.sourceColumnId)?.table.id;
                        const tt = locs.get(rel.targetColumnId)?.table.id;
                        if (st && tt && geo.tableIds.has(st) && geo.tableIds.has(tt)) {
                           this.host.store.setWaypoints(
                              rel.id,
                              rel.waypoints.map((w) => ({ x: w.x + dx, y: w.y + dy }))
                           );
                        }
                     }
                  }
               }
            }
         });
      } finally {
         this.host.migratingSlides = false;
         this.host.slideBounds = new Map(
            this.host.store.slideFrames().map((f) => [f.id, { x: f.x, y: f.y, w: f.width, h: f.height }])
         );
      }
   }

   /**
    * Presentations used to share one spot. Each presentation now has its own set of
    * panels, so one that sits exactly on top of an earlier presentation moves down
    * (with its slides and their contents) to free canvas. Checked once per loaded
    * project only: a presentation Alt-dragged off as a copy starts exactly on its
    * original, and spreading them then pushed the original away.
    */
   separateStackedPresentations(): void {
      const projectId = this.host.store.projectId();
      if (this.host.migratingSlides || !this.host.store.canEdit() || !projectId) {
         return;
      }
      const frames = this.host.store.slideFrames();
      if (!frames.length || this.host.separatedFor === projectId) {
         return;
      }
      this.host.separatedFor = projectId;
      const placed: Array<{ x: number; y: number }> = [];
      for (const name of this.host.store.presentations()) {
         const slides = presentationSlides(frames, name);
         const first = slides[0];
         if (!first) {
            continue;
         }
         let dy = 0;
         while (placed.some((p) => p.x === first.x && p.y === first.y + dy)) {
            dy += first.height + 200;
         }
         placed.push({ x: first.x, y: first.y + dy });
         if (dy === 0) {
            continue;
         }
         for (const f of slides) {
            this.host.shiftSlide(f.id, 0, dy);
            this.host.slideBounds.set(f.id, { x: f.x, y: f.y + dy, w: f.width, h: f.height });
         }
      }
   }

   /**
    * Give pasted/duplicated slide copies their place in `deck`: at `toIndex` when given
    * (Alt-drag in the panel), else right after `afterId`, keeping their relative order.
    */
   async orderSlideCopies(
      copies: readonly CanvasElementModel[],
      deck: string,
      afterId: string | null,
      toIndex?: number,
      layouts = false
   ): Promise<void> {
      const copyIds = new Set(copies.map((c) => c.id));
      const fresh = copies
         .map((c) => this.host.store.elements().find((e) => e.id === c.id))
         .filter((c): c is CanvasElementModel => !!c?.slide && !!c.slide.layout === layouts && !c.slide.master)
         .sort((a, b) => (a.slide!.order ?? 0) - (b.slide!.order ?? 0));
      if (!fresh.length) return;
      const list = (
         layouts
            ? presentationLayouts(this.host.store.slideFrames(), deck)
            : presentationSlides(this.host.store.slideFrames(), deck)
      ).filter((f) => !copyIds.has(f.id));
      let at: number;
      if (toIndex !== undefined) {
         at = toIndex - 1;
      } else {
         at = afterId ? list.findIndex((f) => f.id === afterId) : -1;
         if (at < 0) at = list.length - 1;
      }
      const lo = list[at]?.slide?.order;
      const hi = list[at + 1]?.slide?.order;
      const n = fresh.length;
      for (let i = 0; i < n; i++) {
         const order =
            lo === undefined && hi === undefined
               ? i
               : lo === undefined
                 ? hi! - (n - i)
                 : hi === undefined
                   ? lo + i + 1
                   : lo + ((hi - lo) * (i + 1)) / (n + 1);
         const c = fresh[i];
         if (c.slide!.order !== order) {
            await this.host.store.updateElement(c.id, { slide: { ...c.slide!, order } });
         }
      }
   }
}
