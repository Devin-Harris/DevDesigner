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

/**
 * The editor's standard color picker: a "no color" swatch, a theme swatch (follows
 * light/dark mode), the shared palette swatches, and a custom color well. Emits
 * `noneValue` / `themeValue` for those two, otherwise a hex.
 */
@Component({
   selector: 'dd-color-swatches',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [IconComponent],
   template: `
      @if (deckTheme(); as t) {
         <div class="deck-label">{{ t.name }} theme</div>
         <div class="grid deck" [style.grid-template-columns]="'repeat(' + columns() + ', 26px)'">
            @for (k of tokens; track k) {
               <button
                  type="button"
                  class="sw"
                  [class.active]="current() === norm(token(k))"
                  [class.none]="t.colors[k] === 'transparent'"
                  [style.background]="t.colors[k] === 'transparent' ? null : css(t.colors[k])"
                  [attr.title]="labels[k] + ' (follows the theme)'"
                  [attr.aria-label]="'Theme ' + labels[k]"
                  [disabled]="disabled()"
                  (click)="pick.emit(token(k))"
               ></button>
            }
         </div>
      }
      <div class="grid" [style.grid-template-columns]="'repeat(' + columns() + ', 26px)'">
         @if (allowNone()) {
            <button
               type="button"
               class="sw none"
               [class.active]="current() === norm(noneValue())"
               [attr.title]="noneLabel()"
               [attr.aria-label]="noneLabel()"
               [disabled]="disabled()"
               (click)="pick.emit(noneValue())"
            ></button>
         }
         @if (themeValue() !== null) {
            <button
               type="button"
               class="sw theme"
               [class.active]="current() === norm(themeValue())"
               title="Theme color - adapts to light/dark mode"
               aria-label="Theme color (adapts to light/dark mode)"
               [disabled]="disabled()"
               (click)="pick.emit(themeValue()!)"
            >
               <dd-icon name="contrast" />
            </button>
         }
         @for (c of colors(); track c) {
            <button
               type="button"
               class="sw"
               [class.active]="current() === c"
               [style.background]="c"
               [attr.aria-label]="c"
               [disabled]="disabled()"
               (click)="pick.emit(c)"
            ></button>
         }
         <label
            class="sw custom"
            [class.active]="isCustom()"
            title="Custom color"
            [style.background]="isCustom() ? current() : null"
         >
            <dd-icon name="colorize" />
            <input
               type="color"
               [value]="isCustom() ? current() : '#ffffff'"
               [disabled]="disabled()"
               (change)="pick.emit($any($event.target).value)"
            />
         </label>
      </div>
   `,
   styles: [
      `
         :host {
            display: block;
         }
         .grid {
            display: grid;
            gap: 6px;
         }
         .deck-label {
            font-size: 11px;
            color: var(--dd-text-muted);
            margin-bottom: 4px;
         }
         .grid.deck {
            padding-bottom: 8px;
            margin-bottom: 8px;
            border-bottom: 1px solid var(--dd-border);
         }
         .sw {
            width: 26px;
            height: 26px;
            border-radius: 6px;
            border: 1px solid var(--dd-border);
            cursor: pointer;
            padding: 0;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: var(--dd-text-muted);
            background: transparent;
            --dd-icon-size: 16px;
         }
         .sw:disabled {
            cursor: default;
            opacity: 0.5;
         }
         .sw.none {
            background-image: linear-gradient(
               45deg,
               transparent 45%,
               var(--dd-danger) 45%,
               var(--dd-danger) 55%,
               transparent 55%
            );
         }
         .sw.theme {
            background: linear-gradient(135deg, #ffffff 0 50%, #1e293b 50% 100%);
            color: #64748b;
            --dd-icon-size: 14px;
         }
         .sw.custom {
            position: relative;
            overflow: hidden;
         }
         .sw.custom input {
            position: absolute;
            inset: 0;
            opacity: 0;
            cursor: pointer;
         }
         .sw.active {
            outline: 2px solid var(--dd-primary);
            outline-offset: 1px;
            border-color: var(--dd-primary);
         }
      `,
   ],
})
export class ColorSwatchesComponent {
   /** The current color (hex); empty/undefined = no color. */
   readonly value = input<string | null | undefined>('');
   readonly colors = input<readonly string[]>(PICKER_SWATCHES);
   readonly allowNone = input(true);
   readonly noneLabel = input('No color');
   /** What "no color" emits (and matches as active); `''` clears the field. */
   readonly noneValue = input('');
   /** What the theme swatch emits; null hides it. */
   readonly themeValue = input<string | null>(null);
   readonly columns = input(6);
   /** A slide deck's theme: shows its color tokens (emitted as `$accent1`, ...) above the palette. */
   readonly deckTheme = input<SlideTheme | null>(null);
   readonly disabled = input(false);
   readonly pick = output<string>();

   protected readonly current = computed(() => this.norm(this.value()));
   protected readonly isCustom = computed(() => {
      const c = this.current();
      return (
         !!c &&
         !c.startsWith('$') &&
         c !== this.norm(this.noneValue()) &&
         c !== this.norm(this.themeValue()) &&
         !this.colors().includes(c)
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
