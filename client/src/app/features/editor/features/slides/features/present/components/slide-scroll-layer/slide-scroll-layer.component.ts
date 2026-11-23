import { ChangeDetectionStrategy, Component, computed, input, OnDestroy, signal } from '@angular/core';
import { CallPipe } from '../../../../../../../../shared/ui/pipes/collection.pipes';
import type { SlideScroll } from '../../../../services/slide-render.service';

/**
 * Scrollable frames of the slide being presented, laid over the slide picture at the
 * frame's place (in percent of the slide, letterboxed like it). Each shows the frame's
 * whole content and scrolls with the wheel while hovered; clicks still advance the slide.
 */
@Component({
   selector: 'dd-slide-scroll-layer',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [CallPipe],
   templateUrl: './slide-scroll-layer.component.html',
   styleUrl: './slide-scroll-layer.component.scss',
})
export class SlideScrollLayerComponent implements OnDestroy {
   readonly scrolls = input.required<readonly SlideScroll[]>();
   /** Ids hidden at the current animation step (a frame with hidden content stays a picture). */
   readonly hidden = input<ReadonlySet<string> | null>(null);
   /** The slide without the scrolling content, shown fixed behind each box's content. */
   readonly under = input<string | null>(null);
   readonly slideWidth = input.required<number>();
   readonly slideHeight = input.required<number>();

   protected readonly aspect$ = computed(() => String(this.slideWidth() / Math.max(1, this.slideHeight())));
   private urls: string[] = [];
   private underUrl: string | null = null;
   /** CSS background of the boxes: the backdrop picture as a URL. */
   protected readonly underCss$ = computed(() => {
      if (this.underUrl) URL.revokeObjectURL(this.underUrl);
      const svg = this.under();
      this.underUrl = svg ? URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })) : null;
      return this.underUrl ? `url("${this.underUrl}")` : null;
   });

   /** Backdrop size and position so the slide picture lines up with the slide under the box. */
   protected underPlacement(s: SlideScroll): { size: string; position: string } {
      const pos = (at: number, size: number): string => (size >= 100 ? '0%' : `${(at / (100 - size)) * 100}%`);
      return {
         size: `${(100 / s.width) * 100}% ${(100 / s.height) * 100}%`,
         position: `${pos(s.left, s.width)} ${pos(s.top, s.height)}`,
      };
   }
   protected readonly items$ = computed(() => {
      for (const u of this.urls) URL.revokeObjectURL(u);
      const hidden = this.hidden();
      const shown = this.scrolls().filter((s) => !s.members.some((id) => hidden?.has(id)));
      const items = shown.map((s) => ({
         ...s,
         url: URL.createObjectURL(new Blob([s.svg], { type: 'image/svg+xml;charset=utf-8' })),
      }));
      this.urls = items.map((i) => i.url);
      return items;
   });

   /** Scroll position of each frame, as fractions of how far it can scroll. */
   private readonly positions = signal<ReadonlyMap<string, { x: number; y: number }>>(new Map());

   /** Scrollbar thumbs in % of the frame (start, size), for the axes that overflow. */
   protected readonly barsOf$ = computed(() => {
      const positions = this.positions();
      const bar = (ratio: number, at: number): { start: number; size: number } | null => {
         if (ratio <= 1.001) return null;
         const size = Math.max(8, 100 / ratio);
         return { start: (100 - size) * at, size };
      };
      return (s: SlideScroll) => {
         const p = positions.get(s.id) ?? { x: 0, y: 0 };
         return { v: bar(s.contentRatio, p.y), h: bar(s.contentRatioX, p.x) };
      };
   });

   protected onScroll(id: string, event: Event): void {
      const el = event.target as HTMLElement;
      const maxY = el.scrollHeight - el.clientHeight;
      const maxX = el.scrollWidth - el.clientWidth;
      const p = { x: maxX > 0 ? el.scrollLeft / maxX : 0, y: maxY > 0 ? el.scrollTop / maxY : 0 };
      this.positions.update((m) => new Map(m).set(id, p));
   }

   /** Drag a thumb: the frame scrolls in proportion, like a native scrollbar. */
   protected dragBar(scroller: HTMLElement, axis: 'v' | 'h', event: PointerEvent): void {
      event.preventDefault();
      event.stopPropagation();
      const bar = event.currentTarget as HTMLElement;
      bar.setPointerCapture(event.pointerId);
      bar.classList.add('dragging');
      const v = axis === 'v';
      let last = v ? event.clientY : event.clientX;
      const move = (e: PointerEvent): void => {
         const at = v ? e.clientY : e.clientX;
         const client = v ? scroller.clientHeight : scroller.clientWidth;
         const full = v ? scroller.scrollHeight : scroller.scrollWidth;
         const thumb = v ? bar.offsetHeight : bar.offsetWidth;
         const per = (full - client) / Math.max(1, client - thumb);
         if (v) scroller.scrollTop += (at - last) * per;
         else scroller.scrollLeft += (at - last) * per;
         last = at;
      };
      const up = (): void => {
         bar.classList.remove('dragging');
         bar.removeEventListener('pointermove', move);
         bar.removeEventListener('pointerup', up);
         bar.removeEventListener('pointercancel', up);
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
      bar.addEventListener('pointercancel', up);
   }

   ngOnDestroy(): void {
      for (const u of this.urls) URL.revokeObjectURL(u);
      if (this.underUrl) URL.revokeObjectURL(this.underUrl);
   }
}
