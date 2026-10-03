import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  CreateLifelineDto,
  LifelineModel,
  ReorderLifelinesDto,
  UpdateLifelineDto,
  UpdateLifelinePositionDto,
} from '@dbdesigner/shared';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class LifelinesService {
  private readonly api = inject(ApiService);

  create(projectId: string, dto: CreateLifelineDto): Observable<LifelineModel> {
    return this.api.post<LifelineModel>(`/projects/${projectId}/lifelines`, dto);
  }

  update(lifelineId: string, dto: UpdateLifelineDto): Observable<LifelineModel> {
    return this.api.patch<LifelineModel>(`/lifelines/${lifelineId}`, dto);
  }

  updatePosition(lifelineId: string, dto: UpdateLifelinePositionDto): Observable<void> {
    return this.api.patch<void>(`/lifelines/${lifelineId}/position`, dto);
  }

  reorder(projectId: string, dto: ReorderLifelinesDto): Observable<void> {
    return this.api.patch<void>(`/projects/${projectId}/lifelines/reorder`, dto);
  }

  remove(lifelineId: string): Observable<void> {
    return this.api.delete<void>(`/lifelines/${lifelineId}`);
  }
}
