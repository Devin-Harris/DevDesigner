import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  CreateTableDto,
  TableModel,
  UpdatePositionDto,
  UpdateTableDto,
} from '@devdesigner/shared';
import { ApiService } from './api.service';

/** Granular table endpoints (BUILD_INSTRUCTIONS.md section 5). */
@Injectable({ providedIn: 'root' })
export class TablesService {
  private readonly api = inject(ApiService);

  create(projectId: string, dto: CreateTableDto): Observable<TableModel> {
    return this.api.post<TableModel>(`/projects/${projectId}/tables`, dto);
  }

  update(tableId: string, dto: UpdateTableDto): Observable<TableModel> {
    return this.api.patch<TableModel>(`/tables/${tableId}`, dto);
  }

  updatePosition(tableId: string, dto: UpdatePositionDto): Observable<void> {
    return this.api.patch<void>(`/tables/${tableId}/position`, dto);
  }

  remove(tableId: string): Observable<void> {
    return this.api.delete<void>(`/tables/${tableId}`);
  }
}
