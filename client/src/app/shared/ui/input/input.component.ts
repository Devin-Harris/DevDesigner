import {
  ChangeDetectionStrategy,
  Component,
  forwardRef,
  input,
  output,
  signal,
} from '@angular/core';
import { NG_VALUE_ACCESSOR, type ControlValueAccessor } from '@angular/forms';

/**
 * Bespoke text/number input replacing MatFormField + matInput. Implements
 * ControlValueAccessor so existing `[ngModel]`/`(ngModelChange)` bindings work.
 * Wrap with a `.dbd-field` label externally when a caption is needed.
 */
@Component({
  selector: 'dbd-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => InputComponent), multi: true },
  ],
  template: `
    <input
      class="dbd-input"
      [type]="type()"
      [attr.placeholder]="placeholder()"
      [attr.min]="min()"
      [attr.maxlength]="maxlength()"
      [disabled]="disabled()"
      [value]="value()"
      (input)="onInput($event)"
      (change)="onCommit($event)"
      (blur)="onTouched()"
    />
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .dbd-input {
        width: 100%;
        box-sizing: border-box;
        height: 34px;
        padding: 0 10px;
        font: inherit;
        font-family: var(--dbd-font);
        font-size: 13px;
        color: var(--dbd-text);
        background: var(--dbd-surface-2);
        border: 1px solid var(--dbd-border);
        border-radius: var(--dbd-radius-sm);
        outline: none;
        transition:
          border-color 0.12s ease,
          box-shadow 0.12s ease;
      }
      .dbd-input::placeholder {
        color: var(--dbd-faint, var(--dbd-text-muted));
      }
      .dbd-input:hover:not(:disabled) {
        border-color: var(--dbd-border-strong);
      }
      .dbd-input:focus {
        border-color: var(--dbd-primary);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--dbd-primary) 22%, transparent);
      }
      .dbd-input:disabled {
        opacity: 0.55;
        cursor: default;
      }
    `,
  ],
})
export class InputComponent implements ControlValueAccessor {
  readonly type = input<'text' | 'number' | 'email' | 'password'>('text');
  readonly placeholder = input<string>('');
  readonly min = input<number | null>(null);
  readonly maxlength = input<number | null>(null);
  readonly disabled = signal(false);
  /** Fires on native change (blur/Enter) — for commit-on-blur callers. */
  readonly commit = output<string | number>();

  protected readonly value = signal<string | number>('');
  protected onChange: (v: string | number) => void = () => {};
  protected onTouched: () => void = () => {};

  protected onInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const v = this.type() === 'number' ? (raw === '' ? '' : Number(raw)) : raw;
    this.value.set(v);
    this.onChange(v);
  }

  protected onCommit(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.commit.emit(this.type() === 'number' ? (raw === '' ? '' : Number(raw)) : raw);
  }

  writeValue(v: string | number | null): void {
    this.value.set(v ?? '');
  }
  registerOnChange(fn: (v: string | number) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }
}
