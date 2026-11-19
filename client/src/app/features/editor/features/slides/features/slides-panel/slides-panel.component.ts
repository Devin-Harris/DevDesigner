import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { DeckMenusComponent } from './components/deck-menus/deck-menus.component';
import { FocusSettingsComponent } from './components/focus-settings/focus-settings.component';
import { FocusSlideListComponent } from './components/focus-slide-list/focus-slide-list.component';
import { FocusTransitionComponent } from './components/focus-transition/focus-transition.component';
import { LayoutTabComponent } from './components/layout-tab/layout-tab.component';
import { SlideListComponent } from './components/slide-list/slide-list.component';
import { SlideSettingsComponent } from './components/slide-settings/slide-settings.component';
import { ThemePickerComponent } from './components/theme-picker/theme-picker.component';
import type { SlidesCommand } from './models/slides-command.model';
import type { SettingsTabRequest, SlidesPanelPart } from './models/slides-panel.model';
import { SlidesPanelState } from './state/slides-panel.state';

/**
 * The deck UI around a presentation: the slide sorter, the settings panel, the focus-mode
 * screens and the deck header's menus. `part` picks which one this mount shows; the
 * editor mounts several at once. Each part is its own component sharing this mount's
 * SlidesPanelState. All edits are ordinary frame updates, so they sync live and
 * undo/redo like any other change.
 */
@Component({
   selector: 'dd-slides-panel',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [
      DeckMenusComponent,
      FocusSettingsComponent,
      FocusSlideListComponent,
      FocusTransitionComponent,
      LayoutTabComponent,
      SlideListComponent,
      SlideSettingsComponent,
      ThemePickerComponent,
   ],
   providers: [SlidesPanelState],
   templateUrl: './slides-panel.component.html',
   styleUrl: './slides-panel.component.scss',
})
export class SlidesPanelComponent {
   // eslint-disable-next-line @angular-eslint/no-output-native -- component output, unrelated to the invoker `command` event
   readonly command = output<SlidesCommand>();
   /** `list`: the slide cards (left of the frame); `settings`: transition/size/notes (right); the rest: focus screens and menus. */
   readonly part = input<SlidesPanelPart>('list');
   /** Settings panel only: folded sideways to a narrow strip. */
   readonly folded = input<boolean>(false);
   /** The slide of this presentation currently shown on the canvas (the only one visible). */
   readonly active_ = input<string | null>(null, { alias: 'active' });
   /** The presentation this panel belongs to (its name). */
   readonly presentation = input.required<string>();
   /** The last slide shown before a layout was opened (kept highlighted while editing it). */
   readonly lastSlide = input<string | null>(null);
   /** A tab the deck header asked to open (a fresh object each request). */
   readonly requestTab = input<SettingsTabRequest | null>(null);

   constructor() {
      inject(SlidesPanelState).bind(this);
   }
}
