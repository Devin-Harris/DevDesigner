import { ChangeDetectionStrategy, Component, forwardRef, input, signal } from '@angular/core';
import { NG_VALUE_ACCESSOR, type ControlValueAccessor } from '@angular/forms';

/** Bespoke slide toggle replacing mat-slide-toggle. CVA-compatible. */
@Component({
   selector: 'dd-toggle',
   changeDetection: ChangeDetectionStrategy.OnPush,
   providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => ToggleComponent), multi: true }],
   templateUrl: './toggle.component.html',
   styleUrl: './toggle.component.scss',
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
