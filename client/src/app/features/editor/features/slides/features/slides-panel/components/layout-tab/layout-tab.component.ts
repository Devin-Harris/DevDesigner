import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IconComponent } from '../../../../../../../../shared/ui/components/icon/icon.component';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SlidesPanelState } from '../../state/slides-panel.state';

/** Design screen: the deck's layouts as cards (drag to reorder, Alt-drag to duplicate). */
@Component({
   selector: 'dd-layout-tab',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [IconComponent, MatTooltipModule],
   templateUrl: './layout-tab.component.html',
   styleUrl: './layout-tab.component.scss',
})
export class LayoutTabComponent {
   protected readonly s = inject(SlidesPanelState);
}
