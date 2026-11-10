import {
   ChangeDetectionStrategy,
   Component,
   ElementRef,
   computed,
   effect,
   input,
   signal,
   viewChild,
} from '@angular/core';
import type { ImageView } from '../canvas/models/shape-view.model';

/**
 * A video element's player: the (cropped, clipped) video filling its box, with a
 * small control bar along the bottom (play/pause, scrub, time, mute). Used inside
 * the canvas (in a foreignObject, so it scales with zoom) and over slides while
 * presenting. Never starts on its own unless the element's playback is `auto`.
 * Everything but the control bar is click-through, so the box stays grabbable.
 */
@Component({
   selector: 'dd-media-video',
   changeDetection: ChangeDetectionStrategy.OnPush,
   host: {
      class: 'media-video',
      '[class.show-bar]': 'barShown()',
      '[class.clickable]': 'clickToPlay()',
      '[style.clip-path]': 'view().clip?.css ?? null',
      '(click)': 'onHostClick($event)',
   },
   template: `
      <video
         #video
         [src]="src()"
         [poster]="poster() ?? ''"
         [loop]="view().loop && !hasTrim()"
         [attr.aria-label]="view().alt || null"
         [muted]="muted()"
         [style.left.%]="frame().left"
         [style.top.%]="frame().top"
         [style.width.%]="frame().width"
         [style.height.%]="frame().height"
         playsinline
         preload="auto"
         (play)="playing.set(true)"
         (pause)="playing.set(false)"
         (ended)="playing.set(false)"
         (timeupdate)="onTime($any($event.target))"
         (loadedmetadata)="onMeta($any($event.target))"
         (volumechange)="muted.set($any($event.target).muted)"
      ></video>
      <div
         class="bar"
         (pointerdown)="$event.stopPropagation()"
         (click)="$event.stopPropagation()"
         (dblclick)="$event.stopPropagation()"
      >
         <button type="button" class="btn" [attr.aria-label]="playing() ? 'Pause' : 'Play'" (click)="toggle()">
            @if (playing()) {
               <svg viewBox="0 0 16 16">
                  <rect x="3.5" y="2.5" width="3" height="11" rx="1" />
                  <rect x="9.5" y="2.5" width="3" height="11" rx="1" />
               </svg>
            } @else {
               <svg viewBox="0 0 16 16">
                  <path d="M4.5 2.8v10.4a.6.6 0 0 0 .9.5l8.2-5.2a.6.6 0 0 0 0-1L5.4 2.3a.6.6 0 0 0-.9.5Z" />
               </svg>
            }
         </button>
         <input
            class="scrub"
            type="range"
            min="0"
            step="0.01"
            aria-label="Seek"
            [max]="duration() || 0"
            [value]="time()"
            (input)="seek($any($event.target).valueAsNumber)"
         />
         <span class="time">{{ clock(time()) }} / {{ clock(duration()) }}</span>
         <button type="button" class="btn" [attr.aria-label]="muted() ? 'Unmute' : 'Mute'" (click)="toggleMute()">
            @if (muted()) {
               <svg viewBox="0 0 16 16">
                  <path d="M2 6h2.5L8 3v10L4.5 10H2Z" />
                  <path
                     d="m10.5 6 4 4m0-4-4 4"
                     fill="none"
                     stroke="currentColor"
                     stroke-width="1.4"
                     stroke-linecap="round"
                  />
               </svg>
            } @else {
               <svg viewBox="0 0 16 16">
                  <path d="M2 6h2.5L8 3v10L4.5 10H2Z" />
                  <path
                     d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.3 3.8a6 6 0 0 1 0 8.4"
                     fill="none"
                     stroke="currentColor"
                     stroke-width="1.4"
                     stroke-linecap="round"
                  />
               </svg>
            }
         </button>
      </div>
   `,
   styles: `
      :host {
         position: absolute;
         inset: 0;
         display: block;
         overflow: hidden;
         pointer-events: none;
         background: #000;
      }
      :host.clickable {
         pointer-events: auto;
         cursor: pointer;
      }
      video {
         position: absolute;
         object-fit: fill;
         pointer-events: none;
      }
      .bar {
         position: absolute;
         left: 0;
         right: 0;
         bottom: 0;
         height: 34px;
         display: flex;
         align-items: center;
         gap: 6px;
         padding: 0 8px;
         background: linear-gradient(transparent, rgba(0, 0, 0, 0.65));
         color: #fff;
         font:
            500 11px/1 system-ui,
            sans-serif;
         opacity: 0;
         pointer-events: none;
         transition: opacity 120ms ease;
      }
      :host.show-bar .bar,
      :host.clickable:hover .bar {
         opacity: 1;
         pointer-events: auto;
      }
      .btn {
         flex: none;
         width: 24px;
         height: 24px;
         padding: 4px;
         border: 0;
         border-radius: 4px;
         background: transparent;
         color: inherit;
         cursor: pointer;
      }
      .btn:hover {
         background: rgba(255, 255, 255, 0.18);
      }
      .btn svg {
         width: 100%;
         height: 100%;
         fill: currentColor;
      }
      .scrub {
         flex: 1;
         min-width: 0;
         accent-color: #fff;
         cursor: pointer;
      }
      .time {
         flex: none;
         font-variant-numeric: tabular-nums;
         white-space: nowrap;
      }
   `,
})
export class MediaVideoComponent {
   readonly view = input.required<ImageView>();
   readonly src = input.required<string>();
   readonly poster = input<string | null>(null);
   /** Show the control bar (canvas: while selected). */
   readonly controls = input(false);
   /** Presenting: a click anywhere on the video plays/pauses it, and hover shows the bar. */
   readonly clickToPlay = input(false);
   /** Start playing as soon as it is shown (playback `auto`). */
   readonly autoplay = input(false);

