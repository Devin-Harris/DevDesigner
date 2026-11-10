import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { CreateIndexDto, IndexModel, ReorderIndexesDto, UpdateIndexDto } from '@devdesigner/shared';
import { ApiClientService } from './api-client.service';

/** Granular table-index endpoints (mirrors ColumnsApiService). */
@Injectable({ providedIn: 'root' })
export class IndexesApiService {
   private readonly api = inject(ApiClientService);

   create(tableId: string, dto: CreateIndexDto): Observable<IndexModel> {
      return this.api.post<IndexModel>(`/tables/${tableId}/indexes`, dto);
   }

   update(indexId: string, dto: UpdateIndexDto): Observable<IndexModel> {
      return this.api.patch<IndexModel>(`/indexes/${indexId}`, dto);
   }

   reorder(tableId: string, dto: ReorderIndexesDto): Observable<void> {
      return this.api.patch<void>(`/tables/${tableId}/indexes/reorder`, dto);
   }

   remove(indexId: string): Observable<void> {
      return this.api.delete<void>(`/indexes/${indexId}`);
   }
}
