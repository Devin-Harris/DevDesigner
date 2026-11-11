import type { SequenceStart } from '../../../models/sequence-start.model';
import { EditorViewportService } from '../../../services/editor-viewport.service';
import { PointerGestureService } from '../../../services/pointer-gesture.service';
import { inject, Injectable, effect, untracked } from '@angular/core';
import type { CanvasElementModel } from '@devdesigner/shared';
import {
   presentationOf,
   presentationSlides,
   type SequenceDiagramModel,
   layoutOf,
   layoutNameOf,
   nextCopyName,
   presentationLayouts,
   DEFAULT_SLIDE_TRANSITION,
} from '@devdesigner/shared';
import { boxToOuter, MIN_SLIDE_ZOOM, slideViewRegion, toInner, toOuter } from '../../../helpers/slide-zoom.helper';
import { ProjectStore } from '../../../state/project/project.store';
import { fillFromLayout } from '../../../helpers/layout-placeholders';
import { frameContents, sequenceDiagramBox } from '../../../helpers/frame-contents.helper';
import { framePreset } from '../../../shared/constants/frame-presets';
import { elementBox, tableBox } from '../../../helpers/element-geometry.helper';
import type { Box } from '../../../models/geometry.model';
import { DEFAULT_ELEMENT_STROKE } from '../../../shared/constants/canvas.constants';
import { SlideshowService } from './slideshow.service';
import { CanvasViewService } from '../../../services/canvas-view.service';
/**
 * Where slides and their content live on the canvas: slides move together, content dropped on a
 * shown slide joins it, legacy/stacked decks get their own spot, and new/duplicated slides.
 */
@Injectable()
export class SlidePlacementService {
   private readonly gesture = inject(PointerGestureService);
   private readonly store = inject(ProjectStore);
   private readonly viewport = inject(EditorViewportService);
   private readonly slideshow = inject(SlideshowService);
   private readonly canvasView = inject(CanvasViewService);

   constructor() {
      // Slides are locked together: moving one moves all of them (once the move settles).
      effect((onCleanup) => {
         this.store.slideFrames();
         // Not mid-drag: a pause would shift the rest early; the whole move is caught up on release.
         if (this.gesture.gestureActive()) return;
         const timer = setTimeout(() => this.syncSlideMoves(), 160);
         onCleanup(() => clearTimeout(timer));
      });
      // Things dropped or moved into the shown slide's frame become part of that slide.
      effect((onCleanup) => {
         this.store.elements();
         this.store.tables();
         this.store.sequenceDiagrams();
         this.store.lifelines();
         this.store.sequenceMessages();
         this.store.shownSlideIds();
         this.canvasView.slideViews();
         // Never mid-drag: adopting re-maps items into a zoomed slide, which would jump them.
         if (this.gesture.gestureActive()) {
            return;
         }
         const timer = setTimeout(() => void this.adoptIntoShownSlide(), 350);
         onCleanup(() => clearTimeout(timer));
      });
      // Selecting something on a presentation's slide makes that presentation the selected one.
      effect(() => {
         const id = this.store.selectedElementIds()[0];
         const frames = this.store.slideFrames();
         untracked(() => {
            const el = id ? this.store.elements().find((e) => e.id === id) : undefined;
            const frame = el?.type === 'frame' ? el : frames.find((f) => f.id === el?.slideId);
            if (frame?.slide) {
               this.store.selectPresentation(presentationOf(frame));
            }
         });
      });
      // Bring slides saved side by side onto their presentation's spot (once per such
      // slide), and give presentations that were stacked on one spot their own.
      effect(() => {
         this.store.slideFrames();
         this.store.elements();
         untracked(() => void this.stackLegacySlides().then(() => this.separateStackedPresentations()));
      });
   }
   private migratingSlides = false;

   /** Project whose misplaced slides stackLegacySlides already gathered (once per load). */
   private misplacedCheckedFor: string | null = null;

   /** Project whose stacked presentations separateStackedPresentations already spread out (once per load). */
   private separatedFor: string | null = null;

   /** Where each slide frame was last seen, to notice which one the user moved. */
   slideBounds = new Map<string, { x: number; y: number; w: number; h: number }>();

