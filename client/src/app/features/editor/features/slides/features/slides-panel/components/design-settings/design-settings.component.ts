import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CheckboxComponent } from '../../../../../../../../shared/ui/components/checkbox/checkbox.component';
import { ColorSwatchesComponent } from '../../../../../../../../shared/ui/components/color-swatches/color-swatches.component';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../../../../../shared/ui/components/icon/icon.component';
import { PopoverTriggerDirective } from '../../../../../../../../shared/ui/directives/popover-trigger.directive';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SelectComponent } from '../../../../../../../../shared/ui/components/select/select.component';
import { SegmentedComponent } from '../../../../../../../../shared/ui/components/segmented/segmented.component';
import { SlidesPanelState } from '../../state/slides-panel.state';

/** Settings panel Design tab: the deck's design, theme, layouts and placeholders. */
@Component({
   selector: 'dd-design-settings',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [CheckboxComponent, ColorSwatchesComponent, FormsModule, IconComponent, PopoverTriggerDirective, MatTooltipModule, SelectComponent, SegmentedComponent],
   templateUrl: './design-settings.component.html',
   styleUrl: './design-settings.component.scss',
})
export class DesignSettingsComponent {
   protected readonly s = inject(SlidesPanelState);
}
