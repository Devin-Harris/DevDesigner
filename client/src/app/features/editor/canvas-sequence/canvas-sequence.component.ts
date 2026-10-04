import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ProjectStore } from '../../../stores/project.store';
import { SequenceDiagramComponent } from '../sequence-diagram/sequence-diagram.component';

type WorldFn = (clientX: number, clientY: number) => { x: number; y: number };
type SnapFn = (n: number) => number;

/**
 * The sequence-diagram layer: renders every sequence diagram in the project as
 * an independent `app-sequence-diagram`, so a project can hold several separate
 * diagrams. Each child manages its own box/participants/messages/interactions.
 */
@Component({
  selector: 'app-canvas-sequence',
  standalone: true,
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
}
