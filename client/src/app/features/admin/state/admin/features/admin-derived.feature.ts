import { computed, type Signal } from '@angular/core';
import { signalStoreFeature, type, withComputed } from '@ngrx/signals';
import { requestKey } from '../../../helpers/admin-request.helpers';
import type {
   AdminEntry,
   AdminRequestParams,
   AdminResource,
   AdminResponses,
   AdminView,
} from '../../../models/admin.models';
import type { AdminState } from './admin-state.feature';

const RESOURCES: readonly AdminResource[] = [
   'overview',
   'features',
   'timeseries',
   'retention',
   'users',
   'userDetail',
   'projects',
   'storage',
   'apiTokens',
   'errors',
   'realtime',
   'events',
];

/**
 * A resource's view: its entry under the current params, else (while that loads) the
 * last successful response, flagged stale, so charts keep their frame during a refetch.
 */
export function viewOf<T>(
   entries: Record<string, AdminEntry>,
   key: string,
   latestKey: string | undefined
): AdminView<T> {
   const entry = entries[key];
   if (entry && entry.value !== null) {
      return { value: entry.value as T, loading: entry.loading, error: entry.error, stale: false };
   }
   const previous = latestKey ? entries[latestKey] : undefined;
   return {
      value: (previous?.value as T | undefined) ?? null,
      loading: entry ? entry.loading : true,
      error: entry?.error ?? null,
      stale: previous?.value != null,
   };
}

export type AdminViews = { [R in AdminResource as `${R}View`]: Signal<AdminView<AdminResponses[R]>> };

/** Request params, one view per resource, and paging flags. */
export function withAdminDerived() {
   return signalStoreFeature(
      { state: type<AdminState>() },
      withComputed((store) => {
         const params = computed<AdminRequestParams>(() => ({
            range: store.range(),
            metric: store.metric(),
            users: store.users(),
            projects: store.projects(),
            userId: store.userId(),
            events: store.events(),
            retentionWeeks: store.retentionWeeks(),
         }));
         const views = Object.fromEntries(
            RESOURCES.map((resource) => [
               `${resource}View`,
               computed(() => viewOf(store.entries(), requestKey(resource, params()), store.latest()[resource])),
            ])
         ) as AdminViews;
         return {
            params,
            ...views,
            /** Events: there is a newer page to go back to. */
            hasNewerEvents: computed(() => store.events().cursors.length > 0),
         };
      })
   );
}
