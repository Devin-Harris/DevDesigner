import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AnimationPaneComponent } from '../../features/animation-pane/animation-pane.component';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../../../../../shared/ui/components/icon/icon.component';
import { SelectComponent } from '../../../../../../../../shared/ui/components/select/select.component';
import { TransitionSettingsComponent } from '../transition-settings/transition-settings.component';
import { DesignSettingsComponent } from '../design-settings/design-settings.component';
import { SlidesPanelState } from '../../state/slides-panel.state';

/** The settings panel: Transition / Size / Design / Notes / Animations tabs (foldable). */
@Component({
   selector: 'dd-slide-settings',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [AnimationPaneComponent, FormsModule, NgTemplateOutlet, IconComponent, SelectComponent, TransitionSettingsComponent, DesignSettingsComponent],
   templateUrl: './slide-settings.component.html',
   styleUrl: './slide-settings.component.scss',
})
export class SlideSettingsComponent {
   protected readonly s = inject(SlidesPanelState);
}
