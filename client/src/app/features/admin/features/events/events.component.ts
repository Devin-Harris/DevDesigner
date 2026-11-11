import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ANALYTICS_EVENTS } from '@devdesigner/shared';
import { DataTableComponent } from '../../components/data-table/data-table.component';
import type { TableColumn, TableRow } from '../../models/admin.models';
import { AdminStore } from '../../state/admin/admin.store';
import { SelectComponent, type SelectOption } from '../../../../shared/ui/components/select/select.component';

const COLUMNS: TableColumn[] = [
   { key: 'ts', label: 'Time (UTC)', format: 'datetime' },
   { key: 'name', label: 'Event' },
   { key: 'source', label: 'Source' },
   { key: 'actor', label: 'Actor' },
   { key: 'route', label: 'Route / tool' },
   { key: 'status', label: 'Status', format: 'text' },
   { key: 'durationMs', label: 'Duration', format: 'ms', align: 'end' },
   { key: 'count', label: 'Count', format: 'count', align: 'end' },
   { key: 'props', label: 'Props' },
];

const NAME_OPTIONS: SelectOption[] = [
   { value: '', label: 'All events' },
   ...Object.keys(ANALYTICS_EVENTS).map((name) => ({ value: name, label: name })),
];

/** Raw event explorer (last 7 days, newest first, 50 per page) for checking what capture records. */
@Component({
   selector: 'dd-admin-events',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [DataTableComponent, FormsModule, SelectComponent],
   templateUrl: './events.component.html',
   styleUrl: './events.component.scss',
})
export class EventsComponent {
   protected readonly store = inject(AdminStore);

   protected readonly columns = COLUMNS;
   protected readonly nameOptions = NAME_OPTIONS;
   protected readonly view$ = this.store.eventsView;
   protected readonly query$ = this.store.events;
   protected readonly hasNewer$ = this.store.hasNewerEvents;
   protected readonly nextCursor$ = computed(() =>
      this.view$().stale ? null : (this.view$().value?.nextCursor ?? null)
   );
   protected readonly rows$ = computed<TableRow[]>(
      () =>
         this.view$().value?.items.map((e) => ({
            id: String(e.id),
            ts: e.ts,
            name: e.name,
            source: e.source,
            actor: e.actorId ? `${e.actorType} ${e.actorId.slice(0, 8)}` : e.actorType,
            route: e.mcpTool ?? e.route,
            status: e.status,
            durationMs: e.durationMs,
            count: e.count,
            props: e.props ? JSON.stringify(e.props) : null,
         })) ?? []
   );

   constructor() {
      this.store.connect('events');
   }

   protected filter(name: string): void {
      this.store.filterEvents(name);
   }

   protected older(cursor: number): void {
      this.store.olderEvents(cursor);
   }

   protected newer(): void {
      this.store.newerEvents();
   }
}
