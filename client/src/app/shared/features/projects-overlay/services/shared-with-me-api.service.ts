import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { SharedProjectEntry } from '@devdesigner/shared';
import { ApiClientService } from '../../../../core/http/api-client.service';

/**
 * "Shared with me": projects the signed-in user opened through someone else's
 * share link. The server drops links that were revoked or expired, so the list
 * fetched on each dialog open is always current.
 */
@Injectable({ providedIn: 'root' })
export class SharedWithMeApiService {
   private readonly api = inject(ApiClientService);

   list(): Observable<SharedProjectEntry[]> {
      return this.api.get<SharedProjectEntry[]>('/shared-with-me');
   }

   /** Remove a project from the list (the share link itself keeps working). */
   forget(projectId: string): Observable<void> {
      return this.api.delete<void>(`/shared-with-me/${projectId}`);
   }
}
