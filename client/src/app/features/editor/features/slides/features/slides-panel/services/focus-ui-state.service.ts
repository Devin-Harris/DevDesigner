import { Injectable, signal } from '@angular/core';

/** Focus-mode view state that outlives the docks (they are rebuilt per screen). */
@Injectable({ providedIn: 'root' })
export class FocusUiState {
   readonly tab = signal<'slide' | 'transition' | 'animations' | 'notes'>('slide');
   /** The canvas settings panel's tab. */
   readonly canvasTab = signal<'transition' | 'design' | 'size' | 'notes' | 'animations'>('transition');

   /** Entering focus: open the same tab there (Design / Size live in the top bar, so Slide). */
   toFocus(): void {
      const t = this.canvasTab();
      // Transition and animations share one tab.
      this.tab.set(t === 'transition' || t === 'animations' ? 'transition' : t === 'notes' ? t : 'slide');
   }

   /** Leaving focus: the canvas panel shows the tab that was open in focus mode. */
   fromFocus(): void {
      const t = this.tab();
      if (t !== 'slide') this.canvasTab.set(t);
   }
}
