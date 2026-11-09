import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type {
  LifelineModel,
  SequenceDiagramModel,
  SequenceMessageModel,
} from '@devdesigner/shared';
import { SequenceService } from './sequence.service';
import { CreateSequenceDiagramDto } from './dto/create-sequence-diagram.dto';
import { UpdateSequenceDiagramDto } from './dto/update-sequence-diagram.dto';
import { CreateLifelineDto } from './dto/create-lifeline.dto';
import { UpdateLifelineDto } from './dto/update-lifeline.dto';
import { UpdateLifelinePositionDto } from './dto/update-lifeline-position.dto';
import { CreateSequenceMessageDto } from './dto/create-sequence-message.dto';
import { UpdateSequenceMessageDto } from './dto/update-sequence-message.dto';
import { UpdateSequenceMessagePositionDto } from './dto/update-sequence-message-position.dto';
import { CurrentUserId } from '../auth/current-user.decorator';
import { ClientId, ShareToken } from '../common/request.decorators';

/**
 * Sequence-diagram routes. Everything is nested under the projectId so a single
 * assertCanWrite(projectId) authorizes each write (no per-entity ancestry walk).
 */
@Controller()
export class SequenceController {
  constructor(private readonly sequence: SequenceService) {}

  @Post('projects/:projectId/sequence-diagrams')
  createDiagram(
    @Param('projectId') projectId: string,
    @Body() dto: CreateSequenceDiagramDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<SequenceDiagramModel> {
    return this.sequence.createDiagram(projectId, dto, userId, shareToken, clientId);
  }

  @Patch('projects/:projectId/sequence-diagrams/:diagramId')
  updateDiagram(
    @Param('projectId') projectId: string,
    @Param('diagramId') diagramId: string,
    @Body() dto: UpdateSequenceDiagramDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<SequenceDiagramModel> {
    return this.sequence.updateDiagram(projectId, diagramId, dto, userId, shareToken, clientId);
  }

  @Delete('projects/:projectId/sequence-diagrams/:diagramId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDiagram(
    @Param('projectId') projectId: string,
    @Param('diagramId') diagramId: string,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<void> {
    return this.sequence.deleteDiagram(projectId, diagramId, userId, shareToken, clientId);
  }

  @Post('projects/:projectId/lifelines')
  createLifeline(
    @Param('projectId') projectId: string,
    @Body() dto: CreateLifelineDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<LifelineModel> {
    return this.sequence.createLifeline(projectId, dto, userId, shareToken, clientId);
  }

  @Patch('projects/:projectId/lifelines/:lifelineId')
  updateLifeline(
    @Param('projectId') projectId: string,
    @Param('lifelineId') lifelineId: string,
    @Body() dto: UpdateLifelineDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<LifelineModel> {
    return this.sequence.updateLifeline(projectId, lifelineId, dto, userId, shareToken, clientId);
  }

  @Patch('projects/:projectId/lifelines/:lifelineId/position')
  @HttpCode(HttpStatus.NO_CONTENT)
  moveLifeline(
    @Param('projectId') projectId: string,
    @Param('lifelineId') lifelineId: string,
    @Body() dto: UpdateLifelinePositionDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<void> {
    return this.sequence.moveLifeline(projectId, lifelineId, dto, userId, shareToken, clientId);
  }

  @Delete('projects/:projectId/lifelines/:lifelineId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteLifeline(
    @Param('projectId') projectId: string,
    @Param('lifelineId') lifelineId: string,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<void> {
    return this.sequence.deleteLifeline(projectId, lifelineId, userId, shareToken, clientId);
  }

  @Post('projects/:projectId/messages')
  createMessage(
    @Param('projectId') projectId: string,
    @Body() dto: CreateSequenceMessageDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<SequenceMessageModel> {
    return this.sequence.createMessage(projectId, dto, userId, shareToken, clientId);
  }

  @Patch('projects/:projectId/messages/:messageId')
  updateMessage(
    @Param('projectId') projectId: string,
    @Param('messageId') messageId: string,
    @Body() dto: UpdateSequenceMessageDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<SequenceMessageModel> {
    return this.sequence.updateMessage(projectId, messageId, dto, userId, shareToken, clientId);
  }

  @Patch('projects/:projectId/messages/:messageId/position')
  @HttpCode(HttpStatus.NO_CONTENT)
  moveMessage(
    @Param('projectId') projectId: string,
    @Param('messageId') messageId: string,
    @Body() dto: UpdateSequenceMessagePositionDto,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<void> {
    return this.sequence.moveMessage(projectId, messageId, dto, userId, shareToken, clientId);
  }

  @Delete('projects/:projectId/messages/:messageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteMessage(
    @Param('projectId') projectId: string,
    @Param('messageId') messageId: string,
    @CurrentUserId() userId: string | null,
    @ShareToken() shareToken: string | null,
    @ClientId() clientId: string | null,
  ): Promise<void> {
    return this.sequence.deleteMessage(projectId, messageId, userId, shareToken, clientId);
  }
}
