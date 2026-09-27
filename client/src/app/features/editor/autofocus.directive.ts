import { AfterViewInit, Directive, ElementRef, inject } from '@angular/core';

/**
 * Focus (and select, for a textarea) the host element as soon as it is inserted.
 * More reliable than the `autofocus` attribute for elements created dynamically
 * by a control-flow block (e.g. the inline text editor).
 */
@Directive({
  selector: '[appAutofocus]',
  standalone: true,
})
export class AutofocusDirective implements AfterViewInit {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  ngAfterViewInit(): void {
    // Defer one tick so layout is settled before focusing.
    setTimeout(() => {
      const node = this.el.nativeElement;
      node.focus();
      if (node instanceof HTMLTextAreaElement) {
        node.select();
      }
    });
  }
}
