import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { ArrowheadType } from '@dbdesigner/shared';
import type { ShapeView } from '../canvas/models/shape-view.model';
import { FRAME_TITLE_H, FRAME_TITLE_W } from '../canvas/helpers/element-geometry.helper';

/** Corner used to resize a shape's bounding box. */
export type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se';

export interface ShapePointerEvent {
  id: string;
  event: PointerEvent;
}
export interface ResizeDownEvent {
  id: string;
  handle: ResizeHandle;
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
  templateUrl: './canvas-shapes.component.html',
  styleUrl: './canvas-shapes.component.scss',
})
export class CanvasShapesComponent {
  readonly shapes = input.required<ShapeView[]>();
  /** Which elements this layer draws: frames sit below connectors, everything else above. */
  readonly layer = input<'all' | 'frames' | 'content'>('all');
  readonly visible = computed(() => {
    const layer = this.layer();
    const all = this.shapes();
    if (layer === 'all') {
      return all;
    }
    return all.filter((s) => (s.type === 'frame') === (layer === 'frames'));
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

  protected readonly frameTitleW = FRAME_TITLE_W;
  protected readonly frameTitleH = FRAME_TITLE_H;

  readonly elementPointerDown = output<ShapePointerEvent>();
  readonly resizeDown = output<ResizeDownEvent>();
  readonly rotateDown = output<ShapePointerEvent>();
  readonly endpointDown = output<ShapeEndpointEvent>();

  /** SVG marker url for an arrowhead type, or null for 'none'. */
  protected markerUrl(type: ArrowheadType): string | null {
    return type === 'none' ? null : `url(#dbd-ah-${type})`;
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

  protected onEndpoint(id: string, which: 'start' | 'end', event: PointerEvent): void {
    event.stopPropagation();
    event.preventDefault();
    this.endpointDown.emit({ id, which, event });
  }
}
