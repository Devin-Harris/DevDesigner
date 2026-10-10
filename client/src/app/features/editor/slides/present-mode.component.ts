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
import type { SlideEasing } from '@dbdesigner/shared';
import { LOCAL_LASER, LaserService } from '../../../core/services/laser.service';
import { RealtimeService } from '../../../core/services/realtime.service';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { MorphStage } from './morph-stage';
import { slideAtStep, type RenderedSlide } from './slide-render.service';

/** CSS cubic-bezier control points per easing name. */
const BEZIER: Record<SlideEasing, [number, number, number, number] | null> = {
  linear: null,
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

/** Map linear progress 0..1 through a named CSS easing curve. */
function ease(name: SlideEasing, t: number): number {
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
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div
      #root
      class="present"
      tabindex="-1"
      [class.idle]="!barVisible()"
      (click)="next()"
      (pointermove)="wake()"
    >
      <div #stage class="stage">
        <!-- Every slide image stays in the DOM (decoded), so switching is a visibility
             flip with no load or decode gap. -->
        @for (per of urlList(); track $index; let si = $index) {
          @for (u of per; track $index; let k = $index) {
            <img
              class="slide"
              [class.hidden]="busy() || !isShown(si, k)"
              [src]="u"
              alt=""
              draggable="false"
            />
          }
        }
        <div #overlay class="overlay"></div>
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
        <div class="follow" (click)="$event.stopPropagation()">
          Following {{ who }} · Esc to leave
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

      <div class="bar" (click)="$event.stopPropagation()">
        <button
          class="btn"
          (click)="prev()"
          [disabled]="!!following() || (index() === 0 && step() === 0)"
          aria-label="Previous"
        >
          <dbd-icon name="chevron_left" />
        </button>
        <span class="count">
          {{ index() + 1 }} / {{ slides().length }}
          @if (current().maxStep > 0) {
            <small>· {{ step() }}/{{ current().maxStep }}</small>
          }
        </span>
        <button
          class="btn"
          (click)="next()"
          [disabled]="
            !!following() || (index() === slides().length - 1 && step() >= current().maxStep)
          "
          aria-label="Next"
        >
          <dbd-icon name="chevron_right" />
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
          <dbd-icon name="near_me" />
        </button>
        <button
          class="btn"
          [class.on]="showNotes()"
          (click)="toggleNotes()"
          aria-label="Speaker notes (N)"
          title="Speaker notes (N)"
        >
          <dbd-icon name="notes" />
        </button>
        <button class="btn" (click)="exit()" aria-label="Exit (Esc)" title="Exit (Esc)">
          <dbd-icon name="close" />
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
      }
      :host ::ng-deep .overlay .layer {
        position: absolute;
        inset: 0;
        will-change: transform, opacity;
      }
      :host ::ng-deep .overlay .layer img {
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
      }
      .idle .bar {
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
  readonly closed = output<void>();

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
  protected readonly barVisible = signal(true);
  protected readonly laserOn = signal(false);
  protected readonly resized = signal(0);
  private readonly seconds = signal(0);

  /** Object URLs per slide per build step (one entry for slides without steps), revoked on destroy. */
  protected readonly urlList = computed(() =>
    this.slides().map((s) =>
      (s.maxStep > 0 ? s.stepSvgs : [s.svg]).map((svg) =>
        URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })),
      ),
    ),
  );
  protected isShown(slideIndex: number, k: number): boolean {
    if (this.index() !== slideIndex) {
      return false;
    }
    const per = this.urlList()[slideIndex] ?? [];
    return Math.min(this.step(), per.length - 1) === k;
  }
  protected readonly current = computed(
    () => this.slides()[this.index()] ?? { name: '', notes: '', maxStep: 0 },
  );
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
      this.wake();
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
    if (this.step() > 0) {
      await this.goStep(this.step() - 1);
    } else {
      await this.go(i - 1, this.maxStepOf(i - 1));
    }
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
    this.closed.emit();
  }

  protected wake(): void {
    this.barVisible.set(true);
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => this.barVisible.set(false), 2600);
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
    const handled = (): void => {
      event.preventDefault();
      event.stopPropagation();
      this.wake();
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
        break;
      case 'Escape':
        handled();
        this.exit();
        break;
      default:
        // Swallow everything else so editor shortcuts can't fire behind the show.
        event.stopPropagation();
    }
  }

  // ---- laser ----

  /** Where a canvas-space point lands on screen, given how the slide is fitted to the stage. */
  private toScreen(
    slide: RenderedSlide,
    p: { x: number; y: number },
  ): { x: number; y: number } {
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

  /** Reveal / hide build steps within the current slide: a short cross-fade. */
  private async goStep(target: number): Promise<void> {
    const i = this.index();
    const from = this.step();
    if (target === from) {
      return;
    }
    const dur = 280;
    await this.runLayers(
      this.urlFor(i, from),
      this.urlFor(i, target),
      dur,
      'ease',
      (_out, inc, animate) => animate(inc, [{ opacity: 0 }, { opacity: 1 }]),
      () => this.step.set(target),
    );
  }

  /**
   * Move to slide `target` showing build step `toStep`. Going forward plays the
   * target's own transition; going back plays the slide being left, reversed.
   * `instant` skips animation.
   */
  private async go(target: number, toStep: number, instant = false): Promise<void> {
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
          animate(out, [
            { transform: 'translate(0, 0)' },
            { transform: `translate(${dx * 100}%, ${dy * 100}%)` },
          ]);
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
      isMorph ? { from: fromView, to: toView } : undefined,
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
    setup: (
      out: HTMLElement,
      inc: HTMLElement,
      animate: (el: HTMLElement, frames: Keyframe[]) => void,
    ) => void,
    commit: () => void,
    morph?: { from: RenderedSlide; to: RenderedSlide },
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
        for (const a of animations) {
          a.cancel();
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

      if (morph) {
        const s = new MorphStage(morph.from, morph.to);
        stage = s;
        const host = document.createElement('div');
        host.className = 'layer';
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
