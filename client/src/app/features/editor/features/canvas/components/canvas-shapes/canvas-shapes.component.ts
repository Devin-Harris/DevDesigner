import { EmbedSnapshotsService } from '../../../../services/embed-snapshots.service';
import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import { EditorViewportService } from '../../../../services/editor-viewport.service';
import { FrameScrollService } from '../../../../services/frame-scroll.service';
import { CanvasContent } from '../../services/canvas-content.service';
import { CodeActionsService } from '../../../../services/code-actions.service';
import { ElementImagesService } from '../../../../services/element-images.service';
import type { ArrowheadType, CanvasElementModel } from '@devdesigner/shared';
import { GridTableService } from '../../../../services/grid-table.service';
import type { CodeDotAction, GridTableView, ImageView, ShapeView } from '../../../../models/shape-view.model';
import { MediaVideoComponent } from '../../../../shared/components/media-video/media-video.component';
import { MediaActionsService } from '../../../../services/media-actions.service';
import { EmbedFramesService } from '../../../../services/embed-frames.service';
import { EmbedUrlBarComponent } from '../../../../shared/components/embed-frame/embed-url-bar.component';
import { EmbedFrameComponent } from '../../../../shared/components/embed-frame/embed-frame.component';
import { FRAME_TITLE_H, FRAME_TITLE_W } from '../../../../helpers/element-geometry.helper';
import { CODE_FONT_SIZE, codeLineMark } from '../../../../helpers/render';
import { CallPipe, AtPipe, HasPipe } from '../../../../../../shared/ui/pipes/collection.pipes';
import { ImageKindPipe, ImagePosterPipe, ImageUrlPipe } from '../../../../../../features/editor/shared/pipes/element-image.pipes';
import type { MediaKind } from '../../../../../../features/editor/services/element-images.service';

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
   /** Elbow lines: which route segment was grabbed. */
   segment?: number;
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
      '[style.z-index]': "layer$() === 'lines' ? 1000 : layer$() === 'content' ? (hostZ$() ?? 10) : null",
   },
   imports: [AtPipe, HasPipe, ImageKindPipe, ImagePosterPipe, ImageUrlPipe, CallPipe, MediaVideoComponent, EmbedFrameComponent, EmbedUrlBarComponent],
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
   readonly layer$ = input<'all' | 'frames' | 'content' | 'lines'>('all', { alias: 'layer' });
   /** Content layer only: this instance's z-index (slots between sequence diagrams). */
   readonly hostZ$ = input<number | null>(null, { alias: 'hostZ' });
   /** Content layer only: which elements this instance draws (a slice between diagrams). */
   readonly accept = input<((id: string) => boolean) | null>(null);
   readonly visible$ = computed(() => {
      const layer = this.layer$();
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
   readonly svgOffset$ = input.required<number>({ alias: 'svgOffset' });
   readonly dragging$ = input<boolean>(false, { alias: 'dragging' });
   readonly interactive$ = input<boolean>(true, { alias: 'interactive' });
   /** Id of the text element being edited inline, so its SVG text + selection box are hidden (the textarea owns it). */
   readonly editingId$ = input<string | null>(null, { alias: 'editingId' });

   /** World-space bounding box of a shape/table being hovered as a binding target. */
   readonly bindHighlight$ = input<readonly { x: number; y: number; width: number; height: number }[]>([], { alias: 'bindHighlight' });

   protected readonly images = inject(ElementImagesService);
   private readonly codeActions = inject(CodeActionsService);
   private readonly grids = inject(GridTableService);
   protected readonly content = inject(CanvasContent);
   protected readonly embeds = inject(EmbedFramesService);
   private readonly frameScroll = inject(FrameScrollService);
   private readonly hostRef = inject<ElementRef<HTMLElement>>(ElementRef);
   private readonly viewport = inject(EditorViewportService, { optional: true });
   /** Shift for an item held by a scrollable frame (its frame's scroll). */
   protected readonly scrollTransformOf$ = this.frameScroll.transformOf$;
   protected readonly scrollBars$ = this.frameScroll.bars$;
   protected readonly paddingHandles$ = computed(() => {
      const h = this.frameScroll.paddingHandles$();
      if (!h || !this.interactive$()) return null;
      const layer = this.layer$();
      // Drawn above the frame's content by the top layer of whichever view holds the frame
      // (the canvas, or a shown slide's block).
      if (layer !== 'lines' && layer !== 'all') return null;
      return this.shapes().some((s) => s.id === h.id) ? h : null;
   });
   protected dragPadding(side: 'n' | 's' | 'e' | 'w', event: PointerEvent): void {
      if (event.button !== 0) return;
      this.frameScroll.dragPadding(side, event);
   }
   protected gripHover(on: boolean): void {
      this.frameScroll.gripHover$.set(on);
   }
   protected dragScrollThumb(axis: 'v' | 'h', event: PointerEvent): void {
      this.frameScroll.dragThumb(axis, event);
   }
   protected readonly visibleIds$ = computed(() => new Set(this.visible$().map((s) => s.id)));

   /**
    * Red squiggles under every line the last Format could not handle (each until that
    * side's code changes), drawn by the layer that draws the code block.
    */
   protected readonly formatErrorMarks$ = computed(() => {
      if (!this.interactive$()) return [];
      const shown = new Set(this.visible$().map((s) => s.id));
      const out: { d: string; width: number }[] = [];
      for (const err of this.codeActions.formatErrors()) {
         if (!shown.has(err.id)) continue;
         const el = this.content.elements().find((e) => e.id === err.id);
         if (el?.type !== 'code') continue;
         const source = err.side === 'modified' ? el.diffText : el.text;
         if ((source ?? '') !== err.source) continue;
         const squiggle = this.squiggle(el, err.side, err.line, err.column);
         if (squiggle) out.push(squiggle);
      }
      return out;
   });

   private squiggle(
      el: CanvasElementModel,
      side: 'original' | 'modified',
      line: number,
      column: number | undefined
   ): { d: string; width: number } | null {
      const mark = codeLineMark(el, side, line, column);
      if (!mark) return null;
      const fontSize = el.fontSize ?? CODE_FONT_SIZE;
      const y = mark.y + fontSize * 0.3;
      const step = Math.max(2, fontSize * 0.22);
      let d = `M${mark.x},${y}`;
      for (let x = mark.x, up = true; x < mark.x + mark.width; x += step, up = !up) {
         d += ` L${Math.min(x + step, mark.x + mark.width)},${y + (up ? -step / 2 : step / 2)}`;
      }
      return { d, width: Math.max(1, fontSize / 12) };
   }

   /** The picture under the pointer (GIFs set to play on hover animate while hovered). */
   protected readonly hoveredId = signal<string | null>(null);
   /** The picture being cropped inline (the crop overlay draws it instead). */
   protected readonly croppingId$ = inject(MediaActionsService).croppingId;

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
   readonly bendReset = output<string>();

   /**
    * What an image element draws: the file, except a GIF stays on its first frame
    * until its playback says go (auto = always; hover = while hovered; click = while
    * selected, the canvas stand-in for a click).
    */
   /** Picture to show: a GIF plays (or shows its first frame) by its playback setting. */
   protected readonly pictureSrc$ = computed(() => {
      const hovered = this.hoveredId();
      return (
         id: string,
         img: ImageView,
         selected: boolean,
         kind: MediaKind | null,
         url: string | null,
         poster: string | null
      ): string | null => {
         if (kind !== 'gif') return url;
         const playback = img.playback ?? 'click';
         const playing = playback === 'auto' || (playback === 'hover' ? hovered === id : selected);
         return playing ? url : poster;
      };
   });

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
      if (!el || !ctm || !this.content.canEdit$()) {
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
      if (!this.content.canEdit$()) {
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
   /** The selected cell range of a grid table, in its own coordinates (null when none). */
   protected readonly cellRangeRect$ = computed(() => {
      const r = this.grids.range();
      const interactive = this.interactive$();
      return (id: string, g: GridTableView): { x: number; y: number; width: number; height: number } | null => {
         if (!r || r.id !== id || !interactive) {
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
      };
   });

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
      // Outside the frame clipping it the item is not drawn, so it is not there to grab:
      // let the press fall through to the canvas (or whatever lies beneath).
      if (this.outsideClip(id, event)) return;
      event.stopPropagation();
      this.frameScroll.pin();
      this.elementPointerDown.emit({ id, event });
   }

   /** The pointer lies outside the clip of the frame holding this item. */
   private outsideClip(id: string, event: PointerEvent): boolean {
      const view = this.visible$().find((s) => s.id === id);
      if (!view?.frameClip) return false;
      // The editor's own screen -> world mapping (follows zoom, pan and zoomed slides).
      if (this.viewport) {
         return this.frameScroll.clippedAt(id, this.viewport.toWorld(event.clientX, event.clientY));
      }
      const svg = this.hostRef.nativeElement.querySelector<SVGSVGElement>(':scope > svg');
      const ctm = svg?.getScreenCTM();
      if (!ctm) return false;
      const pt = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
      const off = this.svgOffset$();
      return this.frameScroll.clippedAt(id, { x: pt.x - off, y: pt.y - off });
   }

   /** Length of a side's grab strip: the side minus room for the corner handles. */
   protected edgeLen(side: number): number {
      return Math.max(0, side - 12);
   }

   protected onResize(id: string, handle: ResizeHandle, event: PointerEvent): void {
      event.stopPropagation();
      event.preventDefault();
      this.frameScroll.pin();
      this.resizeDown.emit({ id, handle, event });
   }

   protected onRotate(id: string, event: PointerEvent): void {
      event.stopPropagation();
      event.preventDefault();
      this.rotateDown.emit({ id, event });
   }

   protected onBend(id: string, event: PointerEvent, segment?: number): void {
      event.stopPropagation();
      event.preventDefault();
      this.bendDown.emit({ id, event, segment });
   }

   /** Double-click an elbow handle: drop the hand-placed bends. */
   protected onBendReset(id: string, event: MouseEvent): void {
      event.stopPropagation();
      event.preventDefault();
      this.bendReset.emit(id);
   }

   protected onEndpoint(id: string, which: 'start' | 'end', event: PointerEvent): void {
      event.stopPropagation();
      event.preventDefault();
      this.endpointDown.emit({ id, which, event });
   }
}