   /**
    * Slides are stacked in one spot and stay that way: when one slide frame is moved
    * (same size, new position) every other slide, with its contents, moves by the
    * same amount. Skipped when several moved at once (a remote peer already did it).
    */
   syncSlideMoves(): void {
      const all = this.store.slideFrames();
      const prev = this.slideBounds;
      this.slideBounds = new Map(all.map((f) => [f.id, { x: f.x, y: f.y, w: f.width, h: f.height }]));
      if (!this.store.canEdit() || this.migratingSlides) {
         return;
      }
      // Each presentation is locked together on its own: its slides share a spot and a size.
      for (const name of this.store.presentations()) {
         // Layouts share the spot too.
         const frames = all.filter((f) => presentationOf(f) === name);
         const known = frames.filter((f) => prev.has(f.id));
         if (known.length === 0) {
            // First sight of this presentation: bring slides that differ to the first one's size.
            const first = frames[0];
            for (const f of frames.slice(1)) {
               if (first && (f.width !== first.width || f.height !== first.height)) {
                  void this.store.patchElementSilently(f.id, {
                     x: first.x,
                     y: first.y,
                     width: first.width,
                     height: first.height,
                  });
                  this.slideBounds.set(f.id, { x: first.x, y: first.y, w: first.width, h: first.height });
               }
            }
            continue;
         }
         // Every slide has the same size: resizing one resizes them all.
         const resized = frames.filter((f) => {
            const p = prev.get(f.id);
            return !!p && (p.w !== f.width || p.h !== f.height);
         });
         if (resized.length === 1) {
            const r = resized[0];
            for (const other of frames) {
               if (other.id === r.id) {
                  continue;
               }
               void this.store.patchElementSilently(other.id, {
                  x: r.x,
                  y: r.y,
                  width: r.width,
                  height: r.height,
               });
               this.slideBounds.set(other.id, { x: r.x, y: r.y, w: r.width, h: r.height });
            }
            continue;
         }
         const moved = frames.filter((f) => {
            const p = prev.get(f.id);
            return !!p && p.w === f.width && p.h === f.height && (p.x !== f.x || p.y !== f.y);
         });
         if (moved.length !== 1) {
            continue;
         }
         const m = moved[0];
         const p = prev.get(m.id)!;
         const dx = m.x - p.x;
         const dy = m.y - p.y;
         for (const other of frames) {
            if (other.id === m.id) {
               continue;
            }
            this.shiftSlide(other.id, dx, dy);
            const b = this.slideBounds.get(other.id);
            if (b) {
               this.slideBounds.set(other.id, { ...b, x: b.x + dx, y: b.y + dy });
            }
         }
      }
   }

   /** Content lying inside a shown slide's frame that belongs to no slide joins it. */
   async adoptIntoShownSlide(): Promise<void> {
      if (!this.store.canEdit() || this.migratingSlides || this.slideshow.presentation()) {
         return;
      }
      const shown = this.store.shownSlideIds();
      for (const active of this.store.slideFrames().filter((f) => shown.has(f.id))) {
         await this.adoptInto(active);
      }
   }

