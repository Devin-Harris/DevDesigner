import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { RelationshipType } from '@dbdesigner/shared';

/**
 * Small on-canvas control that floats at a selected connector's midpoint. Lets
 * you change cardinality (1:1 / 1:N / N:M) and delete the relationship inline.
 * The parent positions the host via left/top style bindings.
 */
@Component({
  selector: 'app-relationship-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatTooltipModule],
  templateUrl: './relationship-toolbar.component.html',
  styleUrl: './relationship-toolbar.component.scss',
})
export class RelationshipToolbarComponent {
  readonly type = input.required<RelationshipType>();
  readonly canEdit = input<boolean>(true);

  readonly setType = output<RelationshipType>();
  readonly deleteRelationship = output<void>();
}
