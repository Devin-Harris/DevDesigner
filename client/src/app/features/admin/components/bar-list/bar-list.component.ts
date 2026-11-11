import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import type { AdminValueFormat, BarItem } from '../../models/admin.models';
import { AdminFormatPipe } from '../../pipes/admin-format.pipe';

/** Horizontal top-N bars: label, bar scaled to the largest value, value at the bar end. */
@Component({
   selector: 'dd-admin-bar-list',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [AdminFormatPipe],
   templateUrl: './bar-list.component.html',
   styleUrl: './bar-list.component.scss',
})
export class BarListComponent {
   readonly items$ = input.required<readonly BarItem[]>({ alias: 'items' });
   /** Accessible name of the list. */
   readonly label$ = input.required<string>({ alias: 'label' });
   readonly format$ = input<AdminValueFormat>('count', { alias: 'format' });
   /** Rows shown before "Show all". */
   readonly limit$ = input(8, { alias: 'limit' });
   readonly emptyText$ = input('Nothing recorded yet', { alias: 'emptyText' });

   protected readonly expanded$ = signal(false);

   protected readonly rows$ = computed(() => {
      const items = this.items$();
      const max = Math.max(1, ...items.map((i) => i.value));
      const visible = this.expanded$() ? items : items.slice(0, this.limit$());
      return visible.map((item) => ({ ...item, width: Math.max(item.value > 0 ? 1 : 0, (item.value / max) * 100) }));
   });
   protected readonly hidden$ = computed(() => Math.max(0, this.items$().length - this.limit$()));

   protected toggle(): void {
      this.expanded$.update((v) => !v);
   }
}
