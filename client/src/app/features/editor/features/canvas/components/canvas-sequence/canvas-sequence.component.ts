import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ProjectStore } from '../../../../state/project/project.store';
import {
   SequenceDiagramComponent,
   type SmartDragEndFn,
   type GroupResizeFn,
   type SmartDragFn,
} from '../../../sequence-diagram/sequence-diagram.component';

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
   imports: [SequenceDiagramComponent],
   templateUrl: './canvas-sequence.component.html',
   styleUrl: './canvas-sequence.component.scss',
})
export class CanvasSequenceComponent {
   protected readonly store = inject(ProjectStore);

   /** Screen→world mapping supplied by the editor (for drag-connect drop targets). */
   readonly toWorld = input<WorldFn | null>(null);
   /** Snap a world coordinate to the grid (identity when grid-snap is off). */
   readonly snap = input<SnapFn | null>(null);
   /** Smart-guide snapping for whole-diagram drags (null when not wired). */
   readonly smartDrag = input<SmartDragFn | null>(null);
   readonly smartDragEnd = input<SmartDragEndFn | null>(null);
   readonly groupResize = input<GroupResizeFn | null>(null);
   /** Diagram ids to leave out (collapsed by the slides focus mode). */
   readonly hiddenIds = input<ReadonlySet<string> | null>(null);
   /** Per-diagram z-index (stacking against drawing elements), from the editor. */
   readonly layerZ = input<ReadonlyMap<string, number> | null>(null);
}
