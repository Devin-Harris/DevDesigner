import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { AdminCount, AdminHygienePreviewResponse } from '@devdesigner/shared';
import { BarListComponent } from '../../components/bar-list/bar-list.component';
import { DataTableComponent } from '../../components/data-table/data-table.component';
import { KpiTileComponent } from '../../components/kpi-tile/kpi-tile.component';
import { StatBarComponent } from '../../components/stat-bar/stat-bar.component';
import { humanize } from '../../helpers/admin-format.helpers';
import type { BarItem, StatSegment, TableColumn, TableRow } from '../../models/admin.models';
import { AdminFormatPipe } from '../../pipes/admin-format.pipe';
import { AdminApiService } from '../../services/admin-api.service';
import { AdminStore } from '../../state/admin/admin.store';

const LARGEST_COLUMNS: TableColumn[] = [
   { key: 'name', label: 'Project' },
   { key: 'ownerKind', label: 'Owner' },
   { key: 'tables', label: 'Tables', format: 'count', align: 'end' },
   { key: 'elements', label: 'Elements', format: 'count', align: 'end' },
   { key: 'textBytes', label: 'Text', format: 'bytes', align: 'end' },
   { key: 'imageBytes', label: 'Media', format: 'bytes', align: 'end' },
];

const segments = (counts: readonly AdminCount[]): StatSegment[] =>
   counts.map((c) => ({ key: c.key, label: humanize(c.key), value: c.count }));

/** What the app database holds: sizes, row counts, media, project activity, accounts and links. */
@Component({
   selector: 'dd-admin-storage',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [AdminFormatPipe, BarListComponent, DataTableComponent, KpiTileComponent, StatBarComponent],
   templateUrl: './storage.component.html',
   styleUrl: './storage.component.scss',
})
export class StorageComponent {
   protected readonly store = inject(AdminStore);
   private readonly adminApi = inject(AdminApiService);

   /** Cleanup dry run (POST /admin/hygiene/preview); only fetched on request. */
   protected readonly hygiene$ = signal<AdminHygienePreviewResponse | null>(null);
   protected readonly hygieneLoading$ = signal(false);
   protected readonly hygieneError$ = signal<string | null>(null);

   protected readonly largestColumns = LARGEST_COLUMNS;
   protected readonly view$ = this.store.storageView;

   protected readonly dbBytes$ = computed(() => {
      const db = this.view$().value?.database;
      return db ? db.pageCount * db.pageSize : null;
   });
   protected readonly freeBytes$ = computed(() => {
      const db = this.view$().value?.database;
      return db ? db.freelistCount * db.pageSize : null;
   });
   protected readonly mediaBytes$ = computed(
      () => this.view$().value?.images.reduce((sum, i) => sum + i.bytes, 0) ?? null
   );
   protected readonly rows$ = computed<BarItem[]>(
      () => this.view$().value?.rows.map((r) => ({ key: r.key, label: r.key, value: r.count })) ?? []
   );
   protected readonly tableBytes$ = computed<BarItem[]>(
      () => this.view$().value?.tableBytes?.map((t) => ({ key: t.name, label: t.name, value: t.bytes })) ?? []
   );
   protected readonly elementTypes$ = computed<BarItem[]>(
      () =>
         this.view$().value?.elementsByType.map((e) => ({ key: e.key, label: humanize(e.key), value: e.count })) ?? []
   );
   protected readonly images$ = computed<BarItem[]>(
      () =>
         this.view$().value?.images.map((i) => ({
            key: i.mimeType,
            label: i.mimeType,
            value: i.bytes,
            note: `${i.count} files`,
         })) ?? []
   );
   protected readonly activity$ = computed(() => segments(this.view$().value?.projectActivity ?? []));
   protected readonly auth$ = computed(() => segments(this.view$().value?.authMethods ?? []));
   protected readonly shares$ = computed(() => segments(this.view$().value?.activeShareLinks ?? []));
   protected readonly perUser$ = computed<BarItem[]>(
      () =>
         this.view$().value?.projectsPerUser.map((b) => ({
            key: b.key,
            label: `${b.key} project${b.key === '1' ? '' : 's'}`,
            value: b.count,
         })) ?? []
   );
   protected readonly tokens$ = computed<BarItem[]>(
      () =>
         this.view$().value?.apiTokens.map((t) => ({
            key: t.scope,
            label: `${humanize(t.scope)} scope`,
            value: t.active,
            note: `of ${t.total}, ${t.used7d} used this week`,
         })) ?? []
   );
   protected readonly largest$ = computed<TableRow[]>(
      () =>
         this.view$().value?.largestProjects.map((p) => ({
            id: p.id,
            name: p.name,
            ownerKind: humanize(p.ownerKind),
            tables: p.tables,
            elements: p.elements,
            textBytes: p.textBytes,
            imageBytes: p.imageBytes,
         })) ?? []
   );

   constructor() {
      this.store.connect('storage');
   }

   protected async runHygienePreview(): Promise<void> {
      this.hygieneLoading$.set(true);
      this.hygieneError$.set(null);
      try {
         this.hygiene$.set(await firstValueFrom(this.adminApi.hygienePreview()));
      } catch {
         this.hygieneError$.set('Could not compute the cleanup preview.');
      } finally {
         this.hygieneLoading$.set(false);
      }
   }
}
