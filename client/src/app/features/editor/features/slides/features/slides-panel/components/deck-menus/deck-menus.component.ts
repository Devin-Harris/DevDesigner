import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AutofocusDirective } from '../../../../../../../../shared/ui/directives/autofocus.directive';
import { IconComponent } from '../../../../../../../../shared/ui/components/icon/icon.component';
import { SlidesPanelState } from '../../state/slides-panel.state';
import { CallPipe } from '../../../../../../../../shared/ui/pipes/collection.pipes';

/** The deck header's theme, design and size menus. */
@Component({
   selector: 'dd-deck-menus',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [CallPipe, AutofocusDirective, IconComponent],
   templateUrl: './deck-menus.component.html',
   styleUrl: './deck-menus.component.scss',
})
export class DeckMenusComponent {
   protected readonly s = inject(SlidesPanelState);
}
