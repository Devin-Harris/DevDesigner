import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { AdminKpiKey, AdminOverviewResponse, AdminRange } from '@devdesigner/shared';
import { CohortGridComponent } from '../../components/cohort-grid/cohort-grid.component';
import { DateRangePickerComponent } from '../../components/date-range-picker/date-range-picker.component';
import { KpiTileComponent } from '../../components/kpi-tile/kpi-tile.component';
import { LineChartComponent } from '../../components/line-chart/line-chart.component';
import { KPI_LABELS, KPI_UP_IS_BAD, type ChartSeries } from '../../models/admin.models';
import { AdminStore } from '../../state/admin/admin.store';

/** KPI -> the daily series drawn as its sparkline. */
const TRENDS: Partial<Record<AdminKpiKey, keyof AdminOverviewResponse['series']>> = {
   activeUsers: 'activeUsers',
   dau: 'activeUsers',
   activeGuests: 'activeGuests',
   signups: 'signups',
   projectsCreated: 'projectsCreated',
};

/** Headline KPIs with previous-period deltas, activity and growth over time, retention cohorts. */
@Component({
   selector: 'dd-admin-overview',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [CohortGridComponent, DateRangePickerComponent, KpiTileComponent, LineChartComponent],
   templateUrl: './overview.component.html',
   styleUrl: './overview.component.scss',
})
export class OverviewComponent {
   protected readonly store = inject(AdminStore);

   protected readonly view$ = this.store.overviewView;
   protected readonly retention$ = this.store.retentionView;
   protected readonly range$ = this.store.range;

   protected readonly kpis$ = computed(() => {
      const overview = this.view$().value;
      if (!overview) return [];
      return overview.kpis.map((kpi) => {
         const trend = TRENDS[kpi.key];
         return {
            ...kpi,
            label: KPI_LABELS[kpi.key],
            upIsBad: KPI_UP_IS_BAD.has(kpi.key),
            trend: trend ? overview.series[trend].map((p) => p.value) : [],
            hint: kpi.key === 'dbBytes' ? 'App database file' : kpi.value === null ? 'Analytics is off' : '',
         };
      });
   });
   protected readonly activity$ = computed<ChartSeries[]>(() => {
      const series = this.view$().value?.series;
      if (!series) return [];
      return [
         { id: 'users', label: 'Signed-in users', slot: 1, points: series.activeUsers },
         { id: 'guests', label: 'Guests', slot: 2, points: series.activeGuests },
      ];
   });
   protected readonly growth$ = computed<ChartSeries[]>(() => {
      const series = this.view$().value?.series;
      if (!series) return [];
      return [
         { id: 'signups', label: 'Signups', slot: 1, points: series.signups },
         { id: 'projects', label: 'Projects created', slot: 2, points: series.projectsCreated },
      ];
   });
   protected readonly requests$ = computed<ChartSeries[]>(() => {
      const series = this.view$().value?.series;
      return series ? [{ id: 'requests', label: 'Requests (estimated)', slot: 1, points: series.requests }] : [];
   });
   protected readonly errors$ = computed<ChartSeries[]>(() => {
      const series = this.view$().value?.series;
      return series ? [{ id: 'errors', label: 'Server errors (5xx)', slot: 1, points: series.errors }] : [];
   });

   constructor() {
      this.store.connect('overview');
      this.store.connect('retention');
   }

   protected setRange(range: AdminRange): void {
      this.store.setRange(range);
   }

   protected retry(): void {
      this.store.reload('overview');
      this.store.reload('retention');
   }
}
