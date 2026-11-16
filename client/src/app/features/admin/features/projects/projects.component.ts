import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged, skip } from 'rxjs';
import type { AdminProjectSort } from '@devdesigner/shared';
import { DataTableComponent } from '../../components/data-table/data-table.component';
import { humanize } from '../../helpers/admin-format.helpers';
import { ADMIN_PAGE_SIZE, type TableColumn, type TableRow } from '../../models/admin.models';
import { AdminStore } from '../../state/admin/admin.store';
import { InputComponent } from '../../../../shared/ui/components/input/input.component';

const COLUMNS: TableColumn[] = [
   { key: 'name', label: 'Project' },
   { key: 'owner', label: 'Owner' },
   { key: 'tables', label: 'Tables', format: 'count', align: 'end' },
   { key: 'elements', label: 'Elements', format: 'count', align: 'end' },
   { key: 'size', label: 'Size', format: 'bytes', sortable: true, align: 'end' },
   { key: 'writes', label: 'Writes 30d', format: 'count', sortable: true, align: 'end' },
   { key: 'shares', label: 'Links', format: 'count', align: 'end' },
   { key: 'lastOpened', label: 'Last opened', format: 'date', sortable: true },
   { key: 'createdAt', label: 'Created', format: 'date', sortable: true },
];

/** All real projects (no guide sandboxes) with sizes, activity and share links; names only, never content. */
@Component({
   selector: 'dd-admin-projects',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [DataTableComponent, FormsModule, InputComponent],
   templateUrl: './projects.component.html',
   styleUrl: './projects.component.scss',
})
export class ProjectsComponent {
   protected readonly store = inject(AdminStore);

   protected readonly columns = COLUMNS;
   protected readonly pageSize = ADMIN_PAGE_SIZE;
   protected readonly view$ = this.store.projectsView;
   protected readonly query$ = this.store.projects;
   protected readonly term$ = signal(this.store.projects().q);
   protected readonly rows$ = computed<TableRow[]>(
      () =>
         this.view$().value?.items.map((p) => ({
            id: p.id,
            name: p.archived ? `${p.name} (archived)` : p.name,
            owner: p.ownerEmail ?? humanize(p.ownerKind),
            tables: p.tables,
            elements: p.elements,
            size: p.imageBytes + p.textBytes,
            writes: p.writes30d,
            shares: p.activeShareLinks,
            lastOpened: p.lastOpenedAt,
            createdAt: p.createdAt,
         })) ?? []
   );

   constructor() {
      this.store.connect('projects');
      toObservable(this.term$)
         .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
         .subscribe((q) => this.store.updateProjects({ q }));
   }

   protected sort(column: string): void {
      this.store.sortProjects(column as AdminProjectSort);
   }

   protected page(page: number): void {
      this.store.updateProjects({ page });
   }
}
