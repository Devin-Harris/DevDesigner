import {
   ChangeDetectionStrategy,
   Component,
   ElementRef,
   computed,
   effect,
   inject,
   input,
   output,
   signal,
   viewChild,
} from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { IconComponent } from '../../../shared/ui/components/icon/icon.component';
import { ThemeService } from '../../../core/theme/theme.service';

/** A simplified world-space footprint of one canvas element. */
export interface MinimapItem {
   kind: 'table' | 'sequence' | 'shape' | 'frame' | 'text' | 'line';
   x0: number;
   y0: number;
   x1: number;
   y1: number;
   /** Absolute world points for line/arrow/freehand items. */
   points?: { x: number; y: number }[];
}

export interface MinimapView {
   x0: number;
   y0: number;
   x1: number;
   y1: number;
}

const WIDTH = 200;
const HEIGHT = 140;
const PAD_FRACTION = 0.08;
const COLLAPSED_KEY = 'dd-minimap-collapsed';

function readCollapsed(): boolean {
   try {
      return globalThis.localStorage?.getItem(COLLAPSED_KEY) === '1';
   } catch {
      return false;
   }
}

/**
 * Bottom-right overview of the whole project. Draws every element as a filled
 * rectangle / line scaled to the project's bounding box (plus the visible area,
 * so the viewport rectangle is always on screen). Click or drag to pan the main
 * canvas; the redraw is coalesced to one per animation frame.
 */
@Component({
   selector: 'dd-minimap',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [MatTooltipModule, IconComponent],
   templateUrl: './minimap.component.html',
   styleUrl: './minimap.component.scss',
})
export class MinimapComponent {
   readonly items = input.required<MinimapItem[]>();
   /** The visible canvas area in world coordinates. */
   readonly view = input.required<MinimapView>();
   /** Emits the world point that should become the center of the canvas. */
   readonly panTo = output<{ x: number; y: number }>();

   protected readonly width = WIDTH;
   protected readonly height = HEIGHT;
   protected readonly collapsed = signal(readCollapsed());

   private readonly cv = viewChild<ElementRef<HTMLCanvasElement>>('cv');
   private readonly theme = inject(ThemeService);
   private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
   /** Theme colors for the canvas drawing, re-read only when the theme changes (not per redraw). */
   private readonly colors$ = computed(() => {
      this.theme.themeChanged$();
      const style = getComputedStyle(this.host.nativeElement);
      const css = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
      return {
         tableFill: css('--dd-node-header', '#f4f2ec'),
         tableStroke: css('--dd-border-strong', '#d6d1c5'),
         seq: css('--dd-teal', '#0f8f86'),
         muted: css('--dd-text-muted', '#767b86'),
         faint: css('--dd-faint', '#a6a9b0'),
         primary: css('--dd-primary', '#3b5bdb'),
      };
   });

   /** World bounds currently mapped onto the canvas. Frozen while dragging. */
   private bounds: MinimapView = { x0: 0, y0: 0, x1: WIDTH, y1: HEIGHT };
   private scale = 1;
   private offsetX = 0;
   private offsetY = 0;
   private frozen: MinimapView | null = null;
   private dragging = false;
   private grabDx = 0;
   private grabDy = 0;
   private raf = 0;

   constructor() {
      effect((onCleanup) => {
         // Track every input that affects the picture, then coalesce to one frame.
         this.items();
         this.view();
         this.colors$();
         this.collapsed();
         this.cv();
         cancelAnimationFrame(this.raf);
         this.raf = requestAnimationFrame(() => this.draw());
         onCleanup(() => cancelAnimationFrame(this.raf));
      });
   }

   protected toggle(): void {
      const next = !this.collapsed();
      this.collapsed.set(next);
      try {
         globalThis.localStorage?.setItem(COLLAPSED_KEY, next ? '1' : '0');
      } catch {
         // ignore storage errors
      }
   }

   private computeBounds(): MinimapView {
      let { x0, y0, x1, y1 } = this.view();
      for (const it of this.items()) {
         x0 = Math.min(x0, it.x0);
         y0 = Math.min(y0, it.y0);
         x1 = Math.max(x1, it.x1);
         y1 = Math.max(y1, it.y1);
      }
      const padX = (x1 - x0) * PAD_FRACTION;
      const padY = (y1 - y0) * PAD_FRACTION;
      return { x0: x0 - padX, y0: y0 - padY, x1: x1 + padX, y1: y1 + padY };
   }

   private draw(): void {
      const canvas = this.cv()?.nativeElement;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) {
         return;
      }
      const dpr = globalThis.devicePixelRatio || 1;
      if (canvas.width !== WIDTH * dpr || canvas.height !== HEIGHT * dpr) {
         canvas.width = WIDTH * dpr;
         canvas.height = HEIGHT * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, WIDTH, HEIGHT);

