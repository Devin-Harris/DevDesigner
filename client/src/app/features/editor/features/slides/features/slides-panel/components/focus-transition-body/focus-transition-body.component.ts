import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../../../../../shared/ui/components/icon/icon.component';
import { PopoverTriggerDirective } from '../../../../../../../../shared/ui/directives/popover-trigger.directive';
import { SelectComponent } from '../../../../../../../../shared/ui/components/select/select.component';
import { FocusMorphTagComponent } from '../focus-morph-tag/focus-morph-tag.component';
import { SlidesPanelState } from '../../state/slides-panel.state';
import { HasPipe } from '../../../../../../../../shared/ui/pipes/collection.pipes';

/** The transition controls shared by the focus dock and the focus Transition screen. */
@Component({
   selector: 'dd-focus-transition-body',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [HasPipe, FormsModule, IconComponent, PopoverTriggerDirective, SelectComponent, FocusMorphTagComponent],
   templateUrl: './focus-transition-body.component.html',
   styleUrl: './focus-transition-body.component.scss',
})
export class FocusTransitionBodyComponent {
   protected readonly s = inject(SlidesPanelState);
}
