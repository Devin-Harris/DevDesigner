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
import type { SlideEasing } from '@devdesigner/shared';
import { LOCAL_LASER, LaserService } from '../../../core/services/laser.service';
import { RealtimeService } from '../../../core/services/realtime.service';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { MorphStage } from './morph-stage';
import { parseSafeSvg } from '../export/svg-sanitize.helper';
import { slideAtStep, type RenderedSlide } from './slide-render.service';
import { SlideMediaLayerComponent } from '../media/slide-media-layer.component';
import { playGroup, undoGroup } from './step-animator';

/** CSS cubic-bezier control points per easing name. */
const BEZIER: Record<SlideEasing, [number, number, number, number] | null> = {
   linear: null,
   ease: [0.25, 0.1, 0.25, 1],
   'ease-in': [0.42, 0, 1, 1],
   'ease-out': [0, 0, 0.58, 1],
   'ease-in-out': [0.42, 0, 0.58, 1],
};

/** Map linear progress 0..1 through a named CSS easing curve. */
export function ease(name: SlideEasing, t: number): number {
   const p = BEZIER[name];
   if (!p || t <= 0 || t >= 1) {
      return Math.min(1, Math.max(0, t));
   }
   const [x1, y1, x2, y2] = p;
   const bx = (s: number): number => 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
   const by = (s: number): number => 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
   let lo = 0;
   let hi = 1;
   for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (bx(mid) < t) {
         lo = mid;
      } else {
         hi = mid;
      }
   }
   return by((lo + hi) / 2);
}

/** Unit vector (x, y) the slides travel along for a `slide` transition direction. */
/** A transition layer sized and clipped to a `width` x `height` slide, centred on screen. */
function framedLayer(width: number, height: number): HTMLElement {
   const el = document.createElement('div');
   el.className = 'layer framed';
   el.style.setProperty('--slide-ar', String(width / Math.max(1, height)));
   return el;
}

const TRAVEL: Record<string, [number, number]> = {
   left: [-1, 0],
   right: [1, 0],
   up: [0, -1],
   down: [0, 1],
};

/**
 * Full-screen slide presenter. Each slide is a pre-rendered SVG (the same image
 * the PDF/PNG export produces), so what is shown always matches the canvas.
 * Transitions are played on temporary layers and never touch project data.
 *
 * Keys: → ↓ Space Enter PageDown next · ← ↑ Backspace PageUp previous ·
 * Home/End first/last · N notes · Esc exit. Click advances.
 */
