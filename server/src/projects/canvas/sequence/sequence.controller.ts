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
import { ProjectAccess, RequiresAccess, type ResolvedProjectAccess } from '../../../collaboration/access/access-policy';

/**
 * Sequence-diagram routes. Everything is nested under the projectId, so the guard
 * authorizes the project and the service scopes each child `where { id, projectId }`
 * (a child of another project is a 404).
 */
@Controller()
export class SequenceController {
  constructor(private readonly sequence: SequenceService) {}

  @Post('projects/:projectId/sequence-diagrams')
  @RequiresAccess('write')
  createDiagram(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Body() dto: CreateSequenceDiagramDto,
  ): Promise<SequenceDiagramModel> {
    return this.sequence.createDiagram(projectId, dto);
  }

  @Patch('projects/:projectId/sequence-diagrams/:diagramId')
  @RequiresAccess('write')
  updateDiagram(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Param('diagramId') diagramId: string,
    @Body() dto: UpdateSequenceDiagramDto,
  ): Promise<SequenceDiagramModel> {
    return this.sequence.updateDiagram(projectId, diagramId, dto);
  }

  @Delete('projects/:projectId/sequence-diagrams/:diagramId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresAccess('write')
  deleteDiagram(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Param('diagramId') diagramId: string,
  ): Promise<void> {
    return this.sequence.deleteDiagram(projectId, diagramId);
  }

  @Post('projects/:projectId/lifelines')
  @RequiresAccess('write')
  createLifeline(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Body() dto: CreateLifelineDto,
  ): Promise<LifelineModel> {
    return this.sequence.createLifeline(projectId, dto);
  }

  @Patch('projects/:projectId/lifelines/:lifelineId')
  @RequiresAccess('write')
  updateLifeline(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Param('lifelineId') lifelineId: string,
    @Body() dto: UpdateLifelineDto,
  ): Promise<LifelineModel> {
    return this.sequence.updateLifeline(projectId, lifelineId, dto);
  }

  @Patch('projects/:projectId/lifelines/:lifelineId/position')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresAccess('write')
  moveLifeline(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Param('lifelineId') lifelineId: string,
    @Body() dto: UpdateLifelinePositionDto,
  ): Promise<void> {
    return this.sequence.moveLifeline(projectId, lifelineId, dto);
  }

  @Delete('projects/:projectId/lifelines/:lifelineId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresAccess('write')
  deleteLifeline(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Param('lifelineId') lifelineId: string,
  ): Promise<void> {
    return this.sequence.deleteLifeline(projectId, lifelineId);
  }

  @Post('projects/:projectId/messages')
  @RequiresAccess('write')
  createMessage(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Body() dto: CreateSequenceMessageDto,
  ): Promise<SequenceMessageModel> {
    return this.sequence.createMessage(projectId, dto);
  }

  @Patch('projects/:projectId/messages/:messageId')
  @RequiresAccess('write')
  updateMessage(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Param('messageId') messageId: string,
    @Body() dto: UpdateSequenceMessageDto,
  ): Promise<SequenceMessageModel> {
    return this.sequence.updateMessage(projectId, messageId, dto);
  }

  @Patch('projects/:projectId/messages/:messageId/position')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresAccess('write')
  moveMessage(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Param('messageId') messageId: string,
    @Body() dto: UpdateSequenceMessagePositionDto,
  ): Promise<void> {
    return this.sequence.moveMessage(projectId, messageId, dto);
  }

  @Delete('projects/:projectId/messages/:messageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresAccess('write')
  deleteMessage(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Param('messageId') messageId: string,
  ): Promise<void> {
    return this.sequence.deleteMessage(projectId, messageId);
  }
}
