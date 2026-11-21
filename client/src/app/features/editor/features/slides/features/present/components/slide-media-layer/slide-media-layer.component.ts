import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { ElementImagesService } from '../../../../../../services/element-images.service';
import type { SlideMedia } from '../../../../services/slide-render.service';
import { MediaVideoComponent } from '../../../../../../shared/components/media-video/media-video.component';
import { EmbedFrameComponent } from '../../../../../../shared/components/embed-frame/embed-frame.component';
import { EmbedFramesService } from '../../../../../../services/embed-frames.service';
import { CallPipe, AtPipe } from '../../../../../../../../shared/ui/pipes/collection.pipes';
import { ImagePosterPipe, ImageUrlPipe } from '../../../../../../../../features/editor/shared/pipes/element-image.pipes';

/**
 * The live GIFs and videos of the slide being presented, laid over the slide
 * picture at the same place (in percent of the slide, letterboxed like it). GIFs
 * stay on their first frame until their playback says go: `auto` at once, `hover`
 * while the pointer is over them, `click` toggled by clicking them. Videos never
 * start on their own unless set to `auto`; their control bar shows on hover.
 */
@Component({
   selector: 'dd-slide-media-layer',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [AtPipe, ImagePosterPipe, ImageUrlPipe, CallPipe, MediaVideoComponent, EmbedFrameComponent],
   templateUrl: './slide-media-layer.component.html',
   styleUrl: './slide-media-layer.component.scss',
})
export class SlideMediaLayerComponent {
   readonly media = input.required<readonly SlideMedia[]>();
   /** Ids hidden at the current animation step. */
   readonly hidden = input<ReadonlySet<string> | null>(null);
   readonly slideWidth = input.required<number>();
   readonly slideHeight = input.required<number>();

   protected readonly images = inject(ElementImagesService);
   protected readonly embeds = inject(EmbedFramesService);
   protected readonly hovered = signal<string | null>(null);
   /** Click-to-play GIFs that are playing, with a counter so each start begins at frame one. */
   private readonly started = signal<ReadonlyMap<string, number>>(new Map());
   private runs = 0;

   protected readonly aspect$ = computed(() => String(this.slideWidth() / Math.max(1, this.slideHeight())));
   protected readonly items$ = computed(() => {
      const hidden = this.hidden();
      // A viewer who turned live frames off sees the placeholder card in the slide picture.
      const blocked = this.embeds.blocked$();
      return this.media().filter((m) => !hidden?.has(m.id) && !(blocked && m.kind === 'embed'));
   });

   protected playbackOf(m: SlideMedia): 'auto' | 'click' | 'hover' {
      return m.view.playback ?? 'click';
   }

   /** The GIF's file while it plays (a fresh URL fragment restarts it), else its first frame. */
   /** GIF source: plays (restarting by fragment) or shows its first frame, by playback mode. */
   protected readonly gifSrc$ = computed(() => {
      const hovered = this.hovered();
      const started = this.started();
      return (m: SlideMedia, url: string | null, poster: string | null): string | null => {
         const mode = this.playbackOf(m);
         if (!url) return null;
         if (mode === 'auto') return url;
         const run = mode === 'hover' ? (hovered === m.id ? 0 : undefined) : started.get(m.id);
         return run === undefined ? (poster ?? url) : `${url}#${run}`;
      };
   });

   protected frame(m: SlideMedia): { left: number; top: number; width: number; height: number } {
      const v = m.view;
      const w = v.width || 1;
      const h = v.height || 1;
      return {
         left: ((v.src.x - v.x) / w) * 100,
         top: ((v.src.y - v.y) / h) * 100,
         width: (v.src.width / w) * 100,
         height: (v.src.height / h) * 100,
      };
   }

   protected onClick(m: SlideMedia, event: MouseEvent): void {
      if (m.kind !== 'gif' || this.playbackOf(m) !== 'click') {
         return;
      }
      // Clicking the GIF plays/stops it instead of advancing the slide.
      event.stopPropagation();
      const next = new Map(this.started());
      if (next.has(m.id)) {
         next.delete(m.id);
      } else {
         next.set(m.id, (this.runs += 1));
      }
      this.started.set(next);
   }
}
