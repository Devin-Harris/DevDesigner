import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Path of the product logo. The favicon and desktop icons are rendered from the same file. */
export const LOGO_SRC = 'assets/brand/logo.svg';

/** The DevDesigner logo mark. Swap assets/brand/logo.svg to rebrand everywhere. */
@Component({
   selector: 'dd-logo',
   template: `<img [src]="src" alt="" [width]="size()" [height]="size()" draggable="false" />`,
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
