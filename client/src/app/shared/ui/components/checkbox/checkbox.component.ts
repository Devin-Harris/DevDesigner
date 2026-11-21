import { ChangeDetectionStrategy, Component, forwardRef, signal } from '@angular/core';
import { NG_VALUE_ACCESSOR, type ControlValueAccessor } from '@angular/forms';
import { IconComponent } from '../icon/icon.component';

/** Bespoke checkbox replacing mat-checkbox. CVA-compatible (`[ngModel]`). */
@Component({
   selector: 'dd-checkbox',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [IconComponent],
   providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => CheckboxComponent), multi: true }],
   templateUrl: './checkbox.component.html',
   styleUrl: './checkbox.component.scss',
})
export class CheckboxComponent implements ControlValueAccessor {
   readonly disabled$ = signal(false);
   protected readonly checked$ = signal(false);
   protected onChange: (v: boolean) => void = () => {};
   protected onTouched: () => void = () => {};

   protected toggle(): void {
      const next = !this.checked$();
      this.checked$.set(next);
      this.onChange(next);
      this.onTouched();
   }

   writeValue(v: boolean): void {
      this.checked$.set(!!v);
   }
   registerOnChange(fn: (v: boolean) => void): void {
      this.onChange = fn;
   }
   registerOnTouched(fn: () => void): void {
      this.onTouched = fn;
   }
   setDisabledState(isDisabled: boolean): void {
      this.disabled$.set(isDisabled);
   }
}
