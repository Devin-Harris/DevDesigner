import { signalStoreFeature, withState } from '@ngrx/signals';
import type { AdminMetric, AdminProjectSort, AdminRange, AdminUserSort } from '@devdesigner/shared';
import type { AdminEntry, AdminEventsQuery, AdminListQuery, AdminResource } from '../../../models/admin.models';

export interface AdminState {
   range: AdminRange;
   /** Metric of the usage-over-time chart. */
   metric: AdminMetric;
   users: AdminListQuery<AdminUserSort>;
   projects: AdminListQuery<AdminProjectSort>;
   userId: string | null;
   events: AdminEventsQuery;
   retentionWeeks: number;
   /** Responses by request key (resource + the params it depends on). */
   entries: Record<string, AdminEntry>;
   /** Last key each resource loaded successfully, shown while new params load. */
   latest: Partial<Record<AdminResource, string>>;
}

export const initialAdminState: AdminState = {
   range: '30d',
   metric: 'entity_writes',
   users: { q: '', sort: 'createdAt', dir: 'desc', page: 1 },
   projects: { q: '', sort: 'size', dir: 'desc', page: 1 },
   userId: null,
   events: { name: '', cursors: [] },
   retentionWeeks: 8,
   entries: {},
   latest: {},
};

export function withAdminState() {
   return signalStoreFeature(withState(initialAdminState));
}
