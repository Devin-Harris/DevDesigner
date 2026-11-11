import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ADMIN_RANGES, type AdminRange } from '@devdesigner/shared';

const LABELS: Readonly<Record<AdminRange, string>> = { '7d': '7 days', '30d': '30 days', '90d': '90 days' };

/** Preset date ranges (last 7 / 30 / 90 days) as a radio group. */
@Component({
   selector: 'dd-admin-date-range-picker',
   changeDetection: ChangeDetectionStrategy.OnPush,
   templateUrl: './date-range-picker.component.html',
   styleUrl: './date-range-picker.component.scss',
})
export class DateRangePickerComponent {
   readonly value$ = input.required<AdminRange>({ alias: 'value' });
   readonly valueChange = output<AdminRange>();

   protected readonly options = ADMIN_RANGES.map((value) => ({ value, label: LABELS[value] }));

   protected onKey(event: KeyboardEvent, index: number): void {
      const step =
         event.key === 'ArrowRight' || event.key === 'ArrowDown'
            ? 1
            : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
              ? -1
              : 0;
      if (step === 0) return;
      event.preventDefault();
      const next = this.options[(index + step + this.options.length) % this.options.length];
      this.valueChange.emit(next.value);
      (
         (event.currentTarget as HTMLElement).parentElement?.children[this.options.indexOf(next)] as
            HTMLElement | undefined
      )?.focus();
   }
}
