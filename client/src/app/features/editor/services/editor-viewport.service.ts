import { DestroyRef, ElementRef, computed, inject, signal, Injectable, type Signal } from '@angular/core';
import { presentationOf, type SequenceDiagramModel } from '@devdesigner/shared';
import { inBlock, type SlideView, toInner } from '../helpers/slide-zoom.helper';
import { ProjectStore } from '../state/project/project.store';
import { MAX_ZOOM, MIN_ZOOM } from '../shared/constants/canvas.constants';
import { elementBox, tableBox } from '../helpers/element-geometry.helper';
import type { Box, Rect } from '../models/geometry.model';
/** What the viewport reads from the rest of the editor; the editor entry wires it with `connect`. */
export interface ViewportHost {
   readonly canvasRef: Signal<ElementRef<HTMLElement>>;
   /** Focus mode locks the view to its deck. */
   readonly focusedDeck: Signal<string | null>;
   readonly presentation: Signal<unknown>;
   /** Slides drawn zoomed inside their blocks (screen points over them map into the slide). */
   readonly slideViews: Signal<SlideView[]>;
   /** World footprint of everything on the canvas (zoom to fit). */
   readonly minimapItems: Signal<readonly Box[]>;
   drawnBox(id: string, box: Box): Box;
   diagramBox(d: SequenceDiagramModel): Rect | null;
}

/**
 * The canvas viewport: screen <-> world mapping, wheel zoom, zoom buttons, fit/selection zoom,
 * the home view and animated view changes.
 */
@Injectable()
export class EditorViewportService {
   private readonly store = inject(ProjectStore);
   private readonly destroyRef = inject(DestroyRef);
   private host!: ViewportHost;

   connect(host: ViewportHost): void {
      this.host = host;
   }