   private async adoptInto(active: CanvasElementModel): Promise<void> {
      // The block is the frame's spot on the canvas. Free content dropped on it joins the
      // shown slide; while the slide is zoomed out, it is moved into the slide's own
      // coordinates so it stays where it was dropped (drawn at the slide's zoom).
      const view = this.canvasView.slideViews().find((v) => v.frameId === active.id);
      const inside = (b: Box): boolean => {
         const cx = (b.x0 + b.x1) / 2;
         const cy = (b.y0 + b.y1) / 2;
         return cx >= active.x && cx <= active.x + active.width && cy >= active.y && cy <= active.y + active.height;
      };
      const lifelines = this.store.lifelines();
      const messages = this.store.sequenceMessages();
      const diagramBox = (d: SequenceDiagramModel): Box | null => sequenceDiagramBox(d, lifelines, messages);
      const adopt = {
         elements: this.store.elements().filter((e) => e.type !== 'frame' && !e.slideId && inside(elementBox(e))),
         tables: this.store.tables().filter((t) => !t.slideId && inside(tableBox(t))),
         diagrams: this.store.sequenceDiagrams().filter((d) => {
            const b = !d.slideId && diagramBox(d);
            return !!b && inside(b);
         }),
      };
      if (adopt.elements.length || adopt.tables.length || adopt.diagrams.length) {
         const ids = {
            elements: adopt.elements.map((e) => e.id),
            tables: adopt.tables.map((t) => t.id),
            diagrams: adopt.diagrams.map((d) => d.id),
         };
         if (view) {
            // Each item keeps its centre under the same spot: shift it by where that centre
            // lies in the slide's coordinates.
            const moveTo = (b: Box, one: { elements: string[]; tables: string[]; diagrams: string[] }): void => {
               const c = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
               const to = toInner(view, c);
               this.shiftItems(one, to.x - c.x, to.y - c.y);
            };
            for (const e of adopt.elements) moveTo(elementBox(e), { elements: [e.id], tables: [], diagrams: [] });
            for (const t of adopt.tables) moveTo(tableBox(t), { elements: [], tables: [t.id], diagrams: [] });
            for (const d of adopt.diagrams) {
               const b = diagramBox(d);
               if (b) moveTo(b, { elements: [], tables: [], diagrams: [d.id] });
            }
         }
         await this.store.assignSlide(ids, active.id);
      }

      // Owned content that lies wholly past anything the slide can ever show (cloned or
      // moved far away, e.g. by another client) belongs to the normal canvas. Items just
      // outside the frame stay: they are staged for morph entrances/exits. Dragging an
      // item out of the block releases it on drop (`releaseDroppedOutOfSlides`).
      const reach = slideViewRegion(active, MIN_SLIDE_ZOOM);
      const apart = (b: Box): boolean => b.x1 < reach.x0 || b.x0 > reach.x1 || b.y1 < reach.y0 || b.y0 > reach.y1;
      const free = {
         elements: this.store
            .elements()
            .filter((e) => e.type !== 'frame' && e.slideId === active.id && apart(elementBox(e)))
            .map((e) => e.id),
         tables: this.store
            .tables()
            .filter((t) => t.slideId === active.id && apart(tableBox(t)))
            .map((t) => t.id),
         diagrams: this.store
            .sequenceDiagrams()
            .filter((d) => {
               const b = d.slideId === active.id && diagramBox(d);
               return !!b && apart(b);
            })
            .map((d) => d.id),
      };
      if (free.elements.length || free.tables.length || free.diagrams.length) {
         await this.store.assignSlide(free, null);
      }
   }

   /**
    * After a move: slide items dropped wholly outside their block (as drawn, at the
    * slide's zoom) become free canvas items. While zoomed out they are moved to where
    * they appear, so they stay under the pointer.
    */
   releaseDroppedOutOfSlides(ids: { elements: string[]; tables: string[] }): void {
      if (!this.store.canEdit()) {
         return;
      }
      const frames = new Map(this.store.slideFrames().map((f) => [f.id, f]));
      const shown = this.store.shownSlideIds();
      const views = new Map(this.canvasView.slideViews().map((v) => [v.frameId, v]));
      const release = { elements: [] as string[], tables: [] as string[], diagrams: [] as string[] };
      const check = (id: string, slideId: string | undefined, box: Box, kind: 'elements' | 'tables'): void => {
         const f = slideId ? frames.get(slideId) : undefined;
         if (!f || !shown.has(f.id)) return;
         const view = views.get(f.id);
         const drawn = view ? boxToOuter(view, box) : box;
         const outside = drawn.x1 < f.x || drawn.x0 > f.x + f.width || drawn.y1 < f.y || drawn.y0 > f.y + f.height;
         if (!outside) return;
         if (view) {
            const c = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
            const to = toOuter(view, c);
            this.shiftItems(
               { elements: kind === 'elements' ? [id] : [], tables: kind === 'tables' ? [id] : [], diagrams: [] },
               to.x - c.x,
               to.y - c.y
            );
         }
         release[kind].push(id);
      };
      const elementIds = new Set(ids.elements);
      for (const e of this.store.elements()) {
         if (elementIds.has(e.id) && e.type !== 'frame') check(e.id, e.slideId, elementBox(e), 'elements');
      }
      const tableIds = new Set(ids.tables);
      for (const t of this.store.tables()) {
         if (tableIds.has(t.id)) check(t.id, t.slideId, tableBox(t), 'tables');
      }
      if (release.elements.length || release.tables.length) {
         void this.store.assignSlide(release, null);
      }
   }

