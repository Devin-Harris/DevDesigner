import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { RelationshipType } from '@devdesigner/shared';
import { IconComponent } from '../../../../../../shared/ui/components/icon/icon.component';

/**
 * Small on-canvas control that floats at a selected connector's midpoint:
 * cardinality (1 : 1 / 1 : N / N : M), Auto-route, Reset route and delete.
 * The parent positions the host via left/top style bindings.
 */
@Component({
   selector: 'dd-relationship-toolbar',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [MatTooltipModule, IconComponent],
   templateUrl: './relationship-toolbar.component.html',
   styleUrl: './relationship-toolbar.component.scss',
})
export class RelationshipToolbarComponent {
   readonly type = input.required<RelationshipType>();
   readonly canEdit = input<boolean>(true);
   /** Best-path routing on; off = manual line with pinned sides. */
   readonly autoRoute = input<boolean>(false);

   readonly setType = output<RelationshipType>();
   readonly resetRoute = output<void>();
   readonly toggleAutoRoute = output<void>();
   readonly deleteRelationship = output<void>();
}
