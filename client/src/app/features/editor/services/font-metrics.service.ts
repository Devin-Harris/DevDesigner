import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject } from '@angular/core';
import { notifySignal } from '../../../shared/helpers/signals';
import { clearTextMetricsCaches } from '../helpers/text-metrics';

/**
 * Owns the `document.fonts` listener for the canvas text measurers. Text measured before a
 * web font arrives used the fallback face, so when fonts finish loading the measure caches
 * are dropped and `fontsLoaded$` fires to re-lay out whatever reads it.
 */
@Injectable({ providedIn: 'root' })
export class FontMetricsService {
   readonly fontsLoaded$ = notifySignal();
   private generationValue = 0;

   constructor() {
      const fonts = inject(DOCUMENT).fonts;
      if (!fonts?.addEventListener) return;
      const onLoaded = (): void => {
         clearTextMetricsCaches();
         this.generationValue++;
         this.fontsLoaded$.notify();
      };
      fonts.addEventListener('loadingdone', onLoaded);
      inject(DestroyRef).onDestroy(() => fonts.removeEventListener('loadingdone', onLoaded));
   }

   /** Bumped on every font load; part of memo keys for anything measured in a web font. */
   get generation(): number {
      return this.generationValue;
   }
}