@Component({
   selector: 'app-present-mode',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [IconComponent, SlideMediaLayerComponent],
   template: `
      <div
         #root
         class="present"
         tabindex="-1"
         [class.idle]="!cursorVisible()"
         [class.bar-hidden]="!barVisible()"
         (click)="next()"
         (pointermove)="onPresentMove($event)"
      >
         <div #stage class="stage">
            <!-- Every slide image stays in the DOM (decoded), so switching is a visibility
             flip with no load or decode gap. -->
            @for (per of urlList(); track $index; let si = $index) {
               @for (u of per; track $index; let k = $index) {
                  <img class="slide" [class.hidden]="busy() || !isShown(si, k)" [src]="u" alt="" draggable="false" />
               }
            }
            <div #overlay class="overlay"></div>
            <!-- GIFs and videos play live over the settled slide (not during transitions). -->
            @if (liveMedia(); as lm) {
               <app-slide-media-layer
                  [media]="lm.slide.media"
                  [hidden]="lm.hidden"
                  [slideWidth]="lm.slide.width"
                  [slideHeight]="lm.slide.height"
               ></app-slide-media-layer>
            }
         </div>

         @if (lasers().length) {
            <svg class="laser-svg" aria-hidden="true">
               @for (l of lasers(); track l.id) {
                  @for (s of l.segments; track $index) {
                     <line
                        class="trail"
                        [attr.x1]="s.x1"
                        [attr.y1]="s.y1"
                        [attr.x2]="s.x2"
                        [attr.y2]="s.y2"
                        [attr.stroke-width]="s.width"
                        [attr.opacity]="s.opacity"
                     />
                  }
                  @if (l.head; as h) {
                     <circle class="glow" [attr.cx]="h.x" [attr.cy]="h.y" r="12" />
                     <circle class="dot" [attr.cx]="h.x" [attr.cy]="h.y" r="5" />
                  }
               }
            </svg>
         }

         @if (laserOn()) {
            <div
               class="laser-capture"
               (click)="$event.stopPropagation()"
               (pointerdown)="onLaserDown($event)"
               (pointermove)="onLaserMove($event)"
               (pointerup)="onLaserUp($event)"
               (pointercancel)="onLaserUp($event)"
            ></div>
         }

         @if (following(); as who) {
            <div class="follow" (click)="$event.stopPropagation()">Following {{ who }} · Esc to leave</div>
         }

         @if (showGrid()) {
            <div class="slide-grid" (click)="$event.stopPropagation(); showGrid.set(false)">
               <div class="sg-list" (click)="$event.stopPropagation()">
                  @for (u of gridThumbs(); track $index) {
                     <button class="sg-item" [class.on]="$index === index()" (click)="jumpTo($index)">
                        <img [src]="u" alt="" draggable="false" />
                        <span class="sg-n">{{ $index + 1 }}</span>
                     </button>
                  }
               </div>
            </div>
         }

         @if (showNotes()) {
            <aside class="notes" (click)="$event.stopPropagation()">
               <h3>Speaker notes</h3>
               @if (current().notes) {
                  <p>{{ current().notes }}</p>
               } @else {
                  <p class="none">No notes for this slide.</p>
               }
            </aside>
         }

         <div
            class="bar"
            [class.dragging]="barDrag !== null"
            [style.transform]="barTransform()"
            (click)="$event.stopPropagation()"
         >
            <span
               class="grip"
               title="Drag to move · double-click to reset"
               (pointerdown)="onBarDown($event)"
               (pointermove)="onBarMove($event)"
               (pointerup)="onBarUp($event)"
               (pointercancel)="onBarUp($event)"
               (dblclick)="barOffset.set({ x: 0, y: 0 })"
            ></span>
            <button
               class="btn"
               (click)="prev()"
               [disabled]="!!following() || (index() === 0 && step() <= firstStep(0))"
               aria-label="Previous"
            >
               <dd-icon name="chevron_left" />
            </button>
            <span class="count">
               {{ index() + 1 }} / {{ slides().length }}
               @if (clicks() > 0) {
                  <small>· {{ clickStep() }}/{{ clicks() }}</small>
               }
            </span>
            <button
               class="btn"
               (click)="next()"
               [disabled]="!!following() || (index() === slides().length - 1 && step() >= current().maxStep)"
               aria-label="Next"
            >
               <dd-icon name="chevron_right" />
            </button>
            <span class="sep"></span>
            <span class="name">{{ current().name }}</span>
            <span class="sep"></span>
            <span class="timer">{{ clock() }}</span>
            <button
               class="btn"
               [class.on]="laserOn()"
               (click)="toggleLaser()"
               aria-label="Laser pointer (K)"
               title="Laser pointer (K): drag on the slide"
            >
               <dd-icon name="near_me" />
            </button>
            <button
               class="btn"
               [class.on]="showNotes()"
               (click)="toggleNotes()"
               aria-label="Speaker notes (N)"
               title="Speaker notes (N)"
            >
               <dd-icon name="notes" />
            </button>
            <button
               class="btn"
               [class.on]="showGrid()"
               (click)="toggleGrid()"
               [disabled]="!!following()"
               aria-label="All slides (G)"
               title="All slides (G)"
            >
               <dd-icon name="grid_view" />
            </button>
            <button class="btn" (click)="exit()" aria-label="Exit (Esc)" title="Exit (Esc)">
               <dd-icon name="close" />
            </button>
         </div>
      </div>
   `,
   styles: [
      `
         :host {
            position: fixed;
            inset: 0;
            z-index: 10000;
            display: block;
         }
         .present {
            position: absolute;
            inset: 0;
            background: #000;
            color: #fff;
            outline: none;
            cursor: default;
            user-select: none;
            overflow: hidden;
         }
         .present.idle {
            cursor: none;
         }
         .stage {
            position: absolute;
            inset: 0;
         }
         .slide,
         .overlay {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
         }
         .slide {
            object-fit: contain;
         }
         .slide.hidden {
            opacity: 0;
            pointer-events: none;
         }
         .overlay {
            pointer-events: none;
            overflow: hidden;
            container-type: size;
         }
         /* Live slide pictures are clipped to the slide itself: items staged off the
         frame (for morph entrances/exits) never show in the letterbox bars. */
         :host ::ng-deep .overlay .layer.framed {
            inset: 0;
            margin: auto;
            width: min(100cqw, calc(100cqh * var(--slide-ar)));
            height: min(100cqh, calc(100cqw / var(--slide-ar)));
            overflow: hidden;
         }
         :host ::ng-deep .overlay .layer {
            position: absolute;
            inset: 0;
            will-change: transform, opacity;
         }
         :host ::ng-deep .overlay .layer img,
         :host ::ng-deep .overlay .layer svg {
            width: 100%;
            height: 100%;
            object-fit: contain;
            display: block;
         }
         .notes {
            position: absolute;
            right: 20px;
            bottom: 76px;
            width: min(420px, 40vw);
            max-height: 40vh;
            overflow: auto;
            padding: 14px 16px;
            border-radius: 12px;
            background: rgba(18, 20, 26, 0.92);
            border: 1px solid rgba(255, 255, 255, 0.14);
            font-size: 14px;
            line-height: 1.5;
            white-space: pre-wrap;
         }
         .notes h3 {
            margin: 0 0 8px;
            font-size: 11px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: rgba(255, 255, 255, 0.55);
         }
         .notes p {
            margin: 0;
         }
         .notes .none {
            color: rgba(255, 255, 255, 0.5);
         }
         .bar {
            position: absolute;
            left: 50%;
            bottom: 18px;
            transform: translateX(-50%);
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 6px 10px;
            border-radius: 14px;
            background: rgba(18, 20, 26, 0.88);
            border: 1px solid rgba(255, 255, 255, 0.14);
            font-size: 13px;
            transition: opacity 0.2s ease;
            touch-action: none;
         }
         .grip {
            width: 10px;
            height: 22px;
            margin-right: 2px;
            border-radius: 3px;
            cursor: grab;
            background-image: radial-gradient(rgba(255, 255, 255, 0.45) 1px, transparent 1.5px);
            background-size: 5px 5px;
            background-position: center;
         }
         .bar.dragging .grip {
            cursor: grabbing;
         }
         .bar-hidden .bar {
            opacity: 0;
            pointer-events: none;
         }
         .btn {
            width: 32px;
            height: 32px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: none;
            border-radius: 8px;
            background: transparent;
            color: inherit;
            cursor: pointer;
         }
         .btn:hover:not(:disabled) {
            background: rgba(255, 255, 255, 0.12);
         }
         .btn:disabled {
            opacity: 0.35;
            cursor: default;
         }
         .btn.on {
            background: rgba(255, 255, 255, 0.18);
         }
         .count,
         .timer {
            font-variant-numeric: tabular-nums;
            min-width: 3.2em;
            text-align: center;
         }
         .name {
            max-width: 22ch;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: rgba(255, 255, 255, 0.75);
         }
         .sep {
            width: 1px;
            height: 18px;
            background: rgba(255, 255, 255, 0.18);
            margin: 0 4px;
         }
         .stage-wrap {
            position: absolute;
            inset: 0;
         }
         .laser-capture {
            position: absolute;
            inset: 0;
            cursor: crosshair;
            touch-action: none;
         }
         .laser-svg {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            overflow: visible;
            color: #ff2d2d;
         }
         .laser-svg .trail {
            stroke: currentColor;
            stroke-linecap: round;
            filter: drop-shadow(0 0 4px currentColor);
         }
         .laser-svg .glow {
            fill: currentColor;
            opacity: 0.28;
         }
         .laser-svg .dot {
            fill: currentColor;
            filter: drop-shadow(0 0 4px currentColor);
         }
         .slide-grid {
            position: absolute;
            inset: 0;
            z-index: 5;
            background: rgba(5, 7, 11, 0.86);
            overflow-y: auto;
            padding: 48px;
            box-sizing: border-box;
         }
         .sg-list {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
            gap: 20px;
            max-width: 1400px;
            margin: 0 auto;
         }
         .sg-item {
            position: relative;
            padding: 0;
            border: 2px solid transparent;
            border-radius: 6px;
            background: #fff;
            cursor: pointer;
            overflow: hidden;
            line-height: 0;
         }
         .sg-item.on {
            border-color: #6f8bff;
            box-shadow: 0 0 0 3px rgba(111, 139, 255, 0.35);
         }
         .sg-item img {
            width: 100%;
            height: auto;
         }
         .sg-n {
            position: absolute;
            left: 6px;
            bottom: 6px;
            line-height: 1;
            padding: 3px 6px;
            border-radius: 4px;
            background: rgba(20, 24, 32, 0.8);
            color: #fff;
            font-size: 12px;
         }
         .follow {
            position: absolute;
            top: 14px;
            left: 50%;
            transform: translateX(-50%);
            padding: 6px 12px;
            border-radius: 999px;
            background: rgba(18, 20, 26, 0.88);
            border: 1px solid rgba(255, 255, 255, 0.14);
            font-size: 12px;
         }
      `,
   ],
   host: {
      '(document:keydown)': 'onKey($event)',
      '(document:fullscreenchange)': 'onFullscreenChange()',
      '(window:resize)': 'resized.update(n => n + 1)',
   },
})
export class PresentModeComponent {
   readonly slides = input.required<readonly RenderedSlide[]>();
   readonly startIndex = input<number>(0);
   /** Preview: play one transition into the second slide, then close by itself. */
   readonly autoplay = input<boolean>(false);
   /** Follow another participant's presentation (their participant id). */
   readonly follow = input<string | null>(null);
   /** Emits the id of the slide that was showing when the presenter closed. */
   readonly closed = output<string | null>();

