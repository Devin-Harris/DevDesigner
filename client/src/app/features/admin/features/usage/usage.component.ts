import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ADMIN_METRICS, type AdminFeatureUsage, type AdminMetric, type AdminRange } from '@devdesigner/shared';
import { BarListComponent } from '../../components/bar-list/bar-list.component';
import { DateRangePickerComponent } from '../../components/date-range-picker/date-range-picker.component';
import { LineChartComponent } from '../../components/line-chart/line-chart.component';
import { humanize } from '../../helpers/admin-format.helpers';
import { METRIC_LABELS, type BarItem, type ChartSeries } from '../../models/admin.models';
import { AdminStore } from '../../state/admin/admin.store';
import { SelectComponent, type SelectOption } from '../../../../shared/ui/components/select/select.component';

/** Feature adoption: any metric over time, writes by kind and element type, feature events and exports. */
@Component({
   selector: 'dd-admin-usage',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [BarListComponent, DateRangePickerComponent, FormsModule, LineChartComponent, SelectComponent],
   templateUrl: './usage.component.html',
   styleUrl: './usage.component.scss',
})
export class UsageComponent {
   protected readonly store = inject(AdminStore);

   protected readonly view$ = this.store.featuresView;
   protected readonly series$ = this.store.timeseriesView;
   protected readonly range$ = this.store.range;
   protected readonly metric$ = this.store.metric;
   protected readonly metricOptions: SelectOption<AdminMetric>[] = ADMIN_METRICS.map((value) => ({
      value,
      label: METRIC_LABELS[value],
   }));

   protected readonly chart$ = computed<ChartSeries[]>(() => {
      const ts = this.series$().value;
      return ts ? [{ id: ts.metric, label: METRIC_LABELS[ts.metric], slot: 1, points: ts.points }] : [];
   });
   protected readonly chartLabel$ = computed(() => `${METRIC_LABELS[this.metric$()]} per day`);
   protected readonly kinds$ = computed(() => this.bars(this.view$().value?.writesByKind ?? []));
   protected readonly elementTypes$ = computed(() => this.bars(this.view$().value?.elementTypes ?? []));
   protected readonly events$ = computed(() => this.bars(this.view$().value?.events ?? []));
   protected readonly exports$ = computed<BarItem[]>(
      () =>
         this.view$().value?.exportFormats.map((e) => ({ key: e.key, label: e.key.toUpperCase(), value: e.count })) ??
         []
   );

   constructor() {
      this.store.connect('features');
      this.store.connect('timeseries');
   }

   protected setRange(range: AdminRange): void {
      this.store.setRange(range);
   }

   protected setMetric(metric: AdminMetric): void {
      this.store.setMetric(metric);
   }

   private bars(items: readonly AdminFeatureUsage[]): BarItem[] {
      const active = this.view$().value?.activeUsers ?? 0;
      return items.map((item) => ({
         key: item.key,
         label: humanize(item.key),
         value: item.count,
         note: active > 0 ? `${Math.round((item.users / active) * 100)}% of users` : undefined,
      }));
   }
}
