import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { AdminSortDir } from '@devdesigner/shared';
import type { TableColumn, TableRow } from '../../models/admin.models';
import { AdminFormatPipe } from '../../pipes/admin-format.pipe';
import { IconComponent } from '../../../../shared/ui/components/icon/icon.component';

/**
 * Sortable, paged table. Sorting and paging are server-side: the table only reports
 * clicks (`sortChange`, `pageChange`); rows with an `id` can be activated (`rowClick`).
 */
@Component({
   selector: 'dd-admin-data-table',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [AdminFormatPipe, IconComponent],
   templateUrl: './data-table.component.html',
   styleUrl: './data-table.component.scss',
})
export class DataTableComponent {
   readonly columns$ = input.required<readonly TableColumn[]>({ alias: 'columns' });
   readonly rows$ = input.required<readonly TableRow[]>({ alias: 'rows' });
   readonly label$ = input.required<string>({ alias: 'label' });
   readonly sort$ = input<string | null>(null, { alias: 'sort' });
   readonly dir$ = input<AdminSortDir>('desc', { alias: 'dir' });
   /** Paging: omit `total` for an unpaged table. */
   readonly page$ = input(1, { alias: 'page' });
   readonly pageSize$ = input(25, { alias: 'pageSize' });
   readonly total$ = input<number | null>(null, { alias: 'total' });
   /** Rows are clickable (activates on click and Enter). */
   readonly clickable$ = input(false, { alias: 'clickable' });
   readonly emptyText$ = input('No rows', { alias: 'emptyText' });

   readonly sortChange = output<string>();
   readonly pageChange = output<number>();
   readonly rowClick = output<string>();

   protected readonly pages$ = computed(() => {
      const total = this.total$();
      return total === null ? 1 : Math.max(1, Math.ceil(total / this.pageSize$()));
   });
   protected readonly range$ = computed(() => {
      const total = this.total$() ?? this.rows$().length;
      const start = total === 0 ? 0 : (this.page$() - 1) * this.pageSize$() + 1;
      return { start, end: Math.min(total, start + this.rows$().length - 1), total };
   });
   protected readonly headers$ = computed(() =>
      this.columns$().map((c) => ({
         ...c,
         active: c.key === this.sort$(),
         ariaSort: c.key === this.sort$() ? (this.dir$() === 'asc' ? 'ascending' : 'descending') : null,
         numeric: c.align === 'end',
      }))
   );

   protected activate(row: TableRow): void {
      if (this.clickable$() && typeof row['id'] === 'string') this.rowClick.emit(row['id']);
   }
}