   private readonly destroyRef = inject(DestroyRef);
   private readonly realtime = inject(RealtimeService);
   private readonly laserState = inject(LaserService);
   private readonly rootRef = viewChild.required<ElementRef<HTMLElement>>('root');
   private readonly overlayRef = viewChild.required<ElementRef<HTMLElement>>('overlay');
   private readonly stageRef = viewChild.required<ElementRef<HTMLElement>>('stage');

   protected readonly index = signal(0);
   /** Build step shown on the current slide (0 = nothing revealed yet). */
   protected readonly step = signal(0);
   protected readonly busy = signal(false);
   protected readonly showNotes = signal(false);
   /** Overview of every slide (G); click one to jump there. */
   protected readonly showGrid = signal(false);
   /** One picture per slide for the overview: the slide with everything shown. */
   protected readonly gridThumbs = computed(() => this.urlList().map((per) => per[per.length - 1]));
   protected readonly barVisible = signal(false);
   /** Cursor shows on any mouse movement and hides after a stretch of stillness. */
   protected readonly cursorVisible = signal(true);
   private cursorTimer: ReturnType<typeof setTimeout> | null = null;
   protected readonly laserOn = signal(false);
   protected readonly resized = signal(0);
   /** How far the user has dragged the control bar from its bottom-centre home. */
   protected readonly barOffset = signal({ x: 0, y: 0 });
   protected readonly barTransform = computed(() => {
      const o = this.barOffset();
      return `translate(calc(-50% + ${o.x}px), ${o.y}px)`;
   });
   protected barDrag: { id: number; sx: number; sy: number; ox: number; oy: number } | null = null;
   private readonly seconds = signal(0);