   private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
   protected readonly playing = signal(false);
   protected readonly time = signal(0);
   protected readonly duration = signal(0);
   protected readonly muted = signal(false);

   /** Paused videos keep their bar up so it is clear they can be played. */
   protected readonly barShown = computed(() => this.controls() || (this.clickToPlay() && !this.playing()));

   /** The whole source's place inside the box, in percent (crop). */
   protected readonly frame = computed(() => {
      const v = this.view();
      const w = v.width || 1;
      const h = v.height || 1;
      return {
         left: ((v.src.x - v.x) / w) * 100,
         top: ((v.src.y - v.y) / h) * 100,
         width: (v.src.width / w) * 100,
         height: (v.src.height / h) * 100,
      };
   });

   constructor() {
      effect(() => this.muted.set(this.view().muted));
      effect(() => {
         const el = this.video().nativeElement;
         if (this.autoplay()) {
            void el.play().catch(() => {
               // Autoplay with sound can be refused; retry muted.
               el.muted = true;
               void el.play().catch(() => undefined);
            });
         }
      });
   }

   /** A start or end trim is set (looping is then done by hand, within the trim). */
   protected readonly hasTrim = computed(() => this.view().start != null || this.view().end != null);

   protected onMeta(el: HTMLVideoElement): void {
      this.duration.set(el.duration || 0);
      const start = this.view().start;
      if (start != null && start > 0 && start < (el.duration || Infinity)) el.currentTime = start;
   }

   /** Keep playback inside the trim: at the end, loop back to the start or stop. */
   protected onTime(el: HTMLVideoElement): void {
      this.time.set(el.currentTime);
      const { start, end, loop } = this.view();
      const stop = end != null && end > (start ?? 0) ? end : null;
      if ((stop != null && el.currentTime >= stop) || (el.ended && this.hasTrim())) {
         if (loop) {
            el.currentTime = start ?? 0;
            if (el.paused) void el.play().catch(() => undefined);
         } else {
            el.pause();
            el.currentTime = stop ?? el.currentTime;
         }
      }
   }

   protected toggle(): void {
      const el = this.video().nativeElement;
      const { start, end } = this.view();
      if (el.paused && end != null && el.currentTime >= end - 0.05) el.currentTime = start ?? 0;
      if (el.paused) {
         void el.play().catch(() => undefined);
      } else {
         el.pause();
      }
   }

   protected toggleMute(): void {
      const el = this.video().nativeElement;
      el.muted = !el.muted;
   }

   protected seek(t: number): void {
      const el = this.video().nativeElement;
      el.currentTime = t;
      this.time.set(t);
   }

   protected onHostClick(event: MouseEvent): void {
      if (this.clickToPlay()) {
         event.stopPropagation();
         this.toggle();
      }
   }

   protected clock(seconds: number): string {
      const s = Math.max(0, Math.floor(seconds || 0));
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
   }
}
