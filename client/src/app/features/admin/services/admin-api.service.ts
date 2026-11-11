import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { AdminPingResponse } from '@devdesigner/shared';
import { ApiClientService } from '../../../core/http/api-client.service';
import { rangeDays } from '../helpers/admin-request.helpers';
import {
   ADMIN_EVENTS_PAGE,
   ADMIN_PAGE_SIZE,
   type AdminListQuery,
   type AdminRequest,
   type AdminResource,
   type AdminResponses,
} from '../models/admin.models';

/** HttpClient wrappers for `/api/admin/*`. Lives in the lazy admin chunk only. */
@Injectable({ providedIn: 'root' })
export class AdminApiService {
   private readonly api = inject(ApiClientService);

   ping(): Observable<AdminPingResponse> {
      return this.api.get<AdminPingResponse>('/admin/ping');
   }

   /** The GET for one resolved store request. */
   fetch<R extends AdminResource>(request: AdminRequest<R>): Observable<AdminResponses[R]> {
      return this.api.get<AdminResponses[R]>(`/admin/${this.pathOf(request)}`);
   }

   private pathOf(request: AdminRequest): string {
      const p = request.params;
      switch (request.resource) {
         case 'overview':
         case 'features':
         case 'errors':
            return `${request.resource}?range=${p.range}`;
         case 'apiTokens':
            return `api-tokens?range=${p.range}`;
         case 'timeseries': {
            const { from, to } = rangeDays(p.range);
            return `timeseries?metric=${p.metric}&from=${from}&to=${to}`;
         }
         case 'retention':
            return `retention?weeks=${p.retentionWeeks}`;
         case 'users':
            return `users?${this.listQuery(p.users)}`;
         case 'projects':
            return `projects?${this.listQuery(p.projects)}`;
         case 'userDetail':
            return `users/${encodeURIComponent(p.userId ?? '')}`;
         case 'events': {
            const params = new URLSearchParams({ limit: String(ADMIN_EVENTS_PAGE) });
            if (p.events.name) params.set('name', p.events.name);
            const cursor = p.events.cursors.at(-1);
            if (cursor) params.set('cursor', String(cursor));
            return `events?${params}`;
         }
         case 'storage':
         case 'realtime':
            return request.resource;
      }
   }

   private listQuery(q: AdminListQuery<string>): string {
      const params = new URLSearchParams({
         sort: q.sort,
         dir: q.dir,
         page: String(q.page),
         pageSize: String(ADMIN_PAGE_SIZE),
      });
      if (q.q.trim()) params.set('q', q.q.trim());
      return params.toString();
   }
}
