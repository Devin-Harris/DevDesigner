import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { AdminRange } from '@devdesigner/shared';
import { BarListComponent } from '../../components/bar-list/bar-list.component';
import { DataTableComponent } from '../../components/data-table/data-table.component';
import { DateRangePickerComponent } from '../../components/date-range-picker/date-range-picker.component';
import { StatBarComponent } from '../../components/stat-bar/stat-bar.component';
import { formatMs, humanize } from '../../helpers/admin-format.helpers';
import type { BarItem, StatSegment, TableColumn, TableRow } from '../../models/admin.models';
import { AdminStore } from '../../state/admin/admin.store';

const TOKEN_COLUMNS: TableColumn[] = [
   { key: 'prefix', label: 'Prefix' },
   { key: 'name', label: 'Name' },
   { key: 'owner', label: 'Owner' },
   { key: 'scope', label: 'Scope' },
   { key: 'calls', label: 'Calls', format: 'count', align: 'end' },
   { key: 'errors', label: 'Errors', format: 'count', align: 'end' },
   { key: 'tools', label: 'Top tools' },
   { key: 'lastUsedAt', label: 'Last used', format: 'date' },
   { key: 'status', label: 'Status' },
];

/** API tokens and MCP: calls and errors per token, the MCP tool leaderboard, routes and sources. */
@Component({
   selector: 'dd-admin-api-tokens',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [BarListComponent, DataTableComponent, DateRangePickerComponent, StatBarComponent],
   templateUrl: './api-tokens.component.html',
   styleUrl: './api-tokens.component.scss',
})
export class ApiTokensComponent {
   protected readonly store = inject(AdminStore);

   protected readonly columns = TOKEN_COLUMNS;
   protected readonly view$ = this.store.apiTokensView;
   protected readonly range$ = this.store.range;

   protected readonly tokens$ = computed<TableRow[]>(
      () =>
         this.view$().value?.tokens.map((t) => ({
            id: t.id,
            prefix: t.prefix,
            name: t.name,
            owner: t.ownerEmail,
            scope: t.scope,
            calls: t.calls,
            errors: t.errors,
            tools: t.topTools.map((tool) => tool.key).join(', '),
            lastUsedAt: t.lastUsedAt,
            status: t.revokedAt ? 'Revoked' : 'Active',
         })) ?? []
   );
   protected readonly tools$ = computed<BarItem[]>(
      () =>
         this.view$().value?.tools.map((t) => ({
            key: t.key,
            label: t.key,
            value: t.count,
            note: [t.errors ? `${t.errors} errors` : '', t.p95Ms !== null ? `p95 ${formatMs(t.p95Ms)}` : '']
               .filter(Boolean)
               .join(' · '),
         })) ?? []
   );
   protected readonly routes$ = computed<BarItem[]>(
      () => this.view$().value?.routes.map((r) => ({ key: r.key, label: r.key, value: r.count })) ?? []
   );
   protected readonly sources$ = computed<StatSegment[]>(
      () =>
         this.view$().value?.sources.map((s) => ({
            key: s.key,
            label: s.key === 'mcp' ? 'MCP server' : humanize(s.key === 'api' ? 'direct API' : s.key),
            value: s.count,
         })) ?? []
   );

   constructor() {
      this.store.connect('apiTokens');
   }

   protected setRange(range: AdminRange): void {
      this.store.setRange(range);
   }
}