   /** Move a slide's frame and everything it owns by (dx, dy), without undo entries. */
   private shiftSlide(frameId: string, dx: number, dy: number): void {
      const frame = this.store.elements().find((e) => e.id === frameId);
      if (frame) {
         this.store.moveElement(frameId, frame.x + dx, frame.y + dy);
      }
      this.shiftItems(
         {
            elements: this.store
               .elements()
               .filter((e) => e.slideId === frameId)
               .map((e) => e.id),
            tables: this.store
               .tables()
               .filter((t) => t.slideId === frameId)
               .map((t) => t.id),
            diagrams: this.store
               .sequenceDiagrams()
               .filter((d) => d.slideId === frameId)
               .map((d) => d.id),
         },
         dx,
         dy
      );
   }

   /** Move elements, tables (with their waypoints) and sequence diagrams by (dx, dy). */
   private shiftItems(
      items: { elements: string[]; tables: string[]; diagrams: string[] },
      dx: number,
      dy: number
   ): void {
      const elementIds = new Set(items.elements);
      const elements = new Map<string, { x: number; y: number }>();
      for (const e of this.store.elements()) {
         if (elementIds.has(e.id)) elements.set(e.id, { x: e.x + dx, y: e.y + dy });
      }
      const tableIds = new Set(items.tables);
      const tables = new Map<string, { x: number; y: number }>();
      for (const t of this.store.tables()) {
         if (tableIds.has(t.id)) tables.set(t.id, { x: t.x + dx, y: t.y + dy });
      }
      const waypoints = new Map<string, { x: number; y: number }[]>();
      const locs = this.canvasView.columnLocations();
      for (const rel of this.store.relationships()) {
         if (!rel.waypoints?.length) {
            continue;
         }
         const st = locs.get(rel.sourceColumnId)?.table.id;
         const tt = locs.get(rel.targetColumnId)?.table.id;
         if (st && tt && tableIds.has(st) && tableIds.has(tt)) {
            waypoints.set(
               rel.id,
               rel.waypoints.map((w) => ({ x: w.x + dx, y: w.y + dy }))
            );
         }
      }
      this.store.moveItemsLocal({ elements, tables, waypoints });
      const diagramIds = new Set(items.diagrams);
      for (const d of this.store.sequenceDiagrams()) {
         if (!diagramIds.has(d.id)) {
            continue;
         }
         // Move the whole diagram locally in one step (originY included) before saving:
         // originY only lands after the server answers, so shifting lifelines/messages
         // and originY separately let a second shift read a stale originY and tear the
         // header away from its messages.
         const start = this.canvasView.sequenceStart(d.id);
         if (!start) {
            continue;
         }
         this.store.shiftSequence(d.id, start.xs, dx, start.originY, dy, start.rows);
         for (const l of this.store.lifelines()) {
            if (l.diagramId === d.id) {
               this.store.moveLifeline(l.id, l.x);
            }
         }
         for (const msg of this.store.sequenceMessages()) {
            if (msg.diagramId === d.id) {
               this.store.moveMessage(msg.id, msg.y);
            }
         }
         void this.store.updateSequenceConfig(d.id, { originY: start.originY + dy });
      }
   }

