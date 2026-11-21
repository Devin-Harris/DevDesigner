import { ChangeDetectionStrategy, Component, forwardRef, input, output, signal } from '@angular/core';
import { NG_VALUE_ACCESSOR, type ControlValueAccessor } from '@angular/forms';

/**
 * Bespoke text/number input replacing MatFormField + matInput. Implements
 * ControlValueAccessor so existing `[ngModel]`/`(ngModelChange)` bindings work.
 * Wrap with a `.dd-field` label externally when a caption is needed.
 */
@Component({
   selector: 'dd-input',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [],
   providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => InputComponent), multi: true }],
   templateUrl: './input.component.html',
   styleUrl: './input.component.scss',
})
export class InputComponent implements ControlValueAccessor {
   readonly type$ = input<'text' | 'number' | 'email' | 'password'>('text', { alias: 'type' });
   readonly placeholder$ = input<string>('', { alias: 'placeholder' });
   readonly min$ = input<number | null>(null, { alias: 'min' });
   readonly maxlength$ = input<number | null>(null, { alias: 'maxlength' });
   readonly disabled$ = signal(false);
   /** Fires on native change (blur/Enter) — for commit-on-blur callers. */
   readonly commit = output<string | number>();

   protected readonly value$ = signal<string | number>('');
   protected onChange: (v: string | number) => void = () => {};
   protected onTouched: () => void = () => {};

   protected onInput(event: Event): void {
      const raw = (event.target as HTMLInputElement).value;
      const v = this.type$() === 'number' ? (raw === '' ? '' : Number(raw)) : raw;
      this.value$.set(v);
      this.onChange(v);
   }

   protected onCommit(event: Event): void {
      const raw = (event.target as HTMLInputElement).value;
      this.commit.emit(this.type$() === 'number' ? (raw === '' ? '' : Number(raw)) : raw);
   }

   writeValue(v: string | number | null): void {
      this.value$.set(v ?? '');
   }
   registerOnChange(fn: (v: string | number) => void): void {
      this.onChange = fn;
   }
   registerOnTouched(fn: () => void): void {
      this.onTouched = fn;
   }
   setDisabledState(isDisabled: boolean): void {
      this.disabled$.set(isDisabled);
   }
}
