import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { ElementImagesService } from '../../../core/services/element-images.service';
import type { SlideMedia } from '../slides/slide-render.service';
import { MediaVideoComponent } from './media-video.component';

/**
 * The live GIFs and videos of the slide being presented, laid over the slide
 * picture at the same place (in percent of the slide, letterboxed like it). GIFs
 * stay on their first frame until their playback says go: `auto` at once, `hover`
 * while the pointer is over them, `click` toggled by clicking them. Videos never
 * start on their own unless set to `auto`; their control bar shows on hover.
 */
@Component({
   selector: 'app-slide-media-layer',
   standalone: true,
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [MediaVideoComponent],
   template: `
      <div class="frame" [style.--slide-ar]="aspect()">
         @for (m of items(); track m.id) {
            <div
               class="item"
               [class.gif-click]="m.kind === 'gif' && playbackOf(m) === 'click'"
               [style.left.%]="m.left"
               [style.top.%]="m.top"
               [style.width.%]="m.width"
               [style.height.%]="m.height"
               [style.opacity]="m.opacity"
               [style.transform]="m.angle ? 'rotate(' + m.angle + 'deg)' : null"
               (pointerenter)="hovered.set(m.id)"
               (pointerleave)="hovered.set(null)"
               (click)="onClick(m, $event)"
            >
               @if (m.kind === 'video') {
                  @if (images.url(m.fileId); as src) {
                     <app-media-video
                        [view]="m.view"
                        [src]="src"
                        [poster]="images.posterUrl(m.fileId)"
                        [clickToPlay]="true"
                        [autoplay]="m.view.playback === 'auto'"
                     ></app-media-video>
                  }
               } @else {
                  <div class="clip" [style.clip-path]="m.view.clip?.css ?? null">
                     @if (gifSrc(m); as src) {
                        <img
                           alt=""
                           draggable="false"
                           [src]="src"
                           [style.left.%]="frame(m).left"
                           [style.top.%]="frame(m).top"
                           [style.width.%]="frame(m).width"
                           [style.height.%]="frame(m).height"
                        />
                     }
                  </div>
               }
            </div>
         }
      </div>
   `,
   styles: `
      :host {
         position: absolute;
         inset: 0;
         pointer-events: none;
         container-type: size;
      }
      .frame {
         position: absolute;
         inset: 0;
         margin: auto;
         width: min(100cqw, calc(100cqh * var(--slide-ar)));
         height: min(100cqh, calc(100cqw / var(--slide-ar)));
         overflow: hidden;
      }
      .item {
         position: absolute;
         pointer-events: auto;
      }
      .item.gif-click {
         cursor: pointer;
      }
      .clip {
         position: absolute;
         inset: 0;
         overflow: hidden;
      }
      img {
         position: absolute;
         display: block;
         user-select: none;
      }
   `,
})
export class SlideMediaLayerComponent {
   readonly media = input.required<readonly SlideMedia[]>();
   /** Ids hidden at the current animation step. */
   readonly hidden = input<ReadonlySet<string> | null>(null);
   readonly slideWidth = input.required<number>();
   readonly slideHeight = input.required<number>();

   protected readonly images = inject(ElementImagesService);
   protected readonly hovered = signal<string | null>(null);
   /** Click-to-play GIFs that are playing, with a counter so each start begins at frame one. */
   private readonly started = signal<ReadonlyMap<string, number>>(new Map());
   private runs = 0;

   protected readonly aspect = computed(() => String(this.slideWidth() / Math.max(1, this.slideHeight())));
   protected readonly items = computed(() => {
      const hidden = this.hidden();
      return hidden ? this.media().filter((m) => !hidden.has(m.id)) : this.media();
   });

   protected playbackOf(m: SlideMedia): 'auto' | 'click' | 'hover' {
      return m.view.playback ?? 'click';
   }

   /** The GIF's file while it plays (a fresh URL fragment restarts it), else its first frame. */
   protected gifSrc(m: SlideMedia): string | null {
      const url = this.images.url(m.fileId);
      const poster = this.images.posterUrl(m.fileId);
      const mode = this.playbackOf(m);
      if (!url) {
         return null;
      }
      if (mode === 'auto') {
         return url;
      }
      const run = mode === 'hover' ? (this.hovered() === m.id ? 0 : undefined) : this.started().get(m.id);
      return run === undefined ? (poster ?? url) : `${url}#${run}`;
   }

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
