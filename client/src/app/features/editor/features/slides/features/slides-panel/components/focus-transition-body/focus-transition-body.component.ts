import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../../../../../shared/ui/components/icon/icon.component';
import { PopoverTriggerDirective } from '../../../../../../../../shared/ui/directives/popover-trigger.directive';
import { SelectComponent } from '../../../../../../../../shared/ui/components/select/select.component';
import { TagInputComponent } from '../../../../../../../../shared/ui/components/tag-input/tag-input.component';
import { SlidesPanelState } from '../../state/slides-panel.state';

/** The transition controls shared by the focus dock and the focus Transition screen. */
@Component({
   selector: 'dd-focus-transition-body',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [FormsModule, IconComponent, PopoverTriggerDirective, SelectComponent, TagInputComponent],
   templateUrl: './focus-transition-body.component.html',
   styleUrl: './focus-transition-body.component.scss',
})
export class FocusTransitionBodyComponent {
   protected readonly s = inject(SlidesPanelState);
}
