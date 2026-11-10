import { ChangeDetectionStrategy, Component, forwardRef, input, signal } from '@angular/core';
import { NG_VALUE_ACCESSOR, type ControlValueAccessor } from '@angular/forms';

/** Bespoke slide toggle replacing mat-slide-toggle. CVA-compatible. */
@Component({
   selector: 'dd-toggle',
   standalone: true,
   changeDetection: ChangeDetectionStrategy.OnPush,
   providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => ToggleComponent), multi: true }],
   template: `
      <button
         type="button"
         class="dd-toggle"
         role="switch"
         [attr.aria-checked]="on()"
         [disabled]="disabled()"
         (click)="toggle()"
      >
         <span class="track" [class.on]="on()"><span class="thumb"></span></span>
         <span class="label"><ng-content /></span>
      </button>
   `,
   styles: [
      `
         :host {
            display: inline-flex;
         }
         .dd-toggle {
            display: inline-flex;
            align-items: center;
            gap: 9px;
            border: none;
            background: transparent;
            padding: 0;
            cursor: pointer;
            color: var(--dd-text);
            font: inherit;
            font-size: 12.5px;
         }
         .dd-toggle:disabled {
            opacity: 0.5;
            cursor: default;
         }
         .track {
            position: relative;
            width: 34px;
            height: 20px;
            border-radius: 999px;
            background: var(--dd-border-strong);
            transition: background 0.14s ease;
         }
         .track.on {
            background: var(--dd-primary);
         }
         .thumb {
            position: absolute;
            top: 2px;
            left: 2px;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: #fff;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
            transition: transform 0.14s ease;
         }
         .track.on .thumb {
            transform: translateX(14px);
         }
      `,
   ],
})
export class ToggleComponent implements ControlValueAccessor {
   readonly disabled = signal(false);
   protected readonly on = signal(false);
   protected onChange: (v: boolean) => void = () => {};
   protected onTouched: () => void = () => {};

   protected toggle(): void {
      const next = !this.on();
      this.on.set(next);
      this.onChange(next);
      this.onTouched();
   }

   writeValue(v: boolean): void {
      this.on.set(!!v);
   }
   registerOnChange(fn: (v: boolean) => void): void {
      this.onChange = fn;
   }
   registerOnTouched(fn: () => void): void {
      this.onTouched = fn;
   }
   setDisabledState(isDisabled: boolean): void {
      this.disabled.set(isDisabled);
   }
}
