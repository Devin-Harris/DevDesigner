import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AnimationPaneComponent } from '../../features/animation-pane/animation-pane.component';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../../../../../shared/ui/components/icon/icon.component';
import { FocusTransitionBodyComponent } from '../focus-transition-body/focus-transition-body.component';
import { SlidesPanelState } from '../../state/slides-panel.state';
import { AtPipe, CallPipe } from '../../../../../../../../shared/ui/pipes/collection.pipes';

import { FocusMorphTagComponent } from '../focus-morph-tag/focus-morph-tag.component';

/** Focus mode settings dock: Slide / Transition / Animations / Notes. */
@Component({
   selector: 'dd-focus-settings',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [CallPipe, AtPipe, AnimationPaneComponent, FormsModule, IconComponent, FocusTransitionBodyComponent, FocusMorphTagComponent],
   templateUrl: './focus-settings.component.html',
   styleUrl: './focus-settings.component.scss',
})
export class FocusSettingsComponent {
   protected readonly s = inject(SlidesPanelState);
}
