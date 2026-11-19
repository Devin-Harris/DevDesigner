import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../../../../../shared/ui/components/icon/icon.component';
import { SelectComponent } from '../../../../../../../../shared/ui/components/select/select.component';
import { TagInputComponent } from '../../../../../../../../shared/ui/components/tag-input/tag-input.component';
import { SlidesPanelState } from '../../state/slides-panel.state';

/** Settings panel Transition tab: the selected slides' transition, animate-by and morph tags. */
@Component({
   selector: 'dd-transition-settings',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [FormsModule, IconComponent, SelectComponent, TagInputComponent],
   templateUrl: './transition-settings.component.html',
   styleUrl: './transition-settings.component.scss',
})
export class TransitionSettingsComponent {
   protected readonly s = inject(SlidesPanelState);
}
