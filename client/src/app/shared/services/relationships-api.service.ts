import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { CreateRelationshipDto, RelationshipModel, UpdateRelationshipDto } from '@devdesigner/shared';
import { ApiClientService } from '../../core/http/api-client.service';

/** Granular relationship endpoints (BUILD_INSTRUCTIONS.md section 5). */
@Injectable({ providedIn: 'root' })
export class RelationshipsApiService {
   private readonly api = inject(ApiClientService);

   create(projectId: string, dto: CreateRelationshipDto): Observable<RelationshipModel> {
      return this.api.post<RelationshipModel>(`/projects/${projectId}/relationships`, dto);
   }

   update(id: string, dto: UpdateRelationshipDto): Observable<RelationshipModel> {
      return this.api.patch<RelationshipModel>(`/relationships/${id}`, dto);
   }

   remove(id: string): Observable<void> {
      return this.api.delete<void>(`/relationships/${id}`);
   }
}
