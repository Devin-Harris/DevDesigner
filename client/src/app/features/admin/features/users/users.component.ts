import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { debounceTime, distinctUntilChanged, skip } from 'rxjs';
import type { AdminUserSort } from '@devdesigner/shared';
import { DataTableComponent } from '../../components/data-table/data-table.component';
import { ADMIN_PAGE_SIZE, type TableColumn, type TableRow } from '../../models/admin.models';
import { AdminStore } from '../../state/admin/admin.store';
import { InputComponent } from '../../../../shared/ui/components/input/input.component';

const COLUMNS: TableColumn[] = [
   { key: 'email', label: 'Email', sortable: true },
   { key: 'displayName', label: 'Name' },
   { key: 'method', label: 'Sign-in' },
   { key: 'role', label: 'Role' },
   { key: 'createdAt', label: 'Joined', format: 'date', sortable: true },
   { key: 'lastSeenAt', label: 'Last seen', format: 'date', sortable: true },
   { key: 'projects', label: 'Projects', format: 'count', sortable: true, align: 'end' },
   { key: 'bytes', label: 'Media', format: 'bytes', sortable: true, align: 'end' },
   { key: 'activeTokens', label: 'Tokens', format: 'count', align: 'end' },
];

/** Paged, searchable, sortable user list; a row opens the user's detail page. */
@Component({
   selector: 'dd-admin-users',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [DataTableComponent, FormsModule, InputComponent],
   templateUrl: './users.component.html',
   styleUrl: './users.component.scss',
})
export class UsersComponent {
   private readonly router = inject(Router);
   protected readonly store = inject(AdminStore);

   protected readonly columns = COLUMNS;
   protected readonly pageSize = ADMIN_PAGE_SIZE;
   protected readonly view$ = this.store.usersView;
   protected readonly query$ = this.store.users;
   protected readonly term$ = signal(this.store.users().q);
   protected readonly rows$ = computed<TableRow[]>(
      () =>
         this.view$().value?.items.map((u) => ({
            id: u.id,
            email: u.email,
            displayName: u.displayName,
            method: u.method,
            role: u.role,
            createdAt: u.createdAt,
            lastSeenAt: u.lastSeenAt,
            projects: u.projects,
            bytes: u.imageBytes,
            activeTokens: u.activeTokens,
         })) ?? []
   );

   constructor() {
      this.store.connect('users');
      toObservable(this.term$)
         .pipe(skip(1), debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
         .subscribe((q) => this.store.updateUsers({ q }));
   }

   protected sort(column: string): void {
      this.store.sortUsers(column as AdminUserSort);
   }

   protected page(page: number): void {
      this.store.updateUsers({ page });
   }

   protected open(id: string): void {
      void this.router.navigate(['/admin/users', id]);
   }
}
