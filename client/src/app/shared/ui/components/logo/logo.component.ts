import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Path of the product logo. The favicon and desktop icons are rendered from the same file. */
export const LOGO_SRC = 'assets/brand/logo.svg';

/** The DevDesigner logo mark. Swap assets/brand/logo.svg to rebrand everywhere. */
@Component({
   selector: 'dd-logo',
   template: `<img alt="" draggable="false" [src]="src" [width]="size()" [height]="size()" />`,
   styles: `
      :host {
         display: inline-flex;
         flex-shrink: 0;
      }
      img {
         display: block;
      }
   `,
   changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogoComponent {
   readonly size = input(28);
   protected readonly src = LOGO_SRC;
}
