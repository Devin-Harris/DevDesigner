import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { ColumnModel, CreateColumnDto, ReorderColumnsDto, UpdateColumnDto } from '@devdesigner/shared';
import { ApiClientService } from '../../core/http/api-client.service';

/** Granular column endpoints (BUILD_INSTRUCTIONS.md section 5). */
@Injectable({ providedIn: 'root' })
export class ColumnsApiService {
   private readonly api = inject(ApiClientService);

   create(tableId: string, dto: CreateColumnDto): Observable<ColumnModel> {
      return this.api.post<ColumnModel>(`/tables/${tableId}/columns`, dto);
   }

   update(columnId: string, dto: UpdateColumnDto): Observable<ColumnModel> {
      return this.api.patch<ColumnModel>(`/columns/${columnId}`, dto);
   }

   reorder(tableId: string, dto: ReorderColumnsDto): Observable<void> {
      return this.api.patch<void>(`/tables/${tableId}/columns/reorder`, dto);
   }

   remove(columnId: string): Observable<void> {
      return this.api.delete<void>(`/columns/${columnId}`);
   }
}
