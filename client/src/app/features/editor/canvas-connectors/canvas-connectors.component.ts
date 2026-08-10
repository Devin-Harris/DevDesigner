import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { Connector } from '../canvas-geometry';

export type Endpoint = 'source' | 'target';

export interface EndpointDownEvent {
  relationshipId: string;
  which: Endpoint;
  event: PointerEvent;
}

export interface WaypointDownEvent {
  relationshipId: string;
  index: number;
  event: PointerEvent;
}

export interface SegmentAddEvent {
  relationshipId: string;
  segmentIndex: number;
  event: PointerEvent;
}

/**
 * SVG layer that draws relationship connectors with crow's-foot markers, the
 * draggable endpoint handles for the selected connector, and the temporary
 * link line while drawing/re-pointing. Purely presentational: it emits intent
 * and the editor mutates the store.
 */
@Component({
  selector: 'app-canvas-connectors',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './canvas-connectors.component.html',
  styleUrl: './canvas-connectors.component.scss',
})
export class CanvasConnectorsComponent {
  readonly connectors = input.required<Connector[]>();
  readonly tempLinkPath = input<string | null>(null);
  readonly svgOffset = input.required<number>();
  /** While true (a drag is in progress) the layer ignores pointer events so the
   * drop lands on the underlying table/column handles. */
  readonly dragging = input<boolean>(false);

  readonly selectConnector = output<{ id: string; event: PointerEvent }>();
  readonly endpointDown = output<EndpointDownEvent>();
  readonly waypointDown = output<WaypointDownEvent>();
  readonly waypointRemove = output<{ relationshipId: string; index: number }>();
  readonly segmentAddDown = output<SegmentAddEvent>();

  protected onHit(id: string, event: PointerEvent): void {
    event.stopPropagation();
    this.selectConnector.emit({ id, event });
  }

  protected onEndpoint(relationshipId: string, which: Endpoint, event: PointerEvent): void {
    event.stopPropagation();
    event.preventDefault();
    this.endpointDown.emit({ relationshipId, which, event });
  }

  protected onWaypoint(relationshipId: string, index: number, event: PointerEvent): void {
    event.stopPropagation();
    event.preventDefault();
    this.waypointDown.emit({ relationshipId, index, event });
  }

  protected onWaypointDbl(relationshipId: string, index: number, event: Event): void {
    event.stopPropagation();
    this.waypointRemove.emit({ relationshipId, index });
  }

  protected onSegmentAdd(relationshipId: string, segmentIndex: number, event: PointerEvent): void {
    event.stopPropagation();
    event.preventDefault();
    this.segmentAddDown.emit({ relationshipId, segmentIndex, event });
  }
}
