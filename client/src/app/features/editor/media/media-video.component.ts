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
   templateUrl: './media-video.component.html',
   styleUrl: './media-video.component.scss',
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
