import { Injectable, computed, signal } from '@angular/core';

const PINNED_KEY = 'devdesigner.inspectorPinned';

/**
 * Visibility of the canvas inspector (table / relationship / element / sequence
 * details). The inspector no longer docks on every selection: a floating
 * toolbar's "Details" button opens it for the current selection, and pinning
 * keeps it docked on the right for every selection (remembered per browser).
 */
@Injectable({ providedIn: 'root' })
export class InspectorPanelService {
   /** Opened for the current selection via a toolbar's Details button. */
   readonly open = signal(false);
   /** Docked for every selection until unpinned. */
   readonly pinned$ = signal(readPinned());

   readonly shown$ = computed(() => this.open() || this.pinned$());

   toggle(): void {
      if (this.shown$()) {
         this.close();
      } else {
         this.open.set(true);
      }
   }

   close(): void {
      this.open.set(false);
      this.setPinned(false);
   }

   togglePin(): void {
      const next = !this.pinned$();
      this.setPinned(next);
      // Unpinning leaves the panel open for the current selection.
      if (!next) this.open.set(true);
   }

   /** Selection changed: an unpinned panel folds away. */
   selectionChanged(): void {
      this.open.set(false);
   }

   private setPinned(on: boolean): void {
      this.pinned$.set(on);
      try {
         globalThis.localStorage?.setItem(PINNED_KEY, on ? '1' : '0');
      } catch {
         // storage unavailable: applies for this session only
      }
   }
}

function readPinned(): boolean {
   try {
      return globalThis.localStorage?.getItem(PINNED_KEY) === '1';
   } catch {
      return false;
   }
}
