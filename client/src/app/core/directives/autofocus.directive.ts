import { AfterViewInit, Directive, ElementRef, inject } from '@angular/core';

/**
 * Focuses (and selects the text of) an input when it is inserted. Used for the
 * canvas inline editors so a field is ready to type as soon as it appears.
 */
@Directive({
   selector: '[appAutofocus]',
   standalone: true,
})
export class AutofocusDirective implements AfterViewInit {
   private readonly host = inject<ElementRef<HTMLInputElement>>(ElementRef);

   ngAfterViewInit(): void {
      const el = this.host.nativeElement;
      el.focus();
      if (typeof el.select === 'function') {
         el.select();
      }
   }
}
