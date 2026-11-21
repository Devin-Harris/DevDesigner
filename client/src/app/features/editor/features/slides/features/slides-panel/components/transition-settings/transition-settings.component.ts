import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../../../../../shared/ui/components/icon/icon.component';
import { SelectComponent } from '../../../../../../../../shared/ui/components/select/select.component';
import { TagInputComponent } from '../../../../../../../../shared/ui/components/tag-input/tag-input.component';
import { SlidesPanelState } from '../../state/slides-panel.state';
import { CallPipe } from '../../../../../../../../shared/ui/pipes/collection.pipes';

/** Settings panel Transition tab: the selected slides' transition, animate-by and morph tags. */
@Component({
   selector: 'dd-transition-settings',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [CallPipe, FormsModule, IconComponent, SelectComponent, TagInputComponent],
   templateUrl: './transition-settings.component.html',
   styleUrl: './transition-settings.component.scss',
})
export class TransitionSettingsComponent {
   protected readonly s = inject(SlidesPanelState);
   protected readonly morphByInfo =
      'Characters: letters and words glide. Words: whole words glide. Objects: text moves as one piece and cross-fades. Applies to text, code blocks, tables and diagrams.';
   protected readonly tagInfo =
      'Tagged objects only morph into the object with the same tag on the next slide; they are never matched to look-alikes.';
}
