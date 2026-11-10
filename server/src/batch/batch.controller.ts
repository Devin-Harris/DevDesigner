import { Body, Controller, Param, Patch, Post, Query } from '@nestjs/common';
import {
  BATCH_RETURN_NONE,
  type BatchUpdateAck,
  type BatchUpdateResponse,
} from '@devdesigner/shared';
import { BatchService } from './batch.service';
import { CloneService } from './clone.service';
import { batchResult } from './batch-ack';
import { CurrentUserId } from '../auth/current-user.decorator';
import { ClientId, ShareToken } from '../common/request.decorators';

/**
 * Atomic multi-item edits. The body is checked section by section in the service
 * against the granular DTO classes (like import-content, it is not one DTO class).
 *
 * Both routes answer with every changed row (the MCP reads them). Callers that have
 * already applied the change locally pass `?return=none` and get a small ack instead.
 */
@Controller()
export class BatchController {
  constructor(
    private readonly batch: BatchService,
    private readonly cloner: CloneService,
  ) {}

  @Patch('projects/:projectId/batch')
  async apply(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
    @Query('return') returnMode?: string,
  ): Promise<BatchUpdateResponse | BatchUpdateAck> {
    const result = await this.batch.apply(projectId, body, userId, shareToken, clientId);
    return batchResult(projectId, result, returnMode === BATCH_RETURN_NONE);
  }

  /** Copy rows (and their children) under client-chosen ids in one transaction. */
  @Post('projects/:projectId/clone')
  async clone(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
    @Query('return') returnMode?: string,
  ): Promise<BatchUpdateResponse | BatchUpdateAck> {
    const result = await this.cloner.clone(projectId, body, userId, shareToken, clientId);
    return batchResult(projectId, result, returnMode === BATCH_RETURN_NONE);
  }
}
