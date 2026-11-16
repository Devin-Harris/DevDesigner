import { Directive, ElementRef, afterNextRender, inject, input } from '@angular/core';

export type AutofocusSelectMode = 'always' | 'textarea' | 'never';

/**
 * Focuses the host as soon as it is rendered (more reliable than the `autofocus`
 * attribute for elements created by control flow) and optionally selects its text.
 */
@Directive({
   selector: '[ddAutofocus]',
})
export class AutofocusDirective {
   readonly select = input<AutofocusSelectMode>('always', { alias: 'ddAutofocusSelect' });

   private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

   constructor() {
      afterNextRender(() => {
         const el = this.host.nativeElement;
         el.focus();
         const mode = this.select();
         const selectable = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
         if (selectable && (mode === 'always' || (mode === 'textarea' && el instanceof HTMLTextAreaElement))) {
            el.select();
         }
      });
   }
}
