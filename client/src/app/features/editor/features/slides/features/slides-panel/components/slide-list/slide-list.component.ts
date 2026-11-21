import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IconComponent } from '../../../../../../../../shared/ui/components/icon/icon.component';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SlidesPanelState } from '../../state/slides-panel.state';
import { StopClicksDirective } from '../../../../../../../../shared/ui/directives/stop-clicks.directive';
import { AtPipe, HasPipe } from '../../../../../../../../shared/ui/pipes/collection.pipes';

/** The deck panel: presentation name, present buttons, the slide cards and the New slide menu. */
@Component({
   selector: 'dd-slide-list',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [HasPipe, AtPipe, StopClicksDirective, IconComponent, MatTooltipModule],
   templateUrl: './slide-list.component.html',
   styleUrl: './slide-list.component.scss',
})
export class SlideListComponent {
   protected readonly s = inject(SlidesPanelState);
}
