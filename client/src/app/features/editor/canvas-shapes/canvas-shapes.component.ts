import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { ProjectStore } from '../../../stores/project.store';
import { CodeActionsService } from '../../../core/services/code-actions.service';
import { ElementImagesService } from '../../../core/services/element-images.service';
import type { ArrowheadType } from '@dbdesigner/shared';
import { GridTableService, type GridStructureAction } from '../../../core/services/grid-table.service';
import type { CodeDotAction, GridTableView, ShapeView } from '../canvas/models/shape-view.model';
import { FRAME_TITLE_H, FRAME_TITLE_W } from '../canvas/helpers/element-geometry.helper';

/** Corner used to resize a shape's bounding box. */
export type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se' | 'e' | 'w';

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
  selector: 'app-canvas-shapes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Stacking inside the world: content slices + sequence diagrams interleave in
  // 10..299 (set by the editor), table nodes are 400, diagrams brought above every
  // element 401+, and lines/arrows clear them all.
  host: {
    '[style.z-index]': "layer() === 'lines' ? 1000 : layer() === 'content' ? (hostZ() ?? 10) : null",
  },
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
  readonly bindHighlight = input<{ x: number; y: number; width: number; height: number } | null>(
    null,
  );

  protected readonly images = inject(ElementImagesService);
  private readonly codeActions = inject(CodeActionsService);
  private readonly grids = inject(GridTableService);
  private readonly store = inject(ProjectStore);

  protected readonly frameTitleW = FRAME_TITLE_W;
  protected readonly frameTitleH = FRAME_TITLE_H;

  readonly elementPointerDown = output<ShapePointerEvent>();
  readonly resizeDown = output<ResizeDownEvent>();
  readonly rotateDown = output<ShapePointerEvent>();
  readonly endpointDown = output<ShapeEndpointEvent>();
  readonly bendDown = output<ShapeBendEvent>();

  /** SVG marker url for an arrowhead type, or null for 'none'. */
  protected markerUrl(type: ArrowheadType): string | null {
    return type === 'none' ? null : `url(#dbd-ah-${type})`;
  }

  /** A control dot on a code block's title bar. */
  protected onDot(action: CodeDotAction, id: string, event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    if (!this.store.canEdit()) {
      return;
    }
    switch (action) {
      case 'delete':
        void this.store.deleteElement(id);
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
    g: GridTableView,
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

  protected onGridCtl(id: string, action: GridStructureAction, index: number, event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    void this.grids.structure(id, action, index);
  }

  protected onGridBorder(id: string, axis: 'col' | 'row', index: number, event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    this.grids.beginBorderDrag(id, axis, index, event);
  }

  protected onBody(id: string, event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();
    this.elementPointerDown.emit({ id, event });
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
