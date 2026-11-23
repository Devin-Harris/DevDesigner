import {
   ChangeDetectionStrategy,
   Component,
   DestroyRef,
   ElementRef,
   afterNextRender,
   computed,
   effect,
   inject,
   input,
   output,
   signal,
   untracked,
   viewChild,
} from '@angular/core';
import { transitionMorphs } from '@devdesigner/shared';
import { RealtimeService } from '../../../../../../core/realtime/realtime.service';
import { notifySignal } from '../../../../../../shared/helpers/signals';
import { slideAtStep, type RenderedSlide, type SlideMedia } from '../../services/slide-render.service';
import { SlideMediaLayerComponent } from './components/slide-media-layer/slide-media-layer.component';
import { SlideScrollLayerComponent } from './components/slide-scroll-layer/slide-scroll-layer.component';
import { playSlideStep } from './helpers/step-player';
import { TransitionRunner, transitionAnimates, transitionSetup } from './helpers/transition-runner';
import { LaserOverlayComponent } from './components/laser-overlay/laser-overlay.component';
import { PresenterControlsComponent } from './components/presenter-controls/presenter-controls.component';
import { StopClicksDirective } from '../../../../../../shared/ui/directives/stop-clicks.directive';
import { CallPipe } from '../../../../../../shared/ui/pipes/collection.pipes';

/**
 * Full-screen slide presenter. Each slide is a pre-rendered SVG (the same image
 * the PDF/PNG export produces), so what is shown always matches the canvas.
 * Transitions are played on temporary layers and never touch project data.
 *
 * Keys: → ↓ Space Enter PageDown next · ← ↑ Backspace PageUp previous ·
 * Home/End first/last · N notes · Esc exit. Click advances.
 */
@Component({
   selector: 'dd-present-mode',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [CallPipe, StopClicksDirective, LaserOverlayComponent, PresenterControlsComponent, SlideMediaLayerComponent, SlideScrollLayerComponent],
   templateUrl: './present-mode.component.html',
   styleUrl: './present-mode.component.scss',
   host: {
      '(document:keydown)': 'onKey($event)',
      '(document:fullscreenchange)': 'onFullscreenChange()',
      '(window:resize)': 'resized$.notify()',
   },
})
export class PresentModeComponent {
   readonly slides$ = input.required<readonly RenderedSlide[]>({ alias: 'slides' });
   readonly startIndex = input<number>(0);
   /** Preview: play one transition into the second slide, then close by itself. */
   readonly autoplay = input<boolean>(false);
   /** Follow another participant's presentation (their participant id). */
   readonly follow = input<string | null>(null);
   /** Emits the id of the slide that was showing when the presenter closed. */
   readonly closed = output<string | null>();

   private readonly destroyRef = inject(DestroyRef);
   private readonly realtime = inject(RealtimeService);
   private readonly rootRef = viewChild.required<ElementRef<HTMLElement>>('root');
   private readonly overlayRef = viewChild.required<ElementRef<HTMLElement>>('overlay');
   private readonly controls = viewChild(PresenterControlsComponent);

   protected readonly index$ = signal(0);
   /** Build step shown on the current slide (0 = nothing revealed yet). */
   protected readonly step$ = signal(0);
   protected readonly showNotes$ = signal(false);
   /** Overview of every slide (G); click one to jump there. */
   protected readonly showGrid$ = signal(false);
   /** One picture per slide for the overview: the slide with everything shown. */
   protected readonly gridThumbs$ = computed(() => this.urlList$().map((per) => per[per.length - 1]));
   protected readonly barVisible$ = signal(false);
   /** Cursor shows on any mouse movement and hides after a stretch of stillness. */
   protected readonly cursorVisible$ = signal(true);
   private cursorTimer: ReturnType<typeof setTimeout> | null = null;
   protected readonly laserOn$ = signal(false);
   protected readonly resized$ = notifySignal();
   private readonly seconds = signal(0);

   /** Object URLs per slide per build step (one entry for slides without steps), revoked on destroy. */
   protected readonly urlList$ = computed(() =>
      this.slides$().map((s) =>
         (s.maxStep > 0 ? s.stepSvgs : [s.svg]).map((svg) =>
            URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
         )
      )
   );
   /** `slide:picture` of the picture on screen (the current slide at its build step). */
   protected readonly shownKey$ = computed(() => {
      const i = this.index$();
      const per = this.urlList$()[i] ?? [];
      return `${i}:${Math.min(this.step$(), per.length - 1)}`;
   });
   /** The first slide's resting step (1 when its first animation group plays by itself). */
   protected readonly firstStepOfFirst$ = computed(() => (this.slides$()[0]?.plan.groups[0]?.auto ? 1 : 0));

