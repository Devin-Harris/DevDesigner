import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TagInputComponent } from '../../../../../../../../shared/ui/components/tag-input/tag-input.component';
import { SlidesPanelState } from '../../state/slides-panel.state';
import { HasPipe, CallPipe } from '../../../../../../../../shared/ui/pipes/collection.pipes';

/** Focus mode morph tag field (with split in / out) for the selected object, on slides and layouts. */
@Component({
   selector: 'dd-focus-morph-tag',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [CallPipe, HasPipe, TagInputComponent],
   templateUrl: './focus-morph-tag.component.html',
   styleUrl: './focus-morph-tag.component.scss',
})
export class FocusMorphTagComponent {
   protected readonly s = inject(SlidesPanelState);
}
