import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  CreateLifelineDto,
  CreateSequenceDiagramDto,
  CreateSequenceMessageDto,
  LifelineModel,
  SequenceDiagramModel,
  SequenceMessageModel,
  UpdateLifelineDto,
  UpdateLifelinePositionDto,
  UpdateSequenceDiagramDto,
  UpdateSequenceMessageDto,
  UpdateSequenceMessagePositionDto,
} from '@dbdesigner/shared';
import { ApiService } from './api.service';

/** Granular sequence-diagram endpoints (diagrams, lifelines, messages). */
@Injectable({ providedIn: 'root' })
export class SequenceService {
  private readonly api = inject(ApiService);

  // Diagrams (groups)
  createDiagram(
    projectId: string,
    dto: CreateSequenceDiagramDto,
  ): Observable<SequenceDiagramModel> {
    return this.api.post<SequenceDiagramModel>(`/projects/${projectId}/sequence-diagrams`, dto);
  }
  updateDiagram(
    projectId: string,
    diagramId: string,
    dto: UpdateSequenceDiagramDto,
  ): Observable<SequenceDiagramModel> {
    return this.api.patch<SequenceDiagramModel>(
      `/projects/${projectId}/sequence-diagrams/${diagramId}`,
      dto,
    );
  }
  deleteDiagram(projectId: string, diagramId: string): Observable<void> {
    return this.api.delete<void>(`/projects/${projectId}/sequence-diagrams/${diagramId}`);
  }

  // Lifelines
  createLifeline(projectId: string, dto: CreateLifelineDto): Observable<LifelineModel> {
    return this.api.post<LifelineModel>(`/projects/${projectId}/lifelines`, dto);
  }
  updateLifeline(
    projectId: string,
    lifelineId: string,
    dto: UpdateLifelineDto,
  ): Observable<LifelineModel> {
    return this.api.patch<LifelineModel>(`/projects/${projectId}/lifelines/${lifelineId}`, dto);
  }
  moveLifeline(
    projectId: string,
    lifelineId: string,
    dto: UpdateLifelinePositionDto,
  ): Observable<void> {
    return this.api.patch<void>(
      `/projects/${projectId}/lifelines/${lifelineId}/position`,
      dto,
    );
  }
  deleteLifeline(projectId: string, lifelineId: string): Observable<void> {
    return this.api.delete<void>(`/projects/${projectId}/lifelines/${lifelineId}`);
  }

  // Messages
  createMessage(
    projectId: string,
    dto: CreateSequenceMessageDto,
  ): Observable<SequenceMessageModel> {
    return this.api.post<SequenceMessageModel>(`/projects/${projectId}/messages`, dto);
  }
  updateMessage(
    projectId: string,
    messageId: string,
    dto: UpdateSequenceMessageDto,
  ): Observable<SequenceMessageModel> {
    return this.api.patch<SequenceMessageModel>(
      `/projects/${projectId}/messages/${messageId}`,
      dto,
    );
  }
  moveMessage(
    projectId: string,
    messageId: string,
    dto: UpdateSequenceMessagePositionDto,
  ): Observable<void> {
    return this.api.patch<void>(`/projects/${projectId}/messages/${messageId}/position`, dto);
  }
  deleteMessage(projectId: string, messageId: string): Observable<void> {
    return this.api.delete<void>(`/projects/${projectId}/messages/${messageId}`);
  }
}
