import { Body, Controller, Param, Patch } from '@nestjs/common';
import type { BatchUpdateResponse } from '@dbdesigner/shared';
import { BatchService } from './batch.service';
import { CurrentUserId } from '../auth/current-user.decorator';
import { ClientId, ShareToken } from '../common/request.decorators';

/**
 * Atomic multi-item edits. The body is checked section by section in the service
 * against the granular DTO classes (like import-content, it is not one DTO class).
 */
@Controller()
export class BatchController {
  constructor(private readonly batch: BatchService) {}

  @Patch('projects/:projectId/batch')
  apply(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<BatchUpdateResponse> {
    return this.batch.apply(projectId, body, userId, shareToken, clientId);
  }
}
