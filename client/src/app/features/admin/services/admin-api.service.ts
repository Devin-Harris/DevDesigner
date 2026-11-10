import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { AdminPingResponse } from '@devdesigner/shared';
import { ApiClientService } from '../../../core/services/api-client.service';

/** HttpClient wrappers for `/api/admin/*`. Lives in the lazy admin chunk only. */
@Injectable({ providedIn: 'root' })
export class AdminApiService {
   private readonly api = inject(ApiClientService);

   ping(): Observable<AdminPingResponse> {
      return this.api.get<AdminPingResponse>('/admin/ping');
   }
}
