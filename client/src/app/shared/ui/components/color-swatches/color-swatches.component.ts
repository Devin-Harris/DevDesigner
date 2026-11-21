import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import {
   PICKER_SWATCHES,
   THEME_COLOR_LABELS,
   THEME_COLOR_TOKENS,
   themeSwatchCss,
   themeToken,
   type SlideTheme,
} from '@devdesigner/shared';
import { IconComponent } from '../icon/icon.component';
import { CallPipe } from '../../../../shared/ui/pipes/collection.pipes';

/**
 * The editor's standard color picker: a "no color" swatch, a theme swatch (follows
 * light/dark mode), the shared palette swatches, and a custom color well. Emits
 * `noneValue` / `themeValue` for those two, otherwise a hex.
 */
@Component({
   selector: 'dd-color-swatches',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [CallPipe, IconComponent],
   templateUrl: './color-swatches.component.html',
   styleUrl: './color-swatches.component.scss',
})
export class ColorSwatchesComponent {
   /** The current color (hex); empty/undefined = no color. */
   readonly value = input<string | null | undefined>('');
   readonly colors$ = input<readonly string[]>(PICKER_SWATCHES, { alias: 'colors' });
   readonly allowNone$ = input(true, { alias: 'allowNone' });
   readonly noneLabel$ = input('No color', { alias: 'noneLabel' });
   /** What "no color" emits (and matches as active); `''` clears the field. */
   readonly noneValue$ = input('', { alias: 'noneValue' });
   /** What the theme swatch emits; null hides it. */
   readonly themeValue$ = input<string | null>(null, { alias: 'themeValue' });
   readonly columns$ = input(6, { alias: 'columns' });
   /** A slide deck's theme: shows its color tokens (emitted as `$accent1`, ...) above the palette. */
   readonly deckTheme$ = input<SlideTheme | null>(null, { alias: 'deckTheme' });
   readonly disabled$ = input(false, { alias: 'disabled' });
   readonly pick = output<string>();

   protected readonly current$ = computed(() => this.norm(this.value()));
   protected readonly isCustom$ = computed(() => {
      const c = this.current$();
      return (
         !!c &&
         !c.startsWith('$') &&
         c !== this.norm(this.noneValue$()) &&
         c !== this.norm(this.themeValue$()) &&
         !this.colors$().includes(c)
      );
   });

   protected readonly tokens = THEME_COLOR_TOKENS;
   protected readonly css = themeSwatchCss;
   protected readonly labels = THEME_COLOR_LABELS;
   protected token(k: (typeof THEME_COLOR_TOKENS)[number]): string {
      return themeToken(k);
   }

   protected norm(c: string | null | undefined): string {
      return (c || '').toLowerCase();
   }
}
