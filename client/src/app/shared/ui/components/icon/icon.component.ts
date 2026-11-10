import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ICON_PATHS } from './icon-registry';

/**
 * Bespoke thin-stroke SVG icon. Replaces Angular Material's `mat-icon` (ligature
 * font) with inline SVG from {@link ICON_PATHS}, so the app renders the design
 * system's Lucide/Feather-style glyphs and drops the Material Icons + Roboto font
 * dependency. Size and color follow the surrounding text (`1em`, `currentColor`);
 * override via the host `--dd-icon-size` custom property or plain CSS.
 *
 *   <dd-icon name="add" />
 */
@Component({
   selector: 'dd-icon',
   changeDetection: ChangeDetectionStrategy.OnPush,
   templateUrl: './icon.component.html',
   styleUrl: './icon.component.scss',
})
export class IconComponent {
   private readonly sanitizer = inject(DomSanitizer);

   /** Icon key from the registry (see icon-registry.ts). */
   readonly name = input.required<string>();

   protected readonly svg = computed<SafeHtml>(() => {
      const inner = ICON_PATHS[this.name()] ?? '';
      const markup =
         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ` +
         `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
      return this.sanitizer.bypassSecurityTrustHtml(markup);
   });
}
