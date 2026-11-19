import { Directive } from '@angular/core';

/**
 * Marks a non-interactive container whose clicks must not reach an ancestor's click
 * handler (e.g. a panel over the presenter's click-to-advance stage). It is not a
 * control, so it needs no keyboard equivalent; its own buttons stay keyboard-operable.
 */
@Directive({
   selector: '[ddStopClicks]',
   host: {
      '(click)': '$event.stopPropagation()',
      '(dblclick)': '$event.stopPropagation()',
   },
})
export class StopClicksDirective {}
