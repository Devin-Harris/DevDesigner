import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  CanvasElementModel,
  CreateElementDto,
  ReorderElementsDto,
  UpdateElementDto,
  UpdateElementPositionDto,
} from '@devdesigner/shared';
import { ApiService } from './api.service';

/** Granular canvas-element endpoints (BUILD_INSTRUCTIONS.md section 5). */
@Injectable({ providedIn: 'root' })
export class ElementsService {
  private readonly api = inject(ApiService);

  create(projectId: string, dto: CreateElementDto): Observable<CanvasElementModel> {
    return this.api.post<CanvasElementModel>(`/projects/${projectId}/elements`, dto);
  }

  update(elementId: string, dto: UpdateElementDto): Observable<CanvasElementModel> {
    return this.api.patch<CanvasElementModel>(`/elements/${elementId}`, dto);
  }

  updatePosition(elementId: string, dto: UpdateElementPositionDto): Observable<void> {
    return this.api.patch<void>(`/elements/${elementId}/position`, dto);
  }

  reorder(projectId: string, dto: ReorderElementsDto): Observable<void> {
    return this.api.patch<void>(`/projects/${projectId}/elements/reorder`, dto);
  }

  remove(elementId: string): Observable<void> {
    return this.api.delete<void>(`/elements/${elementId}`);
  }
}
