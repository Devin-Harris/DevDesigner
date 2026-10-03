import { ChangeDetectionStrategy, Component, computed, forwardRef, input, signal } from '@angular/core';
import { NG_VALUE_ACCESSOR, type ControlValueAccessor } from '@angular/forms';
import { IconComponent } from '../icon/icon.component';
import { PopoverTriggerDirective } from '../popover/popover-trigger.directive';

export interface SelectOption<T = string> {
  value: T;
  label: string;
}

/**
 * Bespoke dropdown select (replaces MatSelect), built on the popover primitive.
 * CVA-compatible. Options via `[options]`; supports a compact variant for inline
 * use (e.g. column type in a table row).
 */
@Component({
  selector: 'dbd-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, PopoverTriggerDirective],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SelectComponent), multi: true },
  ],
  template: `
    <button
      type="button"
      class="dbd-select-trigger"
      [class.compact]="compact()"
      [dbdPopoverTrigger]="menu"
      placement="below-start"
      [disabled]="disabled()"
    >
      <span class="val">{{ selectedLabel() }}</span>
      <dbd-icon name="arrow_drop_down" class="chev" />
    </button>
    <ng-template #menu let-close>
      <div class="dbd-menu dbd-select-menu">
        @for (opt of options(); track opt.value) {
          <button
            type="button"
            class="dbd-menu-item"
            [class.on]="opt.value === value()"
            (click)="pick(opt.value); close()"
          >
            {{ opt.label }}
          </button>
        }
      </div>
    </ng-template>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .dbd-select-trigger {
        display: inline-flex;
        align-items: center;
        justify-content: space-between;
        gap: 4px;
        width: 100%;
        box-sizing: border-box;
        height: 34px;
        padding: 0 6px 0 10px;
        font: inherit;
        font-family: var(--dbd-font);
        font-size: 13px;
        color: var(--dbd-text);
        background: var(--dbd-surface-2);
        border: 1px solid var(--dbd-border);
        border-radius: var(--dbd-radius-sm);
        cursor: pointer;
        transition: border-color 0.12s ease;
      }
      .dbd-select-trigger.compact {
        height: 24px;
        font-family: var(--dbd-mono);
        font-size: 11px;
        padding: 0 3px 0 7px;
        color: var(--dbd-text-muted);
      }
      .dbd-select-trigger:hover:not(:disabled) {
        border-color: var(--dbd-border-strong);
      }
      .dbd-select-trigger:disabled {
        opacity: 0.55;
        cursor: default;
      }
      .val {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .chev {
        --dbd-icon-size: 16px;
        color: var(--dbd-text-muted);
      }
    `,
  ],
})
export class SelectComponent<T = string> implements ControlValueAccessor {
  readonly options = input.required<SelectOption<T>[]>();
  readonly compact = input<boolean>(false);
  readonly placeholder = input<string>('Select');
  readonly disabled = signal(false);
  protected readonly value = signal<T | null>(null);

  protected readonly selectedLabel = computed(() => {
    const v = this.value();
    return this.options().find((o) => o.value === v)?.label ?? this.placeholder();
  });

  protected onChange: (v: T) => void = () => {};
  protected onTouched: () => void = () => {};

  protected pick(v: T): void {
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