   /** Object URLs per slide per build step (one entry for slides without steps), revoked on destroy. */
   protected readonly urlList = computed(() =>
      this.slides().map((s) =>
         (s.maxStep > 0 ? s.stepSvgs : [s.svg]).map((svg) =>
            URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
         )
      )
   );
   protected isShown(slideIndex: number, k: number): boolean {
      if (this.index() !== slideIndex) {
         return false;
      }
      const per = this.urlList()[slideIndex] ?? [];
      return Math.min(this.step(), per.length - 1) === k;
   }
   /** The current slide's GIFs/videos and what its animation step hides (none while busy). */
   protected readonly liveMedia = computed(() => {
      const slide = this.slides()[this.index()];
      if (!slide?.media?.length || this.busy()) {
         return null;
      }
      const hidden = slide.maxStep > 0 ? (slide.hiddenByStep[Math.min(this.step(), slide.maxStep)] ?? null) : null;
      return { slide, hidden };
   });
   protected readonly current = computed(() => this.slides()[this.index()] ?? { name: '', notes: '', maxStep: 0 });
   /** Steps of the current slide that wait for a click (a leading automatic group is not one). */
   protected readonly clicks = computed(() => {
      const i = this.index();
      return Math.max(0, this.maxStepOf(i) - this.firstStep(i));
   });
   protected readonly clickStep = computed(() => Math.max(0, this.step() - this.firstStep(this.index())));
   protected readonly following = computed(() => {
      const id = this.follow();
      return id ? (this.realtime.participants().find((p) => p.id === id)?.name ?? 'presenter') : null;
   });
   protected readonly clock = computed(() => {
      const s = this.seconds();
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
   });

