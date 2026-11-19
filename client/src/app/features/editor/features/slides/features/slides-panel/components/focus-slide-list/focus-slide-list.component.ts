import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IconComponent } from '../../../../../../../../shared/ui/components/icon/icon.component';
import { PopoverTriggerDirective } from '../../../../../../../../shared/ui/directives/popover-trigger.directive';
import { SlidesPanelState } from '../../state/slides-panel.state';
import { StopClicksDirective } from '../../../../../../../../shared/ui/directives/stop-clicks.directive';

/** Focus mode slide rail: thumbnails to pick, reorder and duplicate slides. */
@Component({
   selector: 'dd-focus-slide-list',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [StopClicksDirective, IconComponent, PopoverTriggerDirective],
   templateUrl: './focus-slide-list.component.html',
   styleUrl: './focus-slide-list.component.scss',
})
export class FocusSlideListComponent {
   protected readonly s = inject(SlidesPanelState);
}