   protected isShown(slideIndex: number, k: number): boolean {
      if (this.index$() !== slideIndex) {
         return false;
      }
      const per = this.urlList$()[slideIndex] ?? [];
      return Math.min(this.step$(), per.length - 1) === k;
   }
   /** The current slide's GIFs/videos and what its animation step hides (none while busy). */
   protected readonly liveMedia$ = computed(() => {
      const slide = this.slides$()[this.index$()];
      if (!slide?.media?.length || this.busy$()) {
         return null;
      }
      const hidden = slide.maxStep > 0 ? (slide.hiddenByStep[Math.min(this.step$(), slide.maxStep)] ?? null) : null;
      return { slide, hidden };
   });
   /** The current slide's scrollable frames and what its animation step hides (none while busy). */
   protected readonly liveScrolls$ = computed(() => {
      const slide = this.slides$()[this.index$()];
      if (!slide?.scrolls?.length || this.busy$()) {
         return null;
      }
      const hidden = slide.maxStep > 0 ? (slide.hiddenByStep[Math.min(this.step$(), slide.maxStep)] ?? null) : null;
      return { slide, hidden };
   });
   private readonly embedCache = new WeakMap<RenderedSlide, readonly SlideMedia[]>();
   /** A slide's live frames (kept mounted across slides). Cached so the array stays stable. */
   protected readonly embedsOf = (slide: RenderedSlide): readonly SlideMedia[] => {
      let v = this.embedCache.get(slide);
      if (!v) this.embedCache.set(slide, (v = (slide.media ?? []).filter((m) => m.kind === 'embed')));
      return v;
   };
   private readonly otherCache = new WeakMap<RenderedSlide, readonly SlideMedia[]>();
   /** A slide's GIFs and videos (live frames have their own persistent layer). */
   protected readonly otherMedia = (slide: RenderedSlide): readonly SlideMedia[] => {
      let v = this.otherCache.get(slide);
      if (!v) this.otherCache.set(slide, (v = (slide.media ?? []).filter((m) => m.kind !== 'embed')));
      return v;
   };
   protected readonly current$ = computed(() => this.slides$()[this.index$()] ?? { name: '', notes: '', maxStep: 0 });
   /** Steps of the current slide that wait for a click (a leading automatic group is not one). */
   protected readonly clicks$ = computed(() => {
      const i = this.index$();
      return Math.max(0, this.maxStepOf(i) - this.firstStep(i));
   });
   protected readonly clickStep$ = computed(() => Math.max(0, this.step$() - this.firstStep(this.index$())));
   protected readonly following$ = computed(() => {
      const id = this.follow();
      return id ? (this.realtime.participants$().find((p) => p.id === id)?.name ?? 'presenter') : null;
   });
   protected readonly clock$ = computed(() => {
      const s = this.seconds();
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
   });

   /** Plays transitions on the overlay layers. */
   private readonly runner = new TransitionRunner(() => this.overlayRef().nativeElement);
   protected readonly busy$ = this.runner.busy;
   private idleTimer: ReturnType<typeof setTimeout> | null = null;
   private fullscreen = false;
   private closing = false;

   constructor() {
      afterNextRender(() => {
         const root = this.rootRef().nativeElement;
         this.index$.set(Math.min(Math.max(0, this.startIndex()), this.slides$().length - 1));
         root.focus();
         if (!this.autoplay()) {
            void root
               .requestFullscreen?.()
               .then(() => {
                  this.fullscreen = true;
               })
               .catch(() => undefined);
         }
         if (!this.follow()) {
            void this.playAutomatic();
         }
         if (this.autoplay()) {
            setTimeout(() => {
               void this.go(this.index$() + 1, 0).then(() => setTimeout(() => this.exit(), 900));
            }, 600);
         }
      });

      // Tell the room where we are (so others can follow), unless we are following or previewing.
      effect(() => {
         const i = this.index$();
         const s = this.step$();
         if (this.follow() || this.autoplay()) {
            return;
         }
         const frame = untracked(() => this.slides$()[i]);
         if (frame) {
            this.realtime.sendPresenting(frame.id, s);
         }
      });

      // Following: mirror the presenter's slide and build step; leave when they stop.
      effect(() => {
         const id = this.follow();
         if (!id) {
            return;
         }
         const p = this.realtime.participants$().find((x) => x.id === id);
         untracked(() => {
            if (!p?.presenting) {
               this.exit();
               return;
            }
            const i = this.slides$().findIndex((s) => s.id === p.presenting?.frameId);
            if (i >= 0) {
               void this.goTo(i, p.presenting.step);
            }
         });
      });

      const tick = setInterval(() => this.seconds.update((s) => s + 1), 1000);
      this.destroyRef.onDestroy(() => {
         clearInterval(tick);
         if (this.idleTimer) {
            clearTimeout(this.idleTimer);
         }
         if (this.cursorTimer) {
            clearTimeout(this.cursorTimer);
         }
         this.runner.cancel();
         if (!this.follow() && !this.autoplay()) {
            this.realtime.sendPresenting(null);
         }
         for (const per of this.urlList$()) {
            for (const u of per) {
               URL.revokeObjectURL(u);
            }
         }
         if (document.fullscreenElement) {
            void document.exitFullscreen().catch(() => undefined);
         }
      });
   }

