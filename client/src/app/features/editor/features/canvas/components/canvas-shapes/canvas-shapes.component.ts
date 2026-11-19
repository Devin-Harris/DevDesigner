import { EmbedSnapshotsService } from '../../../../services/embed-snapshots.service';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { CanvasContent } from '../../services/canvas-content.service';
import { CodeActionsService } from '../../../../services/code-actions.service';
import { ElementImagesService } from '../../../../services/element-images.service';
import type { ArrowheadType } from '@devdesigner/shared';
import { GridTableService } from '../../../../services/grid-table.service';
import type { CodeDotAction, GridTableView, ImageView, ShapeView } from '../../../../models/shape-view.model';
import { MediaVideoComponent } from '../../../../shared/components/media-video/media-video.component';
import { MediaActionsService } from '../../../../services/media-actions.service';
import { EmbedFramesService } from '../../../../services/embed-frames.service';
import { EmbedUrlBarComponent } from '../../../../shared/components/embed-frame/embed-url-bar.component';
import { EmbedFrameComponent } from '../../../../shared/components/embed-frame/embed-frame.component';
import { FRAME_TITLE_H, FRAME_TITLE_W } from '../../../../helpers/element-geometry.helper';

/** Corner used to resize a shape's bounding box. */
export type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';

export interface ShapePointerEvent {
   id: string;
   event: PointerEvent;
}
export interface ResizeDownEvent {
   id: string;
   handle: ResizeHandle;
   event: PointerEvent;
}
export interface ShapeBendEvent {
   id: string;
   event: PointerEvent;
}
export interface ShapeEndpointEvent {
   id: string;
   which: 'start' | 'end';
   event: PointerEvent;
}

/**
 * SVG layer that draws the free-form canvas elements (shapes, lines/arrows,
 * freehand strokes, text) and, for the selected element, its selection outline
 * plus resize/rotate handles (shapes) or endpoint handles (lines/arrows). Purely
 * presentational: it emits intent and the editor mutates the store, mirroring the
 * connectors layer. Offset by svgOffset so negative coordinates are drawable.
 */
@Component({
   selector: 'dd-canvas-shapes',
   changeDetection: ChangeDetectionStrategy.OnPush,
   // Stacking inside the world: content slices + sequence diagrams interleave in
   // 10..299 (set by the editor), table nodes are 400, diagrams brought above every
   // element 401+, and lines/arrows clear them all.
   host: {
      '[style.z-index]': "layer() === 'lines' ? 1000 : layer() === 'content' ? (hostZ() ?? 10) : null",
   },
   imports: [MediaVideoComponent, EmbedFrameComponent, EmbedUrlBarComponent],
   templateUrl: './canvas-shapes.component.html',
   styleUrl: './canvas-shapes.component.scss',
})
export class CanvasShapesComponent {
   readonly shapes = input.required<ShapeView[]>();
   /**
    * Which elements this layer draws: frames sit below connectors, lines/arrows sit
    * above everything (tables and sequence diagrams, so they can anchor to message
    * labels), and the rest sits between.
    */
   readonly layer = input<'all' | 'frames' | 'content' | 'lines'>('all');
   /** Content layer only: this instance's z-index (slots between sequence diagrams). */
   readonly hostZ = input<number | null>(null);
   /** Content layer only: which elements this instance draws (a slice between diagrams). */
   readonly accept = input<((id: string) => boolean) | null>(null);
   readonly visible = computed(() => {
      const layer = this.layer();
      const all = this.shapes();
      if (layer === 'all') {
         return all;
      }
      const kind = (s: ShapeView): 'frames' | 'lines' | 'content' =>
         s.type === 'frame' ? 'frames' : s.type === 'line' || s.type === 'arrow' ? 'lines' : 'content';
      const inLayer = all.filter((s) => kind(s) === layer);
      const accept = this.accept();
      return accept ? inLayer.filter((s) => accept(s.id)) : inLayer;
   });
   readonly svgOffset = input.required<number>();
   readonly dragging = input<boolean>(false);
   readonly interactive = input<boolean>(true);
   /** Id of the text element being edited inline, so its SVG text + selection box are hidden (the textarea owns it). */
   readonly editingId = input<string | null>(null);

   /** World-space bounding box of a shape/table being hovered as a binding target. */
   readonly bindHighlight = input<{ x: number; y: number; width: number; height: number } | null>(null);

   protected readonly images = inject(ElementImagesService);
   private readonly codeActions = inject(CodeActionsService);
   private readonly grids = inject(GridTableService);
   protected readonly content = inject(CanvasContent);
   protected readonly embeds = inject(EmbedFramesService);

   /** The picture under the pointer (GIFs set to play on hover animate while hovered). */
   protected readonly hoveredId = signal<string | null>(null);
   /** The picture being cropped inline (the crop overlay draws it instead). */
   protected readonly croppingId = inject(MediaActionsService).croppingId;

   /** A live frame's address was typed in: save it (the page loads from the new value). */
   protected readonly snapshots = inject(EmbedSnapshotsService);

   protected commitEmbedUrl(id: string, url: string): void {
      void this.content.updateElement(id, { text: url });
   }

