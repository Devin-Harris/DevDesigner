import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BarListComponent } from '../../components/bar-list/bar-list.component';
import { DataTableComponent } from '../../components/data-table/data-table.component';
import { KpiTileComponent } from '../../components/kpi-tile/kpi-tile.component';
import { LineChartComponent } from '../../components/line-chart/line-chart.component';
import { humanize } from '../../helpers/admin-format.helpers';
import type { BarItem, ChartSeries, TableColumn, TableRow } from '../../models/admin.models';
import { AdminFormatPipe } from '../../pipes/admin-format.pipe';
import { AdminStore } from '../../state/admin/admin.store';
import { IconComponent } from '../../../../shared/ui/components/icon/icon.component';

const PROJECT_COLUMNS: TableColumn[] = [
   { key: 'name', label: 'Project' },
   { key: 'tables', label: 'Tables', format: 'count', align: 'end' },
   { key: 'elements', label: 'Elements', format: 'count', align: 'end' },
   { key: 'imageBytes', label: 'Media', format: 'bytes', align: 'end' },
   { key: 'shares', label: 'Links', format: 'count', align: 'end' },
   { key: 'lastOpenedAt', label: 'Last opened', format: 'date' },
   { key: 'createdAt', label: 'Created', format: 'date' },
];

const TOKEN_COLUMNS: TableColumn[] = [
   { key: 'name', label: 'Token' },
   { key: 'prefix', label: 'Prefix' },
   { key: 'scope', label: 'Scope' },
   { key: 'status', label: 'Status' },
   { key: 'lastUsedAt', label: 'Last used', format: 'date' },
   { key: 'createdAt', label: 'Created', format: 'date' },
];

/** One account: metadata, 90-day activity, top features, projects (names and sizes only) and tokens. */
@Component({
   selector: 'dd-admin-user-detail',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [
      AdminFormatPipe,
      BarListComponent,
      DataTableComponent,
      IconComponent,
      KpiTileComponent,
      LineChartComponent,
      RouterLink,
   ],
   templateUrl: './user-detail.component.html',
   styleUrl: './user-detail.component.scss',
})
export class UserDetailComponent {
   protected readonly store = inject(AdminStore);

   protected readonly projectColumns = PROJECT_COLUMNS;
   protected readonly tokenColumns = TOKEN_COLUMNS;
   protected readonly view$ = this.store.userDetailView;
   protected readonly user$ = computed(() => {
      const user = this.view$().value;
      return user && user.id === this.store.userId() ? user : null;
   });
   protected readonly activity$ = computed<ChartSeries[]>(() => {
      const user = this.user$();
      return user ? [{ id: 'activity', label: 'Events per day', slot: 1, points: user.activity }] : [];
   });
   protected readonly features$ = computed<BarItem[]>(
      () => this.user$()?.topFeatures.map((f) => ({ key: f.key, label: humanize(f.key), value: f.count })) ?? []
   );
   protected readonly projects$ = computed<TableRow[]>(
      () =>
         this.user$()?.projectList.map((p) => ({
            id: p.id,
            name: p.archived ? `${p.name} (archived)` : p.name,
            tables: p.tables,
            elements: p.elements,
            imageBytes: p.imageBytes,
            shares: p.activeShareLinks,
            lastOpenedAt: p.lastOpenedAt,
            createdAt: p.createdAt,
         })) ?? []
   );
   protected readonly tokens$ = computed<TableRow[]>(
      () =>
         this.user$()?.tokens.map((t) => ({
            id: t.id,
            name: t.name,
            prefix: t.prefix,
            scope: t.scope,
            status: t.revokedAt ? 'Revoked' : 'Active',
            lastUsedAt: t.lastUsedAt,
            createdAt: t.createdAt,
         })) ?? []
   );

   constructor() {
      inject(ActivatedRoute)
         .paramMap.pipe(takeUntilDestroyed())
         .subscribe((params) => this.store.setUserId(params.get('userId')));
      this.store.connect('userDetail');
   }
}
