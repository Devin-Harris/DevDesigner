import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { CreateShareLinkDto, ProjectGraphResponse, ShareLinkResponse } from '@devdesigner/shared';
import { ApiClientService } from '../http/api-client.service';

/**
 * Data service for the Sharing REST surface (BUILD_INSTRUCTIONS.md section 5).
 * Owner link management plus the account-free shared entry load. Shapes come from
 * the shared package so client and server stay in lockstep.
 */
@Injectable({ providedIn: 'root' })
export class ShareLinksApiService {
   private readonly api = inject(ApiClientService);

   /** POST /projects/:id/share : owner creates a VIEW/EDIT link. */
   create(projectId: string, dto: CreateShareLinkDto): Observable<ShareLinkResponse> {
      return this.api.post<ShareLinkResponse>(`/projects/${projectId}/share`, dto);
   }

   /** GET /projects/:id/share : owner lists active links. */
   list(projectId: string): Observable<ShareLinkResponse[]> {
      return this.api.get<ShareLinkResponse[]>(`/projects/${projectId}/share`);
   }

   /** DELETE /projects/:id/share/:linkId : owner revokes a link. */
   revoke(projectId: string, linkId: string): Observable<void> {
      return this.api.delete<void>(`/projects/${projectId}/share/${linkId}`);
   }

   /** GET /shared/:token : resolve a link into the project graph (no account). */
   getShared(token: string): Observable<ProjectGraphResponse> {
      return this.api.get<ProjectGraphResponse>(`/shared/${token}`);
   }
}
