import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { AdminRange } from '@devdesigner/shared';
import { BarListComponent } from '../../components/bar-list/bar-list.component';
import { DataTableComponent } from '../../components/data-table/data-table.component';
import { DateRangePickerComponent } from '../../components/date-range-picker/date-range-picker.component';
import { KpiTileComponent } from '../../components/kpi-tile/kpi-tile.component';
import { LineChartComponent } from '../../components/line-chart/line-chart.component';
import { humanize } from '../../helpers/admin-format.helpers';
import type { BarItem, ChartSeries, TableColumn, TableRow } from '../../models/admin.models';
import { AdminStore } from '../../state/admin/admin.store';

const GROUP_COLUMNS: TableColumn[] = [
   { key: 'status', label: 'Status', format: 'text' },
   { key: 'route', label: 'Route' },
   { key: 'count', label: 'Count', format: 'count', align: 'end' },
   { key: 'firstSeen', label: 'First seen', format: 'datetime' },
   { key: 'lastSeen', label: 'Last seen', format: 'datetime' },
   { key: 'requestId', label: 'Sample request id' },
];

const SLOW_COLUMNS: TableColumn[] = [
   { key: 'route', label: 'Route' },
   { key: 'count', label: 'Slow requests', format: 'count', align: 'end' },
   { key: 'p95Ms', label: 'p95', format: 'ms', align: 'end' },
   { key: 'maxMs', label: 'Max', format: 'ms', align: 'end' },
];

/** Error rate, server errors over time, errors grouped by route and status, slow routes, client errors. */
@Component({
   selector: 'dd-admin-errors',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [BarListComponent, DataTableComponent, DateRangePickerComponent, KpiTileComponent, LineChartComponent],
   templateUrl: './errors.component.html',
   styleUrl: './errors.component.scss',
})
export class ErrorsComponent {
   protected readonly store = inject(AdminStore);

   protected readonly groupColumns = GROUP_COLUMNS;
   protected readonly slowColumns = SLOW_COLUMNS;
   protected readonly view$ = this.store.errorsView;
   protected readonly range$ = this.store.range;

   protected readonly rate$ = computed(() => {
      const value = this.view$().value;
      return value && value.requests > 0 ? Math.round((value.serverErrors / value.requests) * 10_000) / 100 : null;
   });
   protected readonly series$ = computed<ChartSeries[]>(() => {
      const value = this.view$().value;
      return value ? [{ id: 'errors', label: 'Server errors (5xx)', slot: 1, points: value.series }] : [];
   });
   protected readonly groups$ = computed<TableRow[]>(
      () =>
         this.view$().value?.groups.map((g) => ({
            id: `${g.status} ${g.route}`,
            status: g.status,
            route: g.route,
            count: g.count,
            firstSeen: g.firstSeen,
            lastSeen: g.lastSeen,
            requestId: g.sampleRequestId,
         })) ?? []
   );
   protected readonly slow$ = computed<TableRow[]>(
      () => this.view$().value?.slow.map((s) => ({ id: s.route, ...s })) ?? []
   );
   protected readonly client$ = computed<BarItem[]>(
      () => this.view$().value?.clientEvents.map((c) => ({ key: c.key, label: humanize(c.key), value: c.count })) ?? []
   );

   constructor() {
      this.store.connect('errors');
   }

   protected setRange(range: AdminRange): void {
      this.store.setRange(range);
   }
}
