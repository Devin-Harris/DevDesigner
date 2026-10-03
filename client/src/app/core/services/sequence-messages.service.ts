import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  CreateSequenceMessageDto,
  SequenceMessageModel,
  UpdateSequenceMessageDto,
  UpdateSequenceMessagePositionDto,
} from '@dbdesigner/shared';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class SequenceMessagesService {
  private readonly api = inject(ApiService);

  create(projectId: string, dto: CreateSequenceMessageDto): Observable<SequenceMessageModel> {
    return this.api.post<SequenceMessageModel>(`/projects/${projectId}/sequence-messages`, dto);
  }

  update(messageId: string, dto: UpdateSequenceMessageDto): Observable<SequenceMessageModel> {
    return this.api.patch<SequenceMessageModel>(`/sequence-messages/${messageId}`, dto);
  }

  updatePosition(messageId: string, dto: UpdateSequenceMessagePositionDto): Observable<void> {
    return this.api.patch<void>(`/sequence-messages/${messageId}/position`, dto);
  }

  remove(messageId: string): Observable<void> {
    return this.api.delete<void>(`/sequence-messages/${messageId}`);
  }
}
