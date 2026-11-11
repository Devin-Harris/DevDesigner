import { ADMIN_RANGE_DAYS, type AdminRange } from '@devdesigner/shared';
import type { AdminRequest, AdminRequestParams, AdminResource } from '../models/admin.models';

const DAY_MS = 86_400_000;

/** `from`/`to` (UTC days) of a preset range ending today. */
export function rangeDays(range: AdminRange, now = Date.now()): { from: string; to: string } {
   const to = new Date(now).toISOString().slice(0, 10);
   const from = new Date(Date.parse(`${to}T00:00:00Z`) - (ADMIN_RANGE_DAYS[range] - 1) * DAY_MS)
      .toISOString()
      .slice(0, 10);
   return { from, to };
}

/** The cache key of a resource under the current params: only the params it depends on. */
export function requestKey(resource: AdminResource, p: AdminRequestParams): string {
   switch (resource) {
      case 'overview':
      case 'features':
      case 'apiTokens':
      case 'errors':
         return `${resource}?range=${p.range}`;
      case 'timeseries':
         return `timeseries?metric=${p.metric}&range=${p.range}`;
      case 'retention':
         return `retention?weeks=${p.retentionWeeks}`;
      case 'users':
         return `users?${listParams(p.users)}`;
      case 'projects':
         return `projects?${listParams(p.projects)}`;
      case 'userDetail':
         return `users/${p.userId ?? ''}`;
      case 'events':
         return `events?name=${p.events.name}&cursor=${p.events.cursors.at(-1) ?? ''}`;
      case 'storage':
      case 'realtime':
         return resource;
   }
}

export function requestFor<R extends AdminResource>(resource: R, params: AdminRequestParams): AdminRequest<R> {
   return { resource, key: requestKey(resource, params), params };
}

function listParams(q: { q: string; sort: string; dir: string; page: number }): string {
   return `q=${encodeURIComponent(q.q)}&sort=${q.sort}&dir=${q.dir}&page=${q.page}`;
}
