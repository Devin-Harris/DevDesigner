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
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SegmentedComponent), multi: true },
  ],
  template: `
    <div class="dd-segmented" role="tablist">
      @for (opt of options(); track opt.value) {
        <button
          type="button"
          class="seg"
          [class.on]="opt.value === value()"
          [disabled]="disabled()"
          (click)="select(opt.value)"
        >
          {{ opt.label }}
        </button>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      .dd-segmented {
        display: inline-flex;
        padding: 3px;
        gap: 2px;
        background: var(--dd-surface-2);
        border: 1px solid var(--dd-border);
        border-radius: var(--dd-radius);
      }
      .seg {
        border: none;
        background: transparent;
        color: var(--dd-text-muted);
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        padding: 5px 12px;
        border-radius: calc(var(--dd-radius) - 3px);
        cursor: pointer;
        transition:
          background 0.12s ease,
          color 0.12s ease;
      }
      .seg:hover:not(:disabled):not(.on) {
        color: var(--dd-text);
      }
      .seg.on {
        background: var(--dd-surface);
        color: var(--dd-text);
        box-shadow: var(--dd-shadow-1);
      }
      .seg:disabled {
        opacity: 0.5;
        cursor: default;
      }
    `,
  ],
})
export class SegmentedComponent<T = string> implements ControlValueAccessor {
  readonly options = input.required<SegmentedOption<T>[]>();
  readonly disabled = signal(false);
  protected readonly value = signal<T | null>(null);
  protected onChange: (v: T) => void = () => {};
  protected onTouched: () => void = () => {};

  protected select(v: T): void {
    this.value.set(v);
    this.onChange(v);
    this.onTouched();
  }

  writeValue(v: T | null): void {
    this.value.set(v);
  }
  registerOnChange(fn: (v: T) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }
}
