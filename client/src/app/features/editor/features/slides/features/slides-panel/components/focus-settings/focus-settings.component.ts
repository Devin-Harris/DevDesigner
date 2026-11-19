import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AnimationPaneComponent } from '../../features/animation-pane/animation-pane.component';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../../../../../shared/ui/components/icon/icon.component';
import { FocusTransitionBodyComponent } from '../focus-transition-body/focus-transition-body.component';
import { SlidesPanelState } from '../../state/slides-panel.state';

/** Focus mode settings dock: Slide / Transition / Animations / Notes. */
@Component({
   selector: 'dd-focus-settings',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [AnimationPaneComponent, FormsModule, IconComponent, FocusTransitionBodyComponent],
   templateUrl: './focus-settings.component.html',
   styleUrl: './focus-settings.component.scss',
})
export class FocusSettingsComponent {
   protected readonly s = inject(SlidesPanelState);
}
