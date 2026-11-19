import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AutofocusDirective } from '../../../../../../../../shared/ui/directives/autofocus.directive';
import { ColorSwatchesComponent } from '../../../../../../../../shared/ui/components/color-swatches/color-swatches.component';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../../../../../shared/ui/components/icon/icon.component';
import { PopoverTriggerDirective } from '../../../../../../../../shared/ui/directives/popover-trigger.directive';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SelectComponent } from '../../../../../../../../shared/ui/components/select/select.component';
import { SlidesPanelState } from '../../state/slides-panel.state';

/** Design screen: the deck's themes, colors and fonts. */
@Component({
   selector: 'dd-theme-picker',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [AutofocusDirective, ColorSwatchesComponent, FormsModule, IconComponent, PopoverTriggerDirective, MatTooltipModule, SelectComponent],
   templateUrl: './theme-picker.component.html',
   styleUrl: './theme-picker.component.scss',
})
export class ThemePickerComponent {
   protected readonly s = inject(SlidesPanelState);
}