   protected readonly frameTitleW = FRAME_TITLE_W;
   protected readonly frameTitleH = FRAME_TITLE_H;

   readonly elementPointerDown = output<ShapePointerEvent>();
   readonly resizeDown = output<ResizeDownEvent>();
   readonly rotateDown = output<ShapePointerEvent>();
   readonly endpointDown = output<ShapeEndpointEvent>();
   readonly bendDown = output<ShapeBendEvent>();

   /**
    * What an image element draws: the file, except a GIF stays on its first frame
    * until its playback says go (auto = always; hover = while hovered; click = while
    * selected, the canvas stand-in for a click).
    */
   protected pictureHref(id: string, img: ImageView, selected: boolean): string | null {
      const url = this.images.url(img.fileId);
      if (this.images.kind(img.fileId) !== 'gif') {
         return url;
      }
      const playback = img.playback ?? 'click';
      const playing = playback === 'auto' || (playback === 'hover' ? this.hoveredId() === id : selected);
      return playing ? url : (this.images.posterUrl(img.fileId) ?? null);
   }

   /** SVG marker url for an arrowhead type, or null for 'none'. */
   protected markerUrl(type: ArrowheadType): string | null {
      return type === 'none' ? null : `url(#dd-ah-${type})`;
   }

   /** Drag a split diff's middle rule: sets the left side's share of the card's width. */
   protected onDiffDivider(id: string, event: PointerEvent): void {
      if (event.button !== 0) {
         return;
      }
      event.stopPropagation();
      event.preventDefault();
      const el = this.content.elements().find((e) => e.id === id);
      const ctm = (event.target as SVGGraphicsElement).getScreenCTM()?.inverse();
      if (!el || !ctm || !this.content.canEdit()) {
         return;
      }
      const start = el.diffSplit;
      let split = start;
      const move = (e: PointerEvent): void => {
         const x = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm).x;
         split = Math.round(Math.min(0.85, Math.max(0.15, (x - el.x) / el.width)) * 1000) / 1000;
         this.content.patchElementLocal(id, { diffSplit: split });
      };
      const up = (): void => {
         window.removeEventListener('pointermove', move);
         window.removeEventListener('pointerup', up);
         if (split !== start && split != null) {
            void this.content.updateElement(id, { diffSplit: split });
         }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
   }

   /** A control dot on a code block's title bar. */
   protected onDot(action: CodeDotAction, id: string, event: PointerEvent): void {
      if (event.button !== 0) {
         return;
      }
      event.stopPropagation();
      event.preventDefault();
      if (!this.content.canEdit()) {
         return;
      }
      switch (action) {
         case 'delete':
            void this.content.deleteElement(id);
            break;
         case 'collapse':
            void this.codeActions.toggleCollapsed(id);
            break;
         case 'fit':
            void this.codeActions.fitToContent([id]);
            break;
      }
   }

   /** World box of the selected cell block, when it belongs to this (selected) grid. */
   protected cellRangeRect(
      id: string,
      g: GridTableView
   ): { x: number; y: number; width: number; height: number } | null {
      const r = this.grids.range();
      if (!r || r.id !== id || !this.interactive()) {
         return null;
      }
      const x0 = g.colEdges[r.c0];
      const x1 = g.colEdges[r.c1 + 1];
      const y0 = g.rowEdges[r.r0];
      const y1 = g.rowEdges[r.r1 + 1];
      if (x1 === undefined || y1 === undefined) {
         return null;
      }
      return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
   }

   protected onGridBorder(id: string, axis: 'col' | 'row', index: number, event: PointerEvent): void {
      if (event.button !== 0) {
         return;
      }
      event.stopPropagation();
      event.preventDefault();
      this.grids.beginBorderDrag(id, axis, index, event);
   }

   protected onGridBorderFit(id: string, axis: 'col' | 'row', index: number, event: MouseEvent): void {
      event.stopPropagation();
      event.preventDefault();
      this.grids.autoFit(id, axis, index);
   }

   protected onGridFitAll(id: string, event: MouseEvent): void {
      event.stopPropagation();
      event.preventDefault();
      this.grids.autoFitAll(id);
   }

   protected onBody(id: string, event: PointerEvent): void {
      if (event.button !== 0) {
         return;
      }
      event.stopPropagation();
      this.elementPointerDown.emit({ id, event });
   }

   /** Length of a side's grab strip: the side minus room for the corner handles. */
   protected edgeLen(side: number): number {
      return Math.max(0, side - 12);
   }

   protected onResize(id: string, handle: ResizeHandle, event: PointerEvent): void {
      event.stopPropagation();
      event.preventDefault();
      this.resizeDown.emit({ id, handle, event });
   }

   protected onRotate(id: string, event: PointerEvent): void {
      event.stopPropagation();
      event.preventDefault();
      this.rotateDown.emit({ id, event });
   }

   protected onBend(id: string, event: PointerEvent): void {
      event.stopPropagation();
      event.preventDefault();
      this.bendDown.emit({ id, event });
   }

   protected onEndpoint(id: string, which: 'start' | 'end', event: PointerEvent): void {
      event.stopPropagation();
      event.preventDefault();
      this.endpointDown.emit({ id, which, event });
   }
}
