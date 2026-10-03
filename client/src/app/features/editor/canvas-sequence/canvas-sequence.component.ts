import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { LifelineView, MessageView } from '../canvas/helpers/sequence-render.helper';

export interface LifelinePointerEvent {
  id: string;
  event: PointerEvent;
}
export interface MessagePointerEvent {
  id: string;
  event: PointerEvent;
}
export interface SpineClickEvent {
  lifelineId: string;
  worldY: number;
  event: PointerEvent;
}

/**
 * SVG layer that draws the sequence diagram: lifeline header boxes, spine lines,
 * and message arrows. Purely presentational — emits pointer intents and the
 * editor mutates the store, following the same pattern as canvas-shapes and
 * canvas-connectors.
 */
@Component({
  selector: 'app-canvas-sequence',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './canvas-sequence.component.html',
  styleUrl: './canvas-sequence.component.scss',
})
export class CanvasSequenceComponent {
  readonly lifelines = input.required<LifelineView[]>();
  readonly messages = input.required<MessageView[]>();
  readonly svgOffset = input.required<number>();
  readonly dragging = input<boolean>(false);
  readonly interactive = input<boolean>(true);

  readonly lifelinePointerDown = output<LifelinePointerEvent>();
  readonly messagePointerDown = output<MessagePointerEvent>();
  readonly spineClick = output<SpineClickEvent>();
  readonly selectLifeline = output<LifelinePointerEvent>();
  readonly selectMessage = output<MessagePointerEvent>();

  protected onLifelineDown(id: string, event: PointerEvent): void {
    event.stopPropagation();
    this.lifelinePointerDown.emit({ id, event });
  }

  protected onLifelineClick(id: string, event: PointerEvent): void {
    event.stopPropagation();
    this.selectLifeline.emit({ id, event });
  }

  protected onMessageDown(id: string, event: PointerEvent): void {
    event.stopPropagation();
    this.messagePointerDown.emit({ id, event });
  }

  protected onMessageClick(id: string, event: PointerEvent): void {
    event.stopPropagation();
    this.selectMessage.emit({ id, event });
  }

  protected onSpineClick(lifelineId: string, event: PointerEvent, svgOffset: number): void {
    event.stopPropagation();
    const worldY = event.offsetY - svgOffset;
    this.spineClick.emit({ lifelineId, worldY, event });
  }

  /** Build the SVG marker-end attribute for a given arrowhead type and side. */
  protected markerEnd(m: MessageView): string | null {
    if (m.arrowSide !== 'end' || m.arrowhead === 'none') return null;
    return `url(#dbd-seq-${m.arrowhead})`;
  }

  protected markerStart(m: MessageView): string | null {
    if (m.arrowSide !== 'start' || m.arrowhead === 'none') return null;
    return `url(#dbd-seq-${m.arrowhead}-rev)`;
  }

  protected trackById(_: number, item: { id: string }): string {
    return item.id;
  }
}
