import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { IconComponent } from '../../../shared/ui/components/icon/icon.component';
import { PopoverTriggerDirective } from '../../../shared/ui/directives/popover-trigger.directive';
import { ColorSwatchesComponent } from '../../../shared/ui/components/color-swatches/color-swatches.component';
import type { AlignAction } from '../canvas/models/toolbar-actions';

export type ArrangeOp = 'front' | 'forward' | 'backward' | 'back';

/**
 * Floating bar under a multi-selection (2+ tables / elements / diagrams):
 * Align ▾, Group / Ungroup, layer order, duplicate and delete. Replaces the old
 * quick-align strip above the status bar so the view island never changes shape.
 */
@Component({
   selector: 'dd-multi-select-bar',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [IconComponent, MatTooltipModule, PopoverTriggerDirective, ColorSwatchesComponent],
   templateUrl: './multi-select-bar.component.html',
   styleUrl: './multi-select-bar.component.scss',
})
export class MultiSelectBarComponent {
   readonly count = input.required<number>();
   readonly canDistribute = input(false);
   /** The selection is exactly one (not entered) group: offer Ungroup. */
   readonly grouped = input(false);
   /** Some selected items take a fill / stroke (shapes, lines). */
   readonly canStyle = input(false);

   readonly align = output<AlignAction>();
   readonly group = output<void>();
   readonly ungroup = output<void>();
   readonly arrange = output<ArrangeOp>();
   readonly duplicate = output<void>();
   readonly remove = output<void>();
   readonly fill = output<string>();
   readonly stroke = output<string>();
}
