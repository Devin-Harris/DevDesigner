import { computed } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { patchState, signalStoreFeature, type, withMethods } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { EMPTY, catchError, filter, mergeMap, pipe, tap } from 'rxjs';
import type { AdminMetric, AdminProjectSort, AdminRange, AdminSortDir, AdminUserSort } from '@devdesigner/shared';
import { requestFor } from '../../../helpers/admin-request.helpers';
import {
   ADMIN_CACHE_MS,
   type AdminEntry,
   type AdminListQuery,
   type AdminRequest,
   type AdminRequestParams,
   type AdminResource,
} from '../../../models/admin.models';
import type { AdminApiService } from '../../../services/admin-api.service';
import type { AdminState } from './admin-state.feature';

interface LoadRequest extends AdminRequest {
   force: boolean;
}

function messageOf(err: unknown): string {
   if (err instanceof HttpErrorResponse) {
      return err.status === 0 ? 'The server could not be reached.' : `Request failed (${err.status}).`;
   }
   return 'Something went wrong.';
}

/** A cached entry is reused when it is fresh, or already loading. */
export function needsFetch(entry: AdminEntry | undefined, force: boolean, now = Date.now()): boolean {
   if (!entry) return true;
   if (entry.loading) return false;
   if (force || entry.error) return true;
   return entry.loadedAt === null || now - entry.loadedAt > ADMIN_CACHE_MS;
}

/** Filters and paging (each resets dependent paging), plus loading resources by request key. */
export function withAdminMethods() {
   return signalStoreFeature(
      { state: type<AdminState>(), props: type<{ _api: AdminApiService; params: () => AdminRequestParams }>() },
      withMethods((store) => {
         const setEntry = (key: string, patch: Partial<AdminEntry>): void => {
            const current = store.entries()[key] ?? { value: null, loading: false, error: null, loadedAt: null };
            patchState(store, { entries: { ...store.entries(), [key]: { ...current, ...patch } } });
         };

         const load = rxMethod<LoadRequest>(
            pipe(
               filter((request) => needsFetch(store.entries()[request.key], request.force)),
               tap((request) => setEntry(request.key, { loading: true, error: null })),
               mergeMap((request) =>
                  store._api.fetch(request).pipe(
                     tap((value) => {
                        setEntry(request.key, { value, loading: false, error: null, loadedAt: Date.now() });
                        patchState(store, { latest: { ...store.latest(), [request.resource]: request.key } });
                     }),
                     catchError((err: unknown) => {
                        setEntry(request.key, { loading: false, error: messageOf(err) });
                        return EMPTY;
                     })
                  )
               )
            )
         );

         const listQuery = <S extends string>(current: AdminListQuery<S>, patch: Partial<AdminListQuery<S>>) => {
            const next = { ...current, ...patch };
            // A new search or sort starts again on page 1.
            if (patch.q !== undefined || patch.sort !== undefined || patch.dir !== undefined)
               next.page = patch.page ?? 1;
            return next;
         };

         return {
            /**
             * Keep `resource` loaded for the current params while the caller lives (call from a
             * page's injection context; the watcher stops when the page is destroyed).
             */
            connect(resource: AdminResource): void {
               load(
                  computed(() => ({ ...requestFor(resource, store.params()), force: false }), {
                     equal: (a, b) => a.key === b.key,
                  })
               );
            },
            reload(resource: AdminResource): void {
               load({ ...requestFor(resource, store.params()), force: true });
            },
            setRange(range: AdminRange): void {
               patchState(store, { range });
            },
            setMetric(metric: AdminMetric): void {
               patchState(store, { metric });
            },
            setUserId(userId: string | null): void {
               patchState(store, { userId });
            },
            updateUsers(patch: Partial<AdminListQuery<AdminUserSort>>): void {
               patchState(store, { users: listQuery(store.users(), patch) });
            },
            updateProjects(patch: Partial<AdminListQuery<AdminProjectSort>>): void {
               patchState(store, { projects: listQuery(store.projects(), patch) });
            },
            /** Clicking the sorted column flips its direction; another column sorts descending. */
            sortUsers(sort: AdminUserSort): void {
               const current = store.users();
               const dir: AdminSortDir = current.sort === sort && current.dir === 'desc' ? 'asc' : 'desc';
               patchState(store, { users: listQuery(current, { sort, dir }) });
            },
            sortProjects(sort: AdminProjectSort): void {
               const current = store.projects();
               const dir: AdminSortDir = current.sort === sort && current.dir === 'desc' ? 'asc' : 'desc';
               patchState(store, { projects: listQuery(current, { sort, dir }) });
            },
            filterEvents(name: string): void {
               patchState(store, { events: { name, cursors: [] } });
            },
            olderEvents(cursor: number): void {
               patchState(store, { events: { ...store.events(), cursors: [...store.events().cursors, cursor] } });
            },
            newerEvents(): void {
               patchState(store, { events: { ...store.events(), cursors: store.events().cursors.slice(0, -1) } });
            },
         };
      })
   );
}