   /**
    * Slides used to sit side by side on the canvas. They are now stacked in one spot
    * and own their contents by id, so a slide that owns nothing yet claims what lies
    * inside its frame and moves (with it) onto the first slide's spot. Runs once per
    * such slide; an empty or already-owning slide is left alone.
    */
   async stackLegacySlides(): Promise<void> {
      if (this.migratingSlides || !this.store.canEdit() || !this.store.projectId()) {
         return;
      }
      const frames = this.store.slideFrames();
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
      const elements = this.store.elements();
      // A frame is never the content of a slide; undo an earlier mistaken claim.
      const claimedFrames = elements.filter((e) => e.type === 'frame' && e.slideId);
      const tables = this.store.tables();
      const diagrams = this.store.sequenceDiagrams();
      const owns = (id: string): boolean =>
         elements.some((e) => e.slideId === id) ||
         tables.some((t) => t.slideId === id) ||
         diagrams.some((d) => d.slideId === id);
      // A slide that already owns content but sits away from its presentation's spot (a
      // file or tool laid the slides out side by side) moves back, taking its contents.
      // Checked once per loaded project only: this runs on every edit, and mid-drag the
      // dragged slide is briefly away from the others until syncSlideMoves catches them
      // up; snapping it back then fought the drag and double-shifted slide contents.
      const checkMisplaced = this.misplacedCheckedFor !== this.store.projectId();
      this.misplacedCheckedFor = this.store.projectId();
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
               this.store.lifelines(),
               this.store.sequenceMessages(),
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
      this.migratingSlides = true;
      try {
         await this.store.batchHistory(async () => {
            for (const f of misplaced) {
               const anchor = anchors.get(presentationOf(f))!;
               this.shiftSlide(f.id, anchor.x - f.x, anchor.y - f.y);
            }
            for (const fr of claimedFrames) {
               await this.store.updateElement(fr.id, { slideId: null });
            }
            for (const { f, geo, dx, dy } of work) {
               const moved = dx !== 0 || dy !== 0;
               if (moved) {
                  await this.store.updateElement(f.id, { x: f.x + dx, y: f.y + dy });
               }
               for (const id of geo.elementIds) {
                  const e = this.store.elements().find((x) => x.id === id);
                  if (e) {
                     await this.store.updateElement(id, {
                        slideId: f.id,
                        ...(moved ? { x: e.x + dx, y: e.y + dy } : {}),
                     });
                  }
               }
               for (const id of geo.tableIds) {
                  const t = this.store.tables().find((x) => x.id === id);
                  if (t) {
                     await this.store.updateTable(id, { slideId: f.id });
                     if (moved) {
                        this.store.moveTable(id, t.x + dx, t.y + dy);
                     }
                  }
               }
               for (const id of geo.diagramIds) {
                  const start = this.canvasView.sequenceStart(id);
                  await this.store.updateSequenceConfig(id, { slideId: f.id });
                  if (start && moved) {
                     this.store.shiftSequence(id, start.xs, dx, start.originY, dy, start.rows);
                     await this.store.updateSequenceConfig(id, { originY: start.originY + dy });
                     for (const [lifelineId, x] of start.xs) {
                        this.store.moveLifeline(lifelineId, x + dx);
                     }
                  }
               }
               if (moved) {
                  for (const rel of this.store.relationships()) {
                     if (rel.waypoints?.length) {
                        const locs = this.canvasView.columnLocations();
                        const st = locs.get(rel.sourceColumnId)?.table.id;
                        const tt = locs.get(rel.targetColumnId)?.table.id;
                        if (st && tt && geo.tableIds.has(st) && geo.tableIds.has(tt)) {
                           this.store.setWaypoints(
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
         this.migratingSlides = false;
         this.slideBounds = new Map(
            this.store.slideFrames().map((f) => [f.id, { x: f.x, y: f.y, w: f.width, h: f.height }])
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
      const projectId = this.store.projectId();
      if (this.migratingSlides || !this.store.canEdit() || !projectId) {
         return;
      }
      const frames = this.store.slideFrames();
      if (!frames.length || this.separatedFor === projectId) {
         return;
      }
      this.separatedFor = projectId;
      const placed: Array<{ x: number; y: number }> = [];
      for (const name of this.store.presentations()) {
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
            this.shiftSlide(f.id, 0, dy);
            this.slideBounds.set(f.id, { x: f.x, y: f.y + dy, w: f.width, h: f.height });
         }
      }
   }

   /** The first free "Presentation N" name. */
   newPresentationName(): string {
      const taken = new Set(this.store.presentations());
      let n = 1;
      while (taken.has(`Presentation ${n}`)) {
         n += 1;
      }
      return `Presentation ${n}`;
   }

   /**
    * Add a slide. With `at` (the Slide tool) it starts a whole new presentation there:
    * a first 16:9 slide with its own list and settings panels. Without it, the new slide
    * joins the selected presentation, stacked on the one it shows.
    */
   async addSlide(at?: { x: number; y: number }, layout = false, layoutId?: string | null): Promise<string | null> {
      if (!this.store.canEdit()) {
         return null;
      }
      const preset = framePreset('16-9');
      const newPresentation = at ? this.newPresentationName() : undefined;
      const slides = newPresentation
         ? []
         : layout
           ? this.store.presentationLayoutFrames()
           : this.store.presentationFrames();
      const presentation = newPresentation ?? this.store.presentation() ?? undefined;
      const shown = newPresentation
         ? undefined
         : this.store.slideFrames().find((f) => f.id === this.store.activeSlideId());
      let x: number;
      let y: number;
      if (shown) {
         // Slides are stacked: a new one takes the shown slide's place (and size).
         x = shown.x;
         y = shown.y;
      } else {
         const rect = this.viewport.canvasRect();
         const c = at ?? this.viewport.toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
         x = Math.round(c.x - preset.width / 2);
         y = Math.round(c.y - preset.height / 2);
      }
      // Insert right after the selected slide of this presentation; append when none is.
      // While a layout is shown, the new slide goes after the slide you were on before it.
      const afterId =
         shown?.slide?.layout && !layout && presentation
            ? this.slideshow.lastSlides().get(presentation)
            : this.store.activeSlideId();
      const after = newPresentation ? undefined : slides.find((f) => f.id === afterId);
      let order = slides.reduce((m, f) => Math.max(m, f.slide?.order ?? 0), -1) + 1;
      let shifted: CanvasElementModel[] = [];
      if (after) {
         const afterOrder = after.slide?.order ?? 0;
         order = afterOrder + 1;
         shifted = slides.filter((f) => f.id !== after.id && (f.slide?.order ?? 0) > afterOrder);
      }
      for (const f of shifted) {
         if (f.slide) {
            await this.store.updateElement(f.id, { slide: { ...f.slide, order: f.slide.order + 1 } });
         }
      }
      // Plain "New" (no layout picked) is always a blank slide: the deck's Blank layout.
      if (!layout && layoutId === undefined && presentation) {
         layoutId =
            presentationLayouts(this.store.slideFrames(), presentation).find((l) => l.slide?.defaultLayout)?.id ?? null;
      }
      const created = await this.store.addElement({
         type: 'frame',
         x,
         y,
         width: shown?.width ?? preset.width,
         height: shown?.height ?? preset.height,
         angle: 0,
         strokeColor: this.canvasView.themeVar('--dd-text-muted') ?? DEFAULT_ELEMENT_STROKE,
         // Slides and layouts show the master's background unless given their own.
         fillStyle: 'none' as const,
         strokeWidth: 1.5,
         strokeStyle: 'solid',
         opacity: 100,
         cornerRadius: 0,
         slide: {
            order,
            ...(presentation ? { presentation } : {}),
            // New slides morph in by default (layouts don't transition).
            ...(layout ? {} : { transition: { ...DEFAULT_SLIDE_TRANSITION, type: 'morph' as const } }),
            // A layout; or a slide using the layout shown (or the shown slide's layout).
            ...(layout
               ? { layout: true, layoutName: `Layout ${slides.filter((f) => !f.slide?.defaultLayout).length + 1}` }
               : layoutId !== undefined
                 ? layoutId
                    ? { layoutId }
                    : {}
                 : shown?.slide?.layout && !shown.slide.master
                   ? { layoutId: shown.id }
                   : shown?.slide?.layoutId
                     ? { layoutId: shown.slide.layoutId }
                     : {}),
         },
      });
      if (created) {
         // A slide on a layout starts with empty copies of its placeholders.
         const layout = layoutOf(created, this.store.slideFrames());
         if (layout) await fillFromLayout(this.store, created, layout);
         this.slideshow.focusFrame(created.id);
      }
      return created?.id ?? null;
   }

   /**
    * Turn a plain frame into a slide: a new slide is added to `deck` (after its shown
    * slide), or a new presentation is started at the frame when `deck` is null; the
    * frame's contents move onto it (centred) and the emptied frame is removed. One undo step.
    */
   async addFrameToPresentation(frameId: string, deck: string | null): Promise<void> {
      const frame = this.store.elements().find((e) => e.id === frameId && e.type === 'frame' && !e.slide);
      if (!frame || !this.store.canEdit()) return;
      const fb: Box = { x0: frame.x, y0: frame.y, x1: frame.x + frame.width, y1: frame.y + frame.height };
      const inside = (b: Box): boolean =>
         b.x0 >= fb.x0 - 1 && b.y0 >= fb.y0 - 1 && b.x1 <= fb.x1 + 1 && b.y1 <= fb.y1 + 1;
      const items = {
         elements: this.store
            .elements()
            .filter((e) => e.id !== frame.id && e.type !== 'frame' && !e.slideId && inside(elementBox(e)))
            .map((e) => e.id),
         tables: this.store
            .tables()
            .filter((t) => !t.slideId && inside(tableBox(t)))
            .map((t) => t.id),
         diagrams: this.store
            .sequenceDiagrams()
            .filter((d) => {
               const b = !d.slideId && this.canvasView.diagramBox(d);
               return !!b && inside({ x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY });
            })
            .map((d) => d.id),
      };
      await this.store.batchHistory(async () => {
         let slideId: string | null;
         if (deck) {
            this.store.selectPresentation(deck);
            slideId = await this.addSlide();
         } else {
            // A new presentation, placed clear of the frame so the two never overlap.
            slideId = await this.addSlide({
               x: frame.x + frame.width / 2 + this.freeFrameOffset(frame),
               y: frame.y + frame.height / 2,
            });
         }
         const slide = slideId ? this.store.elements().find((e) => e.id === slideId) : null;
         if (!slide) return;
         const dx = slide.x + (slide.width - frame.width) / 2 - frame.x;
         const dy = slide.y + (slide.height - frame.height) / 2 - frame.y;
         this.shiftItems(items, dx, dy);
         await this.store.assignSlide(items, slide.id);
         await this.store.deleteElement(frame.id);
      });
   }

   /**
    * Horizontal offset that puts a copy of `frame` on free canvas: `step` page
    * widths to the right, pushed further right while it would land on another frame.
    */
   freeFrameOffset(frame: CanvasElementModel, step = 1): number {
      const frames = this.store.elements().filter((e) => e.type === 'frame');
      let dx = (frame.width + 160) * step;
      for (let i = 0; i < 40; i += 1) {
         const clash = frames.some(
            (f) =>
               f.id !== frame.id &&
               frame.x + dx < f.x + f.width &&
               frame.x + dx + frame.width > f.x &&
               frame.y < f.y + f.height &&
               frame.y + frame.height > f.y
         );
         if (!clash) {
            break;
         }
         dx += frame.width + 160;
      }
      return dx;
   }

   /**
    * Clone tables (plus the relationships between them), sequence diagrams and
    * elements by (dx, dy). Callers wrap this in `batchHistory` for one undo step.
    */
   async cloneItems(
      tableIds: ReadonlySet<string>,
      diagramIds: ReadonlySet<string>,
      elements: readonly CanvasElementModel[],
      dx: number,
      dy: number
   ): Promise<{ copies: Map<string, CanvasElementModel>; tableIds: string[]; diagramIds: string[] }> {
      const cloned = this.store.cloneItems(tableIds, diagramIds, elements, dx, dy);
      return {
         copies: cloned.copies,
         tableIds: [...cloned.tables.values()],
         diagramIds: [...cloned.diagrams.values()],
      };
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
         .map((c) => this.store.elements().find((e) => e.id === c.id))
         .filter((c): c is CanvasElementModel => !!c?.slide && !!c.slide.layout === layouts && !c.slide.master)
         .sort((a, b) => (a.slide!.order ?? 0) - (b.slide!.order ?? 0));
      if (!fresh.length) return;
      const list = (
         layouts
            ? presentationLayouts(this.store.slideFrames(), deck)
            : presentationSlides(this.store.slideFrames(), deck)
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
            await this.store.updateElement(c.id, { slide: { ...c.slide!, order } });
         }
      }
   }

   /**
    * Duplicate slides with everything on them. The copies land right after the last
    * source in the sequence, or at `toIndex` when given (Alt-drag in the panel).
    */
   async duplicateSlides(ids: readonly string[], toIndex?: number): Promise<void> {
      const frames = ids
         .map((id) => this.store.elements().find((e) => e.id === id))
         .filter((f): f is CanvasElementModel => !!f);
      if (!frames.length || !this.store.canEdit()) {
         return;
      }
      const idSet = new Set(frames.map((f) => f.id));
      // Slides are stacked in one spot, so a copy sits exactly on its source.
      const inner = frameContents(
         idSet,
         this.store.elements(),
         this.store.tables(),
         this.store.sequenceDiagrams(),
         this.store.lifelines(),
         this.store.sequenceMessages(),
         this.store.shownSlideIds()
      );
      const newIds: string[] = [];
      await this.store.batchHistory(async () => {
         const sources = this.store.elements().filter((e) => idSet.has(e.id) || inner.elementIds.has(e.id));
         const cloned = await this.cloneItems(inner.tableIds, inner.diagramIds, sources, 0, 0);
         for (const f of frames) {
            const c = cloned.copies.get(f.id);
            if (c) newIds.push(c.id);
         }
         const copies = newIds
            .map((id) => this.store.elements().find((e) => e.id === id))
            .filter((c): c is CanvasElementModel => !!c);
         // Slide copies go after the last copied slide of their deck (or into the drop slot).
         const decks = new Set(copies.filter((c) => c.slide && !c.slide.layout).map((c) => presentationOf(c)));
         for (const deck of decks) {
            const mine = copies.filter((c) => presentationOf(c) === deck);
            const deckSlides = presentationSlides(this.store.slideFrames(), deck);
            const last = [...deckSlides].reverse().find((f) => idSet.has(f.id));
            await this.orderSlideCopies(mine, deck, last?.id ?? null, toIndex);
         }
         // Layout copies go right after their source (or into the drop slot).
         const layoutDecks = new Set(
            copies.filter((c) => c.slide?.layout && !c.slide.master).map((c) => presentationOf(c))
         );
         for (const deck of layoutDecks) {
            const mine = copies.filter((c) => presentationOf(c) === deck && c.slide?.layout);
            const last = [...presentationLayouts(this.store.slideFrames(), deck)]
               .reverse()
               .find((f) => idSet.has(f.id));
            await this.orderSlideCopies(mine, deck, last?.id ?? null, toIndex, true);
         }
         // A copied layout gets its own name ("Title copy").
         for (const f of frames) {
            const id = cloned.copies.get(f.id)?.id;
            const copy = id ? this.store.elements().find((e) => e.id === id) : undefined;
            if (copy?.slide?.layout) {
               const all = this.store.slideFrames();
               const names = presentationLayouts(all, presentationOf(copy))
                  .filter((l) => l.id !== copy.id)
                  .map((l) => layoutNameOf(l, all));
               const name = nextCopyName(layoutNameOf(f, all), names);
               await this.store.updateElement(copy.id, {
                  slide: { ...copy.slide, layoutName: name, defaultLayout: undefined, master: undefined },
               });
            }
         }
      });
      if (newIds.length) {
         this.slideshow.focusFrame(newIds[newIds.length - 1]);
         if (newIds.length > 1) this.store.setSelection([], [], newIds);
      }
   }

   /** Merge a project file into this project, landing in the visible part of the canvas (or at `at`). */
   async importProjectFile(file: unknown, at?: { x: number; y: number }): Promise<number> {
      const rect = this.viewport.canvasRect();
      const v = this.store.viewport();
      // Top-left of the content goes a little in from the canvas's top-left corner.
      const anchor = at ?? {
         x: Math.round((rect.width * 0.1 - v.x) / v.zoom),
         y: Math.round((rect.height * 0.15 - v.y) / v.zoom),
      };
      const before = new Set(this.store.slideFrames().map((f) => f.id));
      // Keep the slide migrations from treating the new slides as legacy ones (and
      // claiming whatever canvas content they landed on) until they are in place.
      this.migratingSlides = true;
      try {
         // An import is a clone: the server gives its slides their own presentation.
         const count = await this.store.importFile(file, anchor);
         // Only the shown slide of a stack is drawn: show the first imported slide.
         const added = this.store
            .slideFrames()
            .filter((f) => !before.has(f.id))
            .sort((a, b) => (a.slide?.order ?? 0) - (b.slide?.order ?? 0))[0];
         if (added) {
            this.slideshow.focusFrame(added.id);
            this.viewport.panToWorld({ x: added.x + added.width / 2, y: added.y + added.height / 2 });
         }
         return count;
      } finally {
         this.migratingSlides = false;
         this.slideBounds = new Map(
            this.store.slideFrames().map((f) => [f.id, { x: f.x, y: f.y, w: f.width, h: f.height }])
         );
      }
   }
}