   readonly worldTransform = computed(() => {
      const v = this.store.viewport();
      return `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
   });

   readonly zoomLabel = computed(() => `${Math.round(this.store.viewport().zoom * 100)}%`);

   canvasRect(): DOMRect {
      return this.host.canvasRef().nativeElement.getBoundingClientRect();
   }

   /**
    * Screen -> world. Over a zoomed-out slide this is the slide's own coordinates (what
    * is drawn under the pointer there), so drawing, dropping and picking work inside it.
    */
   toWorld(clientX: number, clientY: number): { x: number; y: number } {
      const p = this.toWorldRaw(clientX, clientY);
      const view = this.host.slideViews().find((v) => inBlock(v, p));
      this.store.setPointerSlide(view?.frameId ?? null);
      return view ? toInner(view, p) : p;
   }

   /** Screen -> canvas world, ignoring slide zoom. */
   toWorldRaw(clientX: number, clientY: number): { x: number; y: number } {
      const rect = this.canvasRect();
      const v = this.store.viewport();
      return { x: (clientX - rect.left - v.x) / v.zoom, y: (clientY - rect.top - v.y) / v.zoom };
   }

   /** Public screen→world mapping for the sequence layer's drag-connect. */
   readonly toWorldPoint = (clientX: number, clientY: number): { x: number; y: number } =>
      this.toWorld(clientX, clientY);

   screenPoint(clientX: number, clientY: number): { x: number; y: number } {
      const rect = this.canvasRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
   }

   onWheel(event: WheelEvent): void {
      event.preventDefault();
      // Focus mode locks the view to the presentation (leave it to move around).
      if (this.host.focusedDeck() && !event.ctrlKey) return;
      const rect = this.canvasRect();
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      // Ctrl + scroll over a shown slide zooms that slide inside its block (the block keeps
      // its size), revealing the staging room around the frame. View state only.
      if (event.ctrlKey && !this.host.presentation()) {
         const p = this.toWorldRaw(event.clientX, event.clientY);
         const shown = this.store.shownByPresentation();
         const frame = this.store
            .slideFrames()
            .find(
               (f) =>
                  shown.get(presentationOf(f)) === f.id &&
                  p.x >= f.x &&
                  p.x <= f.x + f.width &&
                  p.y >= f.y &&
                  p.y <= f.y + f.height
            );
         if (frame) {
            const name = presentationOf(frame);
            // Pinch / precision touchpads send small deltas: follow them smoothly.
            const step = Math.exp(-Math.max(-50, Math.min(50, event.deltaY)) * 0.004);
            this.store.setSlideZoom(name, (this.store.slideZoom()[name] ?? 1) * step);
            return;
         }
      }
      this.applyZoom(factor, event.clientX - rect.left, event.clientY - rect.top);
   }

   zoomIn(): void {
      const rect = this.canvasRect();
      this.applyZoom(1.2, rect.width / 2, rect.height / 2);
   }

   zoomOut(): void {
      const rect = this.canvasRect();
      this.applyZoom(1 / 1.2, rect.width / 2, rect.height / 2);
   }

   /** Animate back to the project's saved home view, or the default (origin, 100%). */
   resetView(): void {
      if (this.host.focusedDeck()) return;
      const home = this.store.home() ?? { x: 0, y: 0, zoom: 1 };
      this.animateViewport(home.x, home.y, home.zoom);
   }

   setHome(): void {
      if (!this.store.canEdit()) {
         return;
      }
      const v = this.store.viewport();
      void this.store.setHome({ x: v.x, y: v.y, zoom: v.zoom });
   }

   clearHome(): void {
      if (!this.store.canEdit()) {
         return;
      }
      void this.store.setHome(null);
   }

   /** Pan (keeping zoom) so the given world point is at the center of the canvas. */
   panToWorld(world: { x: number; y: number }): void {
      const rect = this.canvasRect();
      const v = this.store.viewport();
      this.store.setViewport(rect.width / 2 - world.x * v.zoom, rect.height / 2 - world.y * v.zoom, v.zoom);
   }

   private viewAnim = 0;

   /** Canvas pixel size, tracked so the minimap can show the visible world rectangle. */
   readonly canvasSize = signal({ width: 0, height: 0 });

   animateViewport(x: number, y: number, zoom: number): void {
      cancelAnimationFrame(this.viewAnim);
      const from = this.store.viewport();
      const projectId = this.store.projectId();
      const start = performance.now();
      const duration = 250;
      const step = (now: number): void => {
         // The store is app-wide: never write this view into another project or after teardown.
         if (this.destroyRef.destroyed || this.store.projectId() !== projectId) return;
         const t = Math.min(1, (now - start) / duration);
         const e = 1 - Math.pow(1 - t, 3);
         this.store.setViewport(
            from.x + (x - from.x) * e,
            from.y + (y - from.y) * e,
            from.zoom + (zoom - from.zoom) * e
         );
         if (t < 1) {
            this.viewAnim = requestAnimationFrame(step);
         }
      };
      this.viewAnim = requestAnimationFrame(step);
   }

   /** Animate the view so a world box fills the canvas (with a margin), capped at 200%. */
   private zoomToBox(b: Box | null): void {
      if (this.host.focusedDeck()) return;
      if (!b || !Number.isFinite(b.x0)) return;
      const rect = this.canvasRect();
      const margin = 80;
      const w = Math.max(b.x1 - b.x0, 1);
      const h = Math.max(b.y1 - b.y0, 1);
      const zoom = Math.max(0.05, Math.min((rect.width - margin * 2) / w, (rect.height - margin * 2) / h, 2));
      this.animateViewport(
         rect.width / 2 - ((b.x0 + b.x1) / 2) * zoom,
         rect.height / 2 - ((b.y0 + b.y1) / 2) * zoom,
         zoom
      );
   }

   /** Zoom so everything on the canvas is in view (Shift+1). */
   zoomToFit(): void {
      let x0 = Infinity,
         y0 = Infinity,
         x1 = -Infinity,
         y1 = -Infinity;
      for (const it of this.host.minimapItems()) {
         x0 = Math.min(x0, it.x0);
         y0 = Math.min(y0, it.y0);
         x1 = Math.max(x1, it.x1);
         y1 = Math.max(y1, it.y1);
      }
      this.zoomToBox(Number.isFinite(x0) ? { x0, y0, x1, y1 } : null);
   }

   /** Center all content without animating, at most 100%, leaving room for the left tool dock. */
   fitContent(): void {
      let x0 = Infinity,
         y0 = Infinity,
         x1 = -Infinity,
         y1 = -Infinity;
      for (const it of this.host.minimapItems()) {
         x0 = Math.min(x0, it.x0);
         y0 = Math.min(y0, it.y0);
         x1 = Math.max(x1, it.x1);
         y1 = Math.max(y1, it.y1);
      }
      if (!Number.isFinite(x0)) return;
      // Decks draw their slide list and settings panels beside the slide: leave room for them.
      if (this.store.elements().some((e) => e.type === 'frame' && e.slide)) {
         x0 -= 300;
         x1 += 300;
      }
      const rect = this.canvasRect();
      const dock = 72;
      const margin = 48;
      const availW = rect.width - dock - margin * 2;
      const availH = rect.height - margin * 2 - 56; // bottom view bar
      const zoom = Math.max(0.1, Math.min(availW / Math.max(x1 - x0, 1), availH / Math.max(y1 - y0, 1), 1));
      this.animateViewport(
         dock + margin + availW / 2 - ((x0 + x1) / 2) * zoom,
         margin + availH / 2 - ((y0 + y1) / 2) * zoom,
         zoom
      );
   }

   /** Zoom so the selection fills the view (Shift+2). */
   zoomToSelection(): void {
      const selected = new Set([
         ...this.store.selectedTableIds(),
         ...this.store.selectedElementIds(),
         ...this.store.selectedDiagramIds(),
      ]);
      if (!selected.size) return;
      let x0 = Infinity,
         y0 = Infinity,
         x1 = -Infinity,
         y1 = -Infinity;
      const grow = (b: Box): void => {
         x0 = Math.min(x0, b.x0);
         y0 = Math.min(y0, b.y0);
         x1 = Math.max(x1, b.x1);
         y1 = Math.max(y1, b.y1);
      };
      for (const t of this.store.tables()) if (selected.has(t.id)) grow(tableBox(t));
      for (const e of this.store.elements()) if (selected.has(e.id)) grow(this.host.drawnBox(e.id, elementBox(e)));
      for (const d of this.store.sequenceDiagrams()) {
         const b = selected.has(d.id) ? this.host.diagramBox(d) : null;
         if (b) grow({ x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY });
      }
      this.zoomToBox(Number.isFinite(x0) ? { x0, y0, x1, y1 } : null);
   }

   private applyZoom(factor: number, centerX: number, centerY: number): void {
      if (this.host.focusedDeck()) return;
      const v = this.store.viewport();
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      const worldX = (centerX - v.x) / v.zoom;
      const worldY = (centerY - v.y) / v.zoom;
      this.store.setViewport(centerX - worldX * newZoom, centerY - worldY * newZoom, newZoom);
   }
}
