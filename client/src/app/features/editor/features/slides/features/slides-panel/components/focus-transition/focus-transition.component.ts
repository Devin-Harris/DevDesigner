import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FocusTransitionBodyComponent } from '../focus-transition-body/focus-transition-body.component';
import { SlidesPanelState } from '../../state/slides-panel.state';

/** Focus mode Transition screen. */
@Component({
   selector: 'dd-focus-transition',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [FocusTransitionBodyComponent],
   templateUrl: './focus-transition.component.html',
   styleUrl: './focus-transition.component.scss',
})
export class FocusTransitionComponent {
   protected readonly s = inject(SlidesPanelState);
}
