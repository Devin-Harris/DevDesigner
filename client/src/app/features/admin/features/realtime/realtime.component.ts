import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';
import { DataTableComponent } from '../../components/data-table/data-table.component';
import { KpiTileComponent } from '../../components/kpi-tile/kpi-tile.component';
import { LineChartComponent } from '../../components/line-chart/line-chart.component';
import type { ChartSeries, TableColumn, TableRow } from '../../models/admin.models';
import { AdminFormatPipe } from '../../pipes/admin-format.pipe';
import { AdminStore } from '../../state/admin/admin.store';

/** Live rooms are refetched this often while the page is open. */
const REFRESH_MS = 15_000;

const ROOM_COLUMNS: TableColumn[] = [
   { key: 'project', label: 'Project' },
   { key: 'participants', label: 'People', format: 'count', align: 'end' },
   { key: 'editors', label: 'Editing', format: 'count', align: 'end' },
   { key: 'viewers', label: 'Viewing', format: 'count', align: 'end' },
   { key: 'presenters', label: 'Presenting', format: 'count', align: 'end' },
];

/** Who is collaborating right now (counts only, no names) plus 30 days of joins and session length. */
@Component({
   selector: 'dd-admin-realtime',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [AdminFormatPipe, DataTableComponent, KpiTileComponent, LineChartComponent],
   templateUrl: './realtime.component.html',
   styleUrl: './realtime.component.scss',
})
export class RealtimeComponent {
   protected readonly store = inject(AdminStore);

   protected readonly columns = ROOM_COLUMNS;
   protected readonly view$ = this.store.realtimeView;
   protected readonly rooms$ = computed<TableRow[]>(
      () =>
         this.view$().value?.rooms.map((r) => ({
            id: r.projectId,
            project: r.projectName ?? r.projectId,
            participants: r.participants,
            editors: r.editors,
            viewers: r.viewers,
            presenters: r.presenters,
         })) ?? []
   );
   protected readonly joins$ = computed<ChartSeries[]>(() => {
      const value = this.view$().value;
      return value ? [{ id: 'joins', label: 'Joins', slot: 1, points: value.joins }] : [];
   });

   constructor() {
      this.store.connect('realtime');
      interval(REFRESH_MS)
         .pipe(takeUntilDestroyed())
         .subscribe(() => this.store.reload('realtime'));
   }

   protected refresh(): void {
      this.store.reload('realtime');
   }
}
