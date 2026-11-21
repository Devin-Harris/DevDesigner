import type { OutputEmitterRef, Signal } from '@angular/core';
import type { SlidesCommand } from './slides-command.model';

/** Which piece of the deck UI one mounted slides panel shows. */
export type SlidesPanelPart =
   | 'list'
   | 'settings'
   | 'size-menu'
   | 'theme-menu'
   | 'design-menu'
   | 'focus-list'
   | 'focus-settings'
   | 'focus-transition'
   | 'design-layouts'
   | 'design-theme';

/** The settings panel's tabs. */
export type SettingsTab = 'transition' | 'design' | 'size' | 'notes' | 'animations';

/** A tab the deck header asked to open (a fresh object each request). */
export interface SettingsTabRequest {
   tab: SettingsTab;
}

/** What the host SlidesPanelComponent hands its SlidesPanelState: its output and inputs. */
export interface SlidesPanelBindings {
   command: Pick<OutputEmitterRef<SlidesCommand>, 'emit'>;
   part$: Signal<SlidesPanelPart>;
   folded: Signal<boolean>;
   active_: Signal<string | null>;
   presentation: Signal<string>;
   lastSlide: Signal<string | null>;
   requestTab: Signal<SettingsTabRequest | null>;
}