   private urlFor(slideIndex: number, step: number): string {
      const per = this.urlList$()[slideIndex] ?? [];
      return per[Math.min(step, per.length - 1)] ?? '';
   }

   private maxStepOf(slideIndex: number): number {
      return this.slides$()[slideIndex]?.maxStep ?? 0;
   }

   /**
    * The lowest step a slide rests on: 1 when its first animation group plays by itself
    * (so stepping back never lands on the not-yet-played state), else 0.
    */
   protected firstStep(slideIndex: number): number {
      return this.slides$()[slideIndex]?.plan.groups[0]?.auto ? 1 : 0;
   }

   // ---- navigation ----

   protected next(): void {
      if (this.follow() || this.laserOn$()) {
         return;
      }
      void this.forward();
   }

   protected prev(): void {
      if (this.follow()) {
         return;
      }
      void this.backward();
   }

   private async forward(): Promise<void> {
      this.runner.cancel();
      const i = this.index$();
      if (this.step$() < this.maxStepOf(i)) {
         await this.goStep(this.step$() + 1);
      } else {
         await this.go(i + 1, 0);
      }
   }

   private async backward(): Promise<void> {
      this.runner.cancel();
      const i = this.index$();
      if (this.step$() > this.firstStep(i)) {
         await this.goStep(this.step$() - 1);
      } else {
         await this.go(i - 1, this.maxStepOf(i - 1));
      }
   }

   protected toggleGrid(): void {
      if (this.follow()) return;
      this.showGrid$.update((v) => !v);
   }

   /** Jump straight to a slide from the overview, at its first step. */
   protected jumpTo(i: number): void {
      this.showGrid$.set(false);
      if (this.follow() || i === this.index$()) return;
      this.runner.cancel();
      void this.go(i, this.firstStep(i), true);
   }

   protected toggleNotes(): void {
      this.showNotes$.update((v) => !v);
   }

   protected toggleLaser(): void {
      this.laserOn$.update((v) => !v);
   }

   protected exit(): void {
      if (this.closing) {
         return;
      }
      this.closing = true;
      this.closed.emit(this.slides$()[this.index$()]?.id ?? null);
   }

   /** Show the cursor and restart its stillness countdown (PowerPoint-style). */
   private wakeCursor(): void {
      this.cursorVisible$.set(true);
      if (this.cursorTimer) {
         clearTimeout(this.cursorTimer);
      }
      this.cursorTimer = setTimeout(() => {
         this.cursorTimer = null;
         // Keep the cursor while it rests on the visible bar or a drag is underway.
         if (!this.barVisible$() && !this.controls()?.dragging$()) {
            this.cursorVisible$.set(false);
         }
      }, 2600);
   }

