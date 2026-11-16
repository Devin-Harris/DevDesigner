import { EditorViewportService } from '../../../services/editor-viewport.service';
import { inject, signal, Injectable, linkedSignal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { presentationOf, presentationSlides } from '@devdesigner/shared';
import type { CanvasElementModel } from '@devdesigner/shared';
import { RealtimeService } from '../../../../../core/realtime/realtime.service';
import { TelemetryService } from '../../../../../core/telemetry/telemetry.service';
import { ProjectStore } from '../../../state/project/project.store';
import { SlideRenderService, type RenderedSlide } from './slide-render.service';
/**
 * Presenting (the presenter overlay, transition previews, following a presenter) and which
 * slide each deck shows.
 */
@Injectable()
export class SlideshowService {
   private readonly store = inject(ProjectStore);
   private readonly realtime = inject(RealtimeService);
   private readonly slideRender = inject(SlideRenderService);
   private readonly snackBar = inject(MatSnackBar);
   private readonly viewport = inject(EditorViewportService);
   private readonly telemetry = inject(TelemetryService);
   /** When the running (own, non-preview) presentation started, for `client.present` end. */
   private presentStartedAt: number | null = null;

   /** The running presentation (or a one-transition preview), or null when not presenting. */
   readonly presentation = signal<{
      slides: RenderedSlide[];
      start: number;
      preview: boolean;
      /** Participant id being followed, when watching someone else's presentation. */
      follow: string | null;
   } | null>(null);

   /** Other participants who are presenting right now (offer to follow them). */
   readonly presenters = this.realtime.presenters;

   /** Per presentation: the last slide (not a layout) shown, so editing a layout keeps your place. */
   /** The last ordinary (non-layout) slide each deck showed, kept while a layout is shown. */
   readonly lastSlides = linkedSignal<
      { shown: ReadonlyMap<string, string>; frames: readonly CanvasElementModel[] },
      ReadonlyMap<string, string>
   >({
      source: () => ({ shown: this.store.shownByPresentation(), frames: this.store.slideFrames() }),
      computation: ({ shown, frames }, previous) => {
         const prev = previous?.value ?? new Map<string, string>();
         const next = new Map(prev);
         let changed = false;
         for (const [name, id] of shown) {
            const f = frames.find((x) => x.id === id);
            if (f && !f.slide?.layout && next.get(name) !== id) {
               next.set(name, id);
               changed = true;
            }
         }
         return changed ? next : prev;
      },
   });

   lastSlideOf(name: string): string | null {
      return this.lastSlides().get(name) ?? null;
   }

   /** Watch another participant's presentation, staying on their slide and step. */
   async followPresenter(participantId: string): Promise<void> {
      const p = this.realtime.participants().find((x) => x.id === participantId);
      // Watch the presentation the presenter is in (the one their slide belongs to).
      const theirs = this.store.slideFrames().find((f) => f.id === p?.presenting?.frameId);
      const slides = (
         theirs ? presentationSlides(this.store.slideFrames(), presentationOf(theirs)) : this.store.presentationFrames()
      ).filter((f) => !f.slide?.hidden);
      if (!slides.length) {
         return;
      }
      const start = Math.max(
         0,
         slides.findIndex((f) => f.id === p?.presenting?.frameId)
      );
      const rendered = await this.slideRender.render(slides);
      this.presentation.set({ slides: rendered, start, preview: false, follow: participantId });
   }

   /**
    * Show a slide. Slides are stacked in one spot per presentation and only the shown
    * one is on the canvas, so switching just changes what is drawn there: the view never moves.
    */
   focusFrame(id: string): void {
      if (!this.store.elements().some((e) => e.id === id)) {
         return;
      }
      this.store.setActiveSlide(id);
      this.store.setSelection([], [], [id]);
   }

   /** Leave the presenter, selecting the slide it was on (not for one-transition previews). */
   onPresentationClosed(frameId: string | null): void {
      const shown = this.presentation();
      const preview = shown?.preview;
      this.presentation.set(null);
      if (this.presentStartedAt !== null) {
         this.telemetry.track('client.present', {
            action: 'end',
            slides: shown?.slides.length ?? 0,
            durationMs: Date.now() - this.presentStartedAt,
         });
         this.presentStartedAt = null;
      }
      if (!preview && frameId) {
         this.focusFrame(frameId);
         // Center it once fullscreen has been left, so the canvas has its real size again.
         const reveal = (): void => {
            const f = this.store.elements().find((e) => e.id === frameId);
            if (f) {
               this.viewport.panToWorld({ x: f.x + f.width / 2, y: f.y + f.height / 2 });
            }
         };
         if (document.fullscreenElement) {
            document.addEventListener('fullscreenchange', () => requestAnimationFrame(reveal), { once: true });
         } else {
            reveal();
         }
      }
   }

   /** The slide the view is on: the selected slide, else the one under the view center. */
   private currentSlideIndex(): number {
      const frames = this.store.presentationFrames();
      return Math.max(
         0,
         frames.findIndex((f) => f.id === this.store.activeSlideId())
      );
   }

   /**
    * The presentation the canvas selection belongs to: a selected slide frame, or an
    * item on a slide. Null when nothing of any presentation is selected.
    */
   selectedPresentationName(): string | null {
      const frames = this.store.slideFrames();
      const owner = (slideId: string | undefined): string | null => {
         const f = slideId ? frames.find((x) => x.id === slideId) : undefined;
         return f ? presentationOf(f) : null;
      };
      for (const id of this.store.selectedElementIds()) {
         const e = this.store.elements().find((x) => x.id === id);
         const name = e?.type === 'frame' && e.slide ? presentationOf(e) : owner(e?.slideId);
         if (name) {
            return name;
         }
      }
      for (const id of this.store.selectedTableIds()) {
         const name = owner(this.store.tables().find((t) => t.id === id)?.slideId);
         if (name) {
            return name;
         }
      }
      for (const id of this.store.selectedDiagramIds()) {
         const name = owner(this.store.sequenceDiagrams().find((d) => d.id === id)?.slideId);
         if (name) {
            return name;
         }
      }
      return null;
   }

   /** Render the sequence and open the full-screen presenter. */
   async startPresentation(from: 'start' | 'current'): Promise<void> {
      // Only the selected presentation plays (F5 from its start, Shift+F5 from the shown slide).
      const all = this.store.presentationFrames();
      const slides = all.filter((f) => !f.slide?.hidden);
      if (!slides.length) {
         this.snackBar.open('No slides yet. Open Slides and add a frame to the sequence.', undefined, {
            duration: 3000,
         });
         return;
      }
      let start = 0;
      if (from === 'current') {
         const here = all[this.currentSlideIndex()];
         start = Math.max(
            0,
            slides.findIndex((f) => f.id === here?.id)
         );
      }
      try {
         const rendered = await this.slideRender.render(slides);
         this.presentation.set({ slides: rendered, start, preview: false, follow: null });
         this.presentStartedAt = Date.now();
         this.telemetry.track('client.present', {
            action: 'start',
            slides: rendered.length,
            solo: this.realtime.participants().length <= 1,
         });
      } catch (err) {
         this.snackBar.open(
            `Could not start the presentation: ${err instanceof Error ? err.message : String(err)}`,
            undefined,
            { duration: 4000 }
         );
      }
   }

   /** Play the transition into a slide from the one before it, without presenting. */
   async previewTransition(id: string): Promise<void> {
      const frames = this.store.presentationFrames();
      const i = frames.findIndex((f) => f.id === id);
      if (i <= 0) {
         this.snackBar.open('The first slide has no transition into it.', undefined, {
            duration: 2500,
         });
         return;
      }
      const rendered = await this.slideRender.render([frames[i - 1], frames[i]]);
      this.presentation.set({ slides: rendered, start: 0, preview: true, follow: null });
   }
}
