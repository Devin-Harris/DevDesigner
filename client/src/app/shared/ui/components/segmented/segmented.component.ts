import { ChangeDetectionStrategy, Component, forwardRef, input, signal } from '@angular/core';
import { NG_VALUE_ACCESSOR, type ControlValueAccessor } from '@angular/forms';

export interface SegmentedOption<T = string> {
   value: T;
   label: string;
}

/**
 * Bespoke segmented control (replaces mat-button-toggle-group and ad-hoc pill
 * rows). CVA-compatible; options passed via `[options]`.
 */
@Component({
   selector: 'dd-segmented',
   changeDetection: ChangeDetectionStrategy.OnPush,
   providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SegmentedComponent), multi: true }],
   templateUrl: './segmented.component.html',
   styleUrl: './segmented.component.scss',
})
export class SegmentedComponent<T = string> implements ControlValueAccessor {
   readonly options$ = input.required<SegmentedOption<T>[]>({ alias: 'options' });
   readonly disabled$ = signal(false);
   protected readonly value$ = signal<T | null>(null);
   protected onChange: (v: T) => void = () => {};
   protected onTouched: () => void = () => {};

   protected select(v: T): void {
      this.value$.set(v);
      this.onChange(v);
      this.onTouched();
   }

   writeValue(v: T | null): void {
      this.value$.set(v);
   }
   registerOnChange(fn: (v: T) => void): void {
      this.onChange = fn;
   }
   registerOnTouched(fn: () => void): void {
      this.onTouched = fn;
   }
   setDisabledState(isDisabled: boolean): void {
      this.disabled$.set(isDisabled);
   }
}
