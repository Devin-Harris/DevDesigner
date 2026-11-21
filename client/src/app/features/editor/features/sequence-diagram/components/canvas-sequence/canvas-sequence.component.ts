import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { SequenceDiagramModel } from '@devdesigner/shared';
import {
   SequenceDiagramComponent,
   type SmartDragEndFn,
   type DiagramsDroppedFn,
   type GroupResizeFn,
   type SmartDragFn,
   type SmartEdgesFn,
} from '../../sequence-diagram.component';
import { AtPipe, HasPipe } from '../../../../../../shared/ui/pipes/collection.pipes';

type WorldFn = (clientX: number, clientY: number) => { x: number; y: number };
type SnapFn = (n: number) => number;

/**
 * The sequence-diagram layer: renders every sequence diagram in the project as
 * an independent `dd-sequence-diagram`, so a project can hold several separate
 * diagrams. Each child manages its own box/participants/messages/interactions.
 */
@Component({
   selector: 'dd-canvas-sequence',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [AtPipe, HasPipe, SequenceDiagramComponent],
   templateUrl: './canvas-sequence.component.html',
   styleUrl: './canvas-sequence.component.scss',
})
export class CanvasSequenceComponent {
   /** The project's sequence diagrams. */
   readonly diagrams$ = input.required<readonly SequenceDiagramModel[]>({ alias: 'diagrams' });

   /** Screen→world mapping supplied by the editor (for drag-connect drop targets). */
   readonly toWorld$ = input<WorldFn | null>(null, { alias: 'toWorld' });
   /** Snap a world coordinate to the grid (identity when grid-snap is off). */
   readonly snap$ = input<SnapFn | null>(null, { alias: 'snap' });
   /** Smart-guide snapping for whole-diagram drags (null when not wired). */
   readonly smartDrag$ = input<SmartDragFn | null>(null, { alias: 'smartDrag' });
   readonly smartDragEnd$ = input<SmartDragEndFn | null>(null, { alias: 'smartDragEnd' });
   readonly diagramsDropped$ = input<DiagramsDroppedFn | null>(null, { alias: 'diagramsDropped' });
   readonly smartEdges$ = input<SmartEdgesFn | null>(null, { alias: 'smartEdges' });
   readonly groupResize$ = input<GroupResizeFn | null>(null, { alias: 'groupResize' });
   /** Diagram ids to leave out (collapsed by the slides focus mode). */
   readonly hiddenIds$ = input<ReadonlySet<string> | null>(null, { alias: 'hiddenIds' });
   /** Per-diagram z-index (stacking against drawing elements), from the editor. */
   readonly layerZ$ = input<ReadonlyMap<string, number> | null>(null, { alias: 'layerZ' });
}
