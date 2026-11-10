import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { Connector } from '../canvas/models/connector.model';

export type Endpoint = 'source' | 'target';

export interface EndpointDownEvent {
   relationshipId: string;
   which: Endpoint;
   event: PointerEvent;
}

export interface SegmentDownEvent {
   relationshipId: string;
   segmentIndex: number;
   event: PointerEvent;
}

/**
 * SVG layer that draws relationship connectors (orthogonal, crow's-foot markers)
 * and, for the selected connector, its endpoint handles and per-segment drag
 * handles. Purely presentational: it emits intent, the editor mutates the store.
 * While a drag is in progress the whole layer is click-through so the drop lands
 * on the underlying table/column handles.
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
   /** Anchor the in-flight link would snap to, drawn as a ring. */
   readonly snapAnchor = input<{ x: number; y: number } | null>(null);
   readonly svgOffset = input.required<number>();
   readonly dragging = input<boolean>(false);

   readonly selectConnector = output<{ id: string; event: PointerEvent }>();
   readonly endpointDown = output<EndpointDownEvent>();
   readonly segmentDown = output<SegmentDownEvent>();
   readonly resetRoute = output<string>();

   protected onHit(id: string, event: PointerEvent): void {
      event.stopPropagation();
      this.selectConnector.emit({ id, event });
   }

   protected onEndpoint(relationshipId: string, which: Endpoint, event: PointerEvent): void {
      event.stopPropagation();
      event.preventDefault();
      this.endpointDown.emit({ relationshipId, which, event });
   }

   protected onSegment(relationshipId: string, segmentIndex: number, event: PointerEvent): void {
      event.stopPropagation();
      event.preventDefault();
      this.segmentDown.emit({ relationshipId, segmentIndex, event });
   }
}