   /** Laser trails (ours and collaborators') mapped from canvas space onto the shown slide. */
   protected readonly lasers = computed(() => {
      this.resized();
      const slide = this.slides()[this.index()];
      const views = this.laserState.views();
      if (!slide || !views.length) {
         return [];
      }
      const to = (p: { x: number; y: number }): { x: number; y: number } => this.toScreen(slide, p);
      return views.map((view) => {
         const pts = view.points.map((p) => ({ ...to(p), age: p.age, start: p.start }));
         const segments = [];
         for (let i = 1; i < pts.length; i += 1) {
            if (pts[i].start) {
               continue;
            }
            const life = 1 - (pts[i - 1].age + pts[i].age) / 2;
            segments.push({
               x1: pts[i - 1].x,
               y1: pts[i - 1].y,
               x2: pts[i].x,
               y2: pts[i].y,
               opacity: Math.max(0, life),
               width: 2 + 4 * life,
            });
         }
         return { id: view.id, segments, head: view.head ? to(view.head) : null };
      });
   });

   private cancelRun: (() => void) | null = null;
   private runSeq = 0;
   private idleTimer: ReturnType<typeof setTimeout> | null = null;
   private fullscreen = false;
   private closing = false;
   private laserPointer: number | null = null;
   private lastLaserSent = 0;