      const b = this.frozen ?? this.computeBounds();
      this.bounds = b;
      const bw = Math.max(1, b.x1 - b.x0);
      const bh = Math.max(1, b.y1 - b.y0);
      this.scale = Math.min(WIDTH / bw, HEIGHT / bh);
      this.offsetX = (WIDTH - bw * this.scale) / 2;
      this.offsetY = (HEIGHT - bh * this.scale) / 2;

      const { tableFill, tableStroke, seq, muted, faint, primary } = this.colors$();

      const sx = (x: number): number => (x - b.x0) * this.scale + this.offsetX;
      const sy = (y: number): number => (y - b.y0) * this.scale + this.offsetY;
      const rect = (it: MinimapItem): [number, number, number, number] => [
         sx(it.x0),
         sy(it.y0),
         Math.max(1.5, (it.x1 - it.x0) * this.scale),
         Math.max(1.5, (it.y1 - it.y0) * this.scale),
      ];

      ctx.lineWidth = 1;
      for (const it of this.items()) {
         switch (it.kind) {
            case 'frame':
               ctx.strokeStyle = faint;
               ctx.setLineDash([3, 2]);
               ctx.strokeRect(...rect(it));
               ctx.setLineDash([]);
               break;
            case 'sequence':
               ctx.fillStyle = seq;
               ctx.globalAlpha = 0.22;
               ctx.fillRect(...rect(it));
               ctx.globalAlpha = 1;
               ctx.strokeStyle = seq;
               ctx.strokeRect(...rect(it));
               break;
            case 'table':
               ctx.fillStyle = tableFill;
               ctx.fillRect(...rect(it));
               ctx.strokeStyle = tableStroke;
               ctx.strokeRect(...rect(it));
               break;
            case 'text':
               ctx.fillStyle = muted;
               ctx.globalAlpha = 0.55;
               ctx.fillRect(...rect(it));
               ctx.globalAlpha = 1;
               break;
            case 'line': {
               const pts = it.points ?? [];
               if (pts.length < 2) {
                  break;
               }
               ctx.strokeStyle = muted;
               ctx.beginPath();
               // Freehand strokes can have thousands of points; sample them.
               const step = Math.max(1, Math.floor(pts.length / 60));
               ctx.moveTo(sx(pts[0].x), sy(pts[0].y));
               for (let i = step; i < pts.length; i += step) {
                  ctx.lineTo(sx(pts[i].x), sy(pts[i].y));
               }
               ctx.lineTo(sx(pts[pts.length - 1].x), sy(pts[pts.length - 1].y));
               ctx.stroke();
               break;
            }
            default:
               ctx.strokeStyle = muted;
               ctx.strokeRect(...rect(it));
         }
      }

      // Visible-area rectangle.
      const v = this.view();
      const vx = sx(v.x0);
      const vy = sy(v.y0);
      const vw = (v.x1 - v.x0) * this.scale;
      const vh = (v.y1 - v.y0) * this.scale;
      ctx.fillStyle = primary;
      ctx.globalAlpha = 0.12;
      ctx.fillRect(vx, vy, vw, vh);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = primary;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(vx, vy, vw, vh);
   }

   /** Minimap pixel -> world coordinates. */
   private toWorld(ev: PointerEvent): { x: number; y: number } {
      const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      return {
         x: (ev.clientX - r.left - this.offsetX) / this.scale + this.bounds.x0,
         y: (ev.clientY - r.top - this.offsetY) / this.scale + this.bounds.y0,
      };
   }

   protected onDown(ev: PointerEvent): void {
      ev.preventDefault();
      ev.stopPropagation();
      (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
      const p = this.toWorld(ev);
      const v = this.view();
      const inside = p.x >= v.x0 && p.x <= v.x1 && p.y >= v.y0 && p.y <= v.y1;
      // Grabbing inside the viewport rectangle drags it by the grab point; a click
      // elsewhere recenters on the click and keeps dragging from there.
      const cx = (v.x0 + v.x1) / 2;
      const cy = (v.y0 + v.y1) / 2;
      this.grabDx = inside ? cx - p.x : 0;
      this.grabDy = inside ? cy - p.y : 0;
      // Keep the mapping stable while dragging so the picture doesn't rescale under the cursor.
      this.frozen = this.bounds;
      this.dragging = true;
      this.panTo.emit({ x: p.x + this.grabDx, y: p.y + this.grabDy });
   }

   protected onMove(ev: PointerEvent): void {
      if (!this.dragging) {
         return;
      }
      const p = this.toWorld(ev);
      this.panTo.emit({ x: p.x + this.grabDx, y: p.y + this.grabDy });
   }

   protected onUp(ev: PointerEvent): void {
      if (!this.dragging) {
         return;
      }
      this.dragging = false;
      this.frozen = null;
      (ev.currentTarget as HTMLElement).releasePointerCapture?.(ev.pointerId);
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(() => this.draw());
   }
}
