import { ChangeDetectionStrategy, Component, forwardRef, input, signal } from '@angular/core';
import { NG_VALUE_ACCESSOR, type ControlValueAccessor } from '@angular/forms';
import { IconComponent } from '../icon/icon.component';

/** Bespoke checkbox replacing mat-checkbox. CVA-compatible (`[ngModel]`). */
@Component({
  selector: 'dbd-checkbox',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => CheckboxComponent), multi: true },
  ],
  template: `
    <button
      type="button"
      class="dbd-checkbox"
      role="checkbox"
      [attr.aria-checked]="checked()"
      [disabled]="disabled()"
      (click)="toggle()"
    >
      <span class="box" [class.on]="checked()">
        @if (checked()) {
          <dbd-icon name="check" />
        }
      </span>
      <span class="label"><ng-content /></span>
    </button>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      .dbd-checkbox {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        border: none;
        background: transparent;
        padding: 2px 0;
        cursor: pointer;
        color: var(--dbd-text);
        font: inherit;
        font-size: 12.5px;
      }
      .dbd-checkbox:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .box {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        border: 1.5px solid var(--dbd-border-strong);
        border-radius: 5px;
        color: #fff;
        --dbd-icon-size: 12px;
        transition:
          background 0.12s ease,
          border-color 0.12s ease;
      }
      .box.on {
        background: var(--dbd-primary);
        border-color: var(--dbd-primary);
      }
    `,
  ],
})
export class CheckboxComponent implements ControlValueAccessor {
  readonly disabled = signal(false);
  protected readonly checked = signal(false);
  protected onChange: (v: boolean) => void = () => {};
  protected onTouched: () => void = () => {};

  protected toggle(): void {
    const next = !this.checked();
    this.checked.set(next);
    this.onChange(next);
    this.onTouched();
  }

  writeValue(v: boolean): void {
    this.checked.set(!!v);
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