   constructor() {
      afterNextRender(() => {
         const root = this.rootRef().nativeElement;
         this.index.set(Math.min(Math.max(0, this.startIndex()), this.slides().length - 1));
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
               void this.go(this.index() + 1, 0).then(() => setTimeout(() => this.exit(), 900));
            }, 600);
         }
      });

      // Tell the room where we are (so others can follow), unless we are following or previewing.
      effect(() => {
         const i = this.index();
         const s = this.step();
         if (this.follow() || this.autoplay()) {
            return;
         }
         const frame = untracked(() => this.slides()[i]);
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
         const p = this.realtime.participants().find((x) => x.id === id);
         untracked(() => {
            if (!p?.presenting) {
               this.exit();
               return;
            }
            const i = this.slides().findIndex((s) => s.id === p.presenting?.frameId);
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
         this.cancelRun?.();
         if (!this.follow() && !this.autoplay()) {
            this.realtime.sendPresenting(null);
         }
         if (this.laserPointer !== null) {
            this.laserState.release(LOCAL_LASER);
            this.realtime.sendLaser(0, 0, true);
         }
         for (const per of this.urlList()) {
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
      const per = this.urlList()[slideIndex] ?? [];
      return per[Math.min(step, per.length - 1)] ?? '';
   }

   private maxStepOf(slideIndex: number): number {
      return this.slides()[slideIndex]?.maxStep ?? 0;
   }

   /**
    * The lowest step a slide rests on: 1 when its first animation group plays by itself
    * (so stepping back never lands on the not-yet-played state), else 0.
    */
   protected firstStep(slideIndex: number): number {
      return this.slides()[slideIndex]?.plan.groups[0]?.auto ? 1 : 0;
   }

   // ---- navigation ----

   protected next(): void {
      if (this.follow() || this.laserOn()) {
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
      this.cancelRun?.();
      const i = this.index();
      if (this.step() < this.maxStepOf(i)) {
         await this.goStep(this.step() + 1);
      } else {
         await this.go(i + 1, 0);
      }
   }

   private async backward(): Promise<void> {
      this.cancelRun?.();
      const i = this.index();
      if (this.step() > this.firstStep(i)) {
         await this.goStep(this.step() - 1);
      } else {
         await this.go(i - 1, this.maxStepOf(i - 1));
      }
   }

   protected toggleGrid(): void {
      if (this.follow()) return;
      this.showGrid.update((v) => !v);
   }

   /** Jump straight to a slide from the overview, at its first step. */
   protected jumpTo(i: number): void {
      this.showGrid.set(false);
      if (this.follow() || i === this.index()) return;
      this.cancelRun?.();
      void this.go(i, this.firstStep(i), true);
   }

   protected toggleNotes(): void {
      this.showNotes.update((v) => !v);
   }

   protected toggleLaser(): void {
      this.laserOn.update((v) => !v);
   }

   protected exit(): void {
      if (this.closing) {
         return;
      }
      this.closing = true;
      this.closed.emit(this.slides()[this.index()]?.id ?? null);
   }

   /** Show the cursor and restart its stillness countdown (PowerPoint-style). */
   private wakeCursor(): void {
      this.cursorVisible.set(true);
      if (this.cursorTimer) {
         clearTimeout(this.cursorTimer);
      }
      this.cursorTimer = setTimeout(() => {
         this.cursorTimer = null;
         // Keep the cursor while it rests on the visible bar or a drag is underway.
         if (!this.barVisible() && !this.barDrag) {
            this.cursorVisible.set(false);
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
         !!this.barDrag ||
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
         this.barVisible.set(true);
      } else if (this.barVisible() && !this.idleTimer) {
         this.idleTimer = setTimeout(() => {
            this.idleTimer = null;
            this.barVisible.set(false);
         }, 400);
      }
   }

   protected onBarDown(event: PointerEvent): void {
      event.preventDefault();
      event.stopPropagation();
      try {
         (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      } catch {
         /* synthetic pointers can refuse capture */
      }
      const o = this.barOffset();
      this.barDrag = { id: event.pointerId, sx: event.clientX, sy: event.clientY, ox: o.x, oy: o.y };
   }

   protected onBarMove(event: PointerEvent): void {
      const d = this.barDrag;
      if (!d || d.id !== event.pointerId) {
         return;
      }
      // Keep the bar on screen: centre stays within the viewport horizontally, and it can
      // travel from its bottom spot up to the top edge.
      const halfW = window.innerWidth / 2 - 40;
      const x = Math.max(-halfW, Math.min(halfW, d.ox + event.clientX - d.sx));
      const y = Math.max(-(window.innerHeight - 70), Math.min(0, d.oy + event.clientY - d.sy));
      this.barOffset.set({ x, y });
   }

   protected onBarUp(event: PointerEvent): void {
      if (this.barDrag?.id === event.pointerId) {
         this.barDrag = null;
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
               this.cancelRun?.();
               void this.go(0, 0, true);
            }
            break;
         case 'End':
            handled();
            if (!this.follow()) {
               this.cancelRun?.();
               const last = this.slides().length - 1;
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
            if (!this.laserOn() && !this.barVisible() && !this.barDrag) {
               // Turning the laser off from the keyboard drops the cursor with it.
               if (this.cursorTimer) {
                  clearTimeout(this.cursorTimer);
                  this.cursorTimer = null;
               }
               this.cursorVisible.set(false);
            }
            break;
         case 'g':
         case 'G':
            handled();
            this.toggleGrid();
            break;
         case 'Escape':
            handled();
            if (this.showGrid()) {
               this.showGrid.set(false);
               break;
            }
            this.exit();
            break;
         default:
            // Swallow everything else so editor shortcuts can't fire behind the show.
            event.stopPropagation();
      }
   }

   // ---- laser ----

   /** Where a canvas-space point lands on screen, given how the slide is fitted to the stage. */
   private toScreen(slide: RenderedSlide, p: { x: number; y: number }): { x: number; y: number } {
      const r = this.stageRef().nativeElement.getBoundingClientRect();
      const s = Math.min(r.width / slide.width, r.height / slide.height);
      const ox = (r.width - slide.width * s) / 2;
      const oy = (r.height - slide.height * s) / 2;
      return { x: ox + (p.x - slide.originX) * s, y: oy + (p.y - slide.originY) * s };
   }

   private toCanvas(clientX: number, clientY: number): { x: number; y: number } | null {
      const slide = this.slides()[this.index()];
      if (!slide) {
         return null;
      }
      const r = this.stageRef().nativeElement.getBoundingClientRect();
      const s = Math.min(r.width / slide.width, r.height / slide.height);
      const ox = (r.width - slide.width * s) / 2;
      const oy = (r.height - slide.height * s) / 2;
      return {
         x: slide.originX + (clientX - r.left - ox) / s,
         y: slide.originY + (clientY - r.top - oy) / s,
      };
   }

   protected onLaserDown(event: PointerEvent): void {
      event.preventDefault();
      event.stopPropagation();
      try {
         (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      } catch {
         /* synthetic pointers can refuse capture */
      }
      this.laserPointer = event.pointerId;
      this.laserSample(event, true);
   }

   protected onLaserMove(event: PointerEvent): void {
      if (this.laserPointer === event.pointerId) {
         this.laserSample(event, false);
      }
   }

   protected onLaserUp(event: PointerEvent): void {
      if (this.laserPointer !== event.pointerId) {
         return;
      }
      event.stopPropagation();
      const w = this.toCanvas(event.clientX, event.clientY);
      this.laserPointer = null;
      this.laserState.release(LOCAL_LASER);
      if (w) {
         this.realtime.sendLaser(w.x, w.y, true);
      }
   }

   private laserSample(event: PointerEvent, force: boolean): void {
      const w = this.toCanvas(event.clientX, event.clientY);
      if (!w) {
         return;
      }
      this.laserState.add(LOCAL_LASER, w.x, w.y);
      const now = Date.now();
      if (!force && now - this.lastLaserSent < 33) {
         return;
      }
      this.lastLaserSent = now;
      if (this.realtime.connected()) {
         this.realtime.sendLaser(w.x, w.y);
      }
   }

   // ---- transitions ----

   /** Go to a specific slide + step (used when following a presenter). */
   private async goTo(index: number, step: number): Promise<void> {
      this.cancelRun?.();
      if (index === this.index()) {
         if (step !== this.step()) {
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
      const i = this.index();
      const from = this.step();
      if (target === from) {
         return;
      }
      const slide = this.slides()[i];
      if (slide && slide.maxStep > 0 && Math.abs(target - from) === 1) {
         const forward = target > from;
         const k = forward ? target : from;
         const group = slide.plan.groups[k - 1];
         const mix = slide.mixSvgs[k];
         if (group && mix) {
            await this.runLayers(
               '',
               '',
               0,
               'linear',
               () => undefined,
               () => this.step.set(target),
               undefined,
               {
                  markup: mix,
                  width: slide.width,
                  height: slide.height,
                  play: (svg, add) => (forward ? playGroup : undoGroup)(svg, slide, group, add).duration,
               }
            );
            return;
         }
      }
      const dur = 280;
      await this.runLayers(
         this.urlFor(i, from),
         this.urlFor(i, target),
         dur,
         'ease',
         (_out, inc, animate) => animate(inc, [{ opacity: 0 }, { opacity: 1 }]),
         () => this.step.set(target)
      );
   }

   /**
    * Move to slide `target` showing build step `toStep`. Going forward plays the
    * target's own transition; going back plays the slide being left, reversed.
    * `instant` skips animation.
    */
   private async go(target: number, toStep: number, instant = false): Promise<void> {
      await this.goSlide(target, toStep, instant);
      // A first animation group that needs no click plays as soon as its slide is up.
      if (toStep === 0 && this.index() === target) {
         await this.playAutomatic();
      }
   }

   /** Play the current slide's leading click-less animations, if it has them and they have not played. */
   private async playAutomatic(): Promise<void> {
      if (this.step() === 0 && this.firstStep(this.index()) === 1) {
         await this.goStep(1);
      }
   }

   private async goSlide(target: number, toStep: number, instant = false): Promise<void> {
      const slides = this.slides();
      const from = this.index();
      if (target < 0 || target >= slides.length || target === from) {
         return;
      }
      const forward = target > from;
      const t = (forward ? slides[target] : slides[from]).transition;
      const adjacent = Math.abs(target - from) === 1;
      const commit = (): void => {
         this.index.set(target);
         this.step.set(toStep);
      };
      if (instant || !adjacent || t.type === 'none' || t.duration <= 0) {
         commit();
         return;
      }
      // Morph only between slides of the same size; otherwise it would have to stretch one.
      const sameSize =
         Math.abs(slides[from].width - slides[target].width) < 1 &&
         Math.abs(slides[from].height - slides[target].height) < 1;
      const isMorph = t.type === 'morph' && sameSize;
      const fromView = slideAtStep(slides[from], this.step());
      const toView = slideAtStep(slides[target], toStep);
      await this.runLayers(
         this.urlFor(from, this.step()),
         this.urlFor(target, toStep),
         t.duration,
         t.easing,
         (out, inc, animate) => {
            if (t.type === 'fade' || t.type === 'morph') {
               animate(inc, [{ opacity: 0 }, { opacity: 1 }]);
            } else if (t.type === 'slide') {
               // The slides travel in `direction`; coming back, they travel the other way.
               const base = TRAVEL[t.direction ?? 'left'] ?? TRAVEL['left'];
               const [dx, dy] = forward ? base : [-base[0], -base[1]];
               animate(out, [{ transform: 'translate(0, 0)' }, { transform: `translate(${dx * 100}%, ${dy * 100}%)` }]);
               animate(inc, [
                  { transform: `translate(${-dx * 100}%, ${-dy * 100}%)` },
                  { transform: 'translate(0, 0)' },
               ]);
            } else {
               // zoom: the new slide grows into place while the old one swells and fades.
               animate(out, [
                  { transform: 'scale(1)', opacity: 1 },
                  { transform: `scale(${forward ? 1.4 : 0.6})`, opacity: 0 },
               ]);
               animate(inc, [
                  { transform: `scale(${forward ? 0.6 : 1.4})`, opacity: 0 },
                  { transform: 'scale(1)', opacity: 1 },
               ]);
            }
         },
         commit,
         isMorph ? { from: fromView, to: toView, reversed: !forward } : undefined
      );
   }

   /**
    * Run one transition on temporary overlay layers. `setup` receives the
    * outgoing/incoming layers and an animate helper; with `morph` the layers are
    * replaced by a live morph stage. `commit` applies the final state.
    */
   private runLayers(
      fromUrl: string,
      toUrl: string,
      duration: number,
      easing: SlideEasing,
      setup: (out: HTMLElement, inc: HTMLElement, animate: (el: HTMLElement, frames: Keyframe[]) => void) => void,
      commit: () => void,
      morph?: { from: RenderedSlide; to: RenderedSlide; reversed?: boolean },
      /** Animate objects of a live slide picture; `play` returns the total length (ms). */
      live?: {
         markup: string;
         width: number;
         height: number;
         play: (svg: SVGSVGElement, add: (a: Animation) => void) => number;
      }
   ): Promise<void> {
      const overlay = this.overlayRef().nativeElement;
      overlay.replaceChildren();
      const seq = (this.runSeq += 1);
      this.busy.set(true);

      return new Promise<void>((resolve) => {
         let raf = 0;
         const animations: Animation[] = [];
         let stage: MorphStage | null = null;
         let done = false;
         const finish = (): void => {
            if (done) {
               return;
            }
            done = true;
            cancelAnimationFrame(raf);
            // A live layer keeps its end state until it is removed, so an object that just left
            // does not flash back for the frames before the committed picture shows.
            for (const a of animations) {
               if (live) {
                  a.finish();
               } else {
                  a.cancel();
               }
            }
            this.cancelRun = null;
            // Show the result first, and only then take the transition layers away, so
            // there is never a frame with neither on screen (the black flash).
            commit();
            this.busy.set(false);
            let cleared = false;
            const clear = (): void => {
               if (cleared) {
                  return;
               }
               cleared = true;
               stage?.dispose();
               if (this.runSeq === seq) {
                  overlay.replaceChildren();
               }
            };
            requestAnimationFrame(() => requestAnimationFrame(clear));
            setTimeout(clear, 120);
            resolve();
         };
         this.cancelRun = finish;

         const layer = (url: string): HTMLElement => {
            const el = document.createElement('div');
            el.className = 'layer';
            const img = document.createElement('img');
            img.src = url;
            img.alt = '';
            img.draggable = false;
            el.appendChild(img);
            overlay.appendChild(el);
            return el;
         };

         if (live) {
            const host = framedLayer(live.width, live.height);
            const parsed = parseSafeSvg(live.markup);
            if (parsed) {
               host.appendChild(document.importNode(parsed, true));
            }
            overlay.appendChild(host);
            const svg = host.querySelector('svg');
            if (!svg) {
               finish();
               return;
            }
            const total = live.play(svg, (a) => animations.push(a));
            // Settle when every motion has finished (or after the plan's length, if none ran).
            const settled = Promise.allSettled(animations.map((a) => a.finished));
            const timer = setTimeout(finish, total + 400);
            void settled.then(() => {
               clearTimeout(timer);
               finish();
            });
            return;
         }

         if (morph) {
            const s = new MorphStage(morph.from, morph.to, morph.reversed);
            stage = s;
            const host = framedLayer(morph.to.width, morph.to.height);
            host.appendChild(s.svg);
            overlay.appendChild(host);
            void s.prepare().then(() => {
               if (done) {
                  return;
               }
               const begin = performance.now();
               const tick = (now: number): void => {
                  const p = Math.min(1, (now - begin) / duration);
                  s.update(ease(easing, p));
                  if (p < 1 && !done) {
                     raf = requestAnimationFrame(tick);
                  } else {
                     finish();
                  }
               };
               raf = requestAnimationFrame(tick);
            });
            return;
         }

         const outgoing = layer(fromUrl);
         const incoming = layer(toUrl);
         const animate = (el: HTMLElement, frames: Keyframe[]): void => {
            animations.push(el.animate(frames, { duration, easing, fill: 'both' }));
         };
         setup(outgoing, incoming, animate);
         const last = animations[animations.length - 1];
         if (last) {
            void last.finished.then(finish, finish);
         } else {
            finish();
         }
      });
   }
}