   /** The cursor reveals on any movement; the control bar only while the pointer
    *  is over it (or dragging it), hiding shortly after the pointer leaves. */
   protected onPresentMove(event: PointerEvent): void {
      this.wakeCursor();
      const host = event.currentTarget as HTMLElement;
      const bar = host.querySelector('.bar');
      const r = bar?.getBoundingClientRect();
      const pad = 12;
      const overBar =
         !!this.controls()?.dragging$() ||
         (!!r &&
            event.clientX >= r.left - pad &&
            event.clientX <= r.right + pad &&
            event.clientY >= r.top - pad &&
            event.clientY <= r.bottom + pad);
      if (overBar) {
         if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
         }
         this.barVisible$.set(true);
      } else if (this.barVisible$() && !this.idleTimer) {
         this.idleTimer = setTimeout(() => {
            this.idleTimer = null;
            this.barVisible$.set(false);
         }, 400);
      }
   }

   protected onFullscreenChange(): void {
      // Leaving fullscreen with Esc (the browser eats the key) ends the show.
      if (this.fullscreen && !document.fullscreenElement) {
         this.exit();
      }
   }

   protected onKey(event: KeyboardEvent): void {
      if (event.ctrlKey || event.metaKey || event.altKey) {
         return;
      }
      // Keys never reveal the control bar (only the mouse does), so stepping through
      // slides keeps the picture clear.
      const handled = (): void => {
         event.preventDefault();
         event.stopPropagation();
      };
      switch (event.key) {
         case 'ArrowRight':
         case 'ArrowDown':
         case 'PageDown':
         case ' ':
         case 'Enter':
            handled();
            if (!this.follow()) {
               void this.forward();
            }
            break;
         case 'ArrowLeft':
         case 'ArrowUp':
         case 'PageUp':
         case 'Backspace':
            handled();
            this.prev();
            break;
         case 'Home':
            handled();
            if (!this.follow()) {
               this.runner.cancel();
               void this.go(0, 0, true);
            }
            break;
         case 'End':
            handled();
            if (!this.follow()) {
               this.runner.cancel();
               const last = this.slides$().length - 1;
               void this.go(last, this.maxStepOf(last), true);
            }
            break;
         case 'n':
         case 'N':
            handled();
            this.toggleNotes();
            break;
         case 'k':
         case 'K':
            handled();
            this.toggleLaser();
            if (!this.laserOn$() && !this.barVisible$() && !this.controls()?.dragging$()) {
               // Turning the laser off from the keyboard drops the cursor with it.
               if (this.cursorTimer) {
                  clearTimeout(this.cursorTimer);
                  this.cursorTimer = null;
               }
               this.cursorVisible$.set(false);
            }
            break;
         case 'g':
         case 'G':
            handled();
            this.toggleGrid();
            break;
         case 'Escape':
            handled();
            if (this.showGrid$()) {
               this.showGrid$.set(false);
               break;
            }
            this.exit();
            break;
         default:
            // Swallow everything else so editor shortcuts can't fire behind the show.
            event.stopPropagation();
      }
   }

   // ---- transitions ----

   /** Go to a specific slide + step (used when following a presenter). */
   private async goTo(index: number, step: number): Promise<void> {
      this.runner.cancel();
      if (index === this.index$()) {
         if (step !== this.step$()) {
            await this.goStep(step);
         }
         return;
      }
      await this.go(index, step);
   }

   /**
    * Move within the current slide's animations. One step forward plays that group's
    * animations on the objects; one back undoes it quickly; a longer jump cross-fades.
    */
   private async goStep(target: number): Promise<void> {
      const i = this.index$();
      const from = this.step$();
      const slide = this.slides$()[i];
      if (!slide || target === from) {
         return;
      }
      await playSlideStep(this.runner, slide, from, target, (k) => this.urlFor(i, k), () => this.step$.set(target));
   }

   /**
    * Move to slide `target` showing build step `toStep`. Going forward plays the
    * target's own transition; going back plays the slide being left, reversed.
    * `instant` skips animation.
    */
   private async go(target: number, toStep: number, instant = false): Promise<void> {
      await this.goSlide(target, toStep, instant);
      // A first animation group that needs no click plays as soon as its slide is up.
      if (toStep === 0 && this.index$() === target) {
         await this.playAutomatic();
      }
   }

   /** Play the current slide's leading click-less animations, if it has them and they have not played. */
   private async playAutomatic(): Promise<void> {
      if (this.step$() === 0 && this.firstStep(this.index$()) === 1) {
         await this.goStep(1);
      }
   }

   private async goSlide(target: number, toStep: number, instant = false): Promise<void> {
      const slides = this.slides$();
      const from = this.index$();
      if (target < 0 || target >= slides.length || target === from) {
         return;
      }
      const forward = target > from;
      const t = (forward ? slides[target] : slides[from]).transition;
      const adjacent = Math.abs(target - from) === 1;
      const commit = (): void => {
         this.index$.set(target);
         this.step$.set(toStep);
      };
      if (instant || !adjacent || !transitionAnimates(t)) {
         commit();
         return;
      }
      // Morph only between slides of the same size; otherwise it would have to stretch one.
      const sameSize =
         Math.abs(slides[from].width - slides[target].width) < 1 &&
         Math.abs(slides[from].height - slides[target].height) < 1;
      // Objects on both slides morph whenever the transition says so; the rest of the
      // slide then moves the transition's own way (fade / slide / zoom / cut).
      const isMorph = transitionMorphs(t) && sameSize;
      const fromView = slideAtStep(slides[from], this.step$());
      const toView = slideAtStep(slides[target], toStep);
      await this.runner.run({
         fromUrl: this.urlFor(from, this.step$()),
         toUrl: this.urlFor(target, toStep),
         duration: t.duration,
         easing: t.easing,
         setup: transitionSetup(t, forward),
         commit,
         morph: isMorph ? { from: fromView, to: toView, reversed: !forward } : undefined,
      });
   }
}
