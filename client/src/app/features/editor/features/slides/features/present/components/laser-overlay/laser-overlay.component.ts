import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input } from '@angular/core';
import { LOCAL_LASER, LaserService } from '../../../../../../../../core/realtime/laser.service';
import { RealtimeService } from '../../../../../../../../core/realtime/realtime.service';
import type { RenderedSlide } from '../../../../services/slide-render.service';
import { StopClicksDirective } from '../../../../../../../../shared/ui/directives/stop-clicks.directive';

type Point = { x: number; y: number };

/**
 * Laser trails over the shown slide (ours and collaborators', from canvas space), and,
 * while `capturing`, a layer that turns dragging on the slide into our own laser.
 */
@Component({
   selector: 'dd-laser-overlay',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [StopClicksDirective],
   templateUrl: './laser-overlay.component.html',
   styleUrl: './laser-overlay.component.scss',
})
export class LaserOverlayComponent {
   /** The slide on screen. */
   readonly slide = input<RenderedSlide | undefined>(undefined);
   /** The element the slide is fitted into. */
   readonly stage = input.required<HTMLElement>();
   /** Dragging draws our laser. */
   readonly capturing = input(false);
   /** Changes whenever the stage resizes (trails are re-mapped). */
   readonly layoutTick = input<unknown>(0);

   private readonly realtime = inject(RealtimeService);
   private readonly laser = inject(LaserService);
   private pointer: number | null = null;
   private lastSent = 0;

   protected readonly trails = computed(() => {
      this.layoutTick();
      const slide = this.slide();
      const views = this.laser.views();
      if (!slide || !views.length) return [];
      const to = (p: Point): Point => this.toScreen(slide, p);
      return views.map((view) => {
         const pts = view.points.map((p) => ({ ...to(p), age: p.age, start: p.start }));
         const segments = [];
         for (let i = 1; i < pts.length; i += 1) {
            if (pts[i].start) continue;
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

   constructor() {
      inject(DestroyRef).onDestroy(() => {
         if (this.pointer !== null) {
            this.laser.release(LOCAL_LASER);
            this.realtime.sendLaser(0, 0, true);
         }
      });
   }

   /** How the slide is fitted into the stage: scale and offset. */
   private fit(slide: RenderedSlide): { r: DOMRect; s: number; ox: number; oy: number } {
      const r = this.stage().getBoundingClientRect();
      const s = Math.min(r.width / slide.width, r.height / slide.height);
      return { r, s, ox: (r.width - slide.width * s) / 2, oy: (r.height - slide.height * s) / 2 };
   }

   /** Where a canvas-space point lands on screen. */
   private toScreen(slide: RenderedSlide, p: Point): Point {
      const { s, ox, oy } = this.fit(slide);
      return { x: ox + (p.x - slide.originX) * s, y: oy + (p.y - slide.originY) * s };
   }

   private toCanvas(clientX: number, clientY: number): Point | null {
      const slide = this.slide();
      if (!slide) return null;
      const { r, s, ox, oy } = this.fit(slide);
      return { x: slide.originX + (clientX - r.left - ox) / s, y: slide.originY + (clientY - r.top - oy) / s };
   }

   protected onDown(event: PointerEvent): void {
      event.preventDefault();
      event.stopPropagation();
      try {
         (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      } catch {
         /* synthetic pointers can refuse capture */
      }
      this.pointer = event.pointerId;
      this.sample(event, true);
   }

   protected onMove(event: PointerEvent): void {
      if (this.pointer === event.pointerId) this.sample(event, false);
   }

   protected onUp(event: PointerEvent): void {
      if (this.pointer !== event.pointerId) return;
      event.stopPropagation();
      const w = this.toCanvas(event.clientX, event.clientY);
      this.pointer = null;
      this.laser.release(LOCAL_LASER);
      if (w) this.realtime.sendLaser(w.x, w.y, true);
   }

   private sample(event: PointerEvent, force: boolean): void {
      const w = this.toCanvas(event.clientX, event.clientY);
      if (!w) return;
      this.laser.add(LOCAL_LASER, w.x, w.y);
      const now = Date.now();
      if (!force && now - this.lastSent < 33) return;
      this.lastSent = now;
      if (this.realtime.hasPeers()) this.realtime.sendLaser(w.x, w.y);
   }
}
