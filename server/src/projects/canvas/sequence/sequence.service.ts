import { clientId } from '../../common/client-id';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  LifelineModel,
  SequenceDiagramModel,
  SequenceMessageModel,
} from '@devdesigner/shared';
import { Project } from '../../projects/project.entity';
import { AccessService } from '../../../collaboration/access/access.service';
import { applyDefined } from '../../common/apply-patch';
import { RealtimePublisher } from '../../../platform/realtime/realtime.publisher';
import { LifelineEntity } from './lifeline.entity';
import { SequenceMessageEntity } from './sequence-message.entity';
import { SequenceDiagramEntity } from './sequence-diagram.entity';
import {
  toLifelineModel,
  toSequenceDiagramModel,
  toSequenceMessageModel,
} from './sequence.mapper';
import { CreateSequenceDiagramDto } from './dto/create-sequence-diagram.dto';
import { UpdateSequenceDiagramDto } from './dto/update-sequence-diagram.dto';
import { CreateLifelineDto } from './dto/create-lifeline.dto';
import { UpdateLifelineDto } from './dto/update-lifeline.dto';
import { UpdateLifelinePositionDto } from './dto/update-lifeline-position.dto';
import { CreateSequenceMessageDto } from './dto/create-sequence-message.dto';
import { UpdateSequenceMessageDto } from './dto/update-sequence-message.dto';
import { UpdateSequenceMessagePositionDto } from './dto/update-sequence-message-position.dto';

/**
 * Sequence-diagram persistence. A project may hold several diagrams, each a
 * group of lifelines (participant columns) + messages (rows) with its own origin
 * and spacing. Mirrors the tables slice — every write authorizes through the
 * policy layer, then broadcasts the persisted change to the project room. All
 * routes carry the projectId so authorization is a single assertCanWrite.
 */
@Injectable()
export class SequenceService {
  constructor(
    @InjectRepository(SequenceDiagramEntity)
    private readonly diagrams: Repository<SequenceDiagramEntity>,
    @InjectRepository(LifelineEntity)
    private readonly lifelines: Repository<LifelineEntity>,
    @InjectRepository(SequenceMessageEntity)
    private readonly messages: Repository<SequenceMessageEntity>,
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    private readonly access: AccessService,
    private readonly realtime: RealtimePublisher,
  ) {}

  // ---- Diagrams ----

  async createDiagram(
    projectId: string,
    dto: CreateSequenceDiagramDto,
  ): Promise<SequenceDiagramModel> {
    await this.access.assertIdsInProject('element', [dto.slideId], projectId);
    if (!(await this.projects.findOne({ where: { id: projectId } }))) {
      throw new NotFoundException(`Project ${projectId} not found.`);
    }
    const entity = this.diagrams.create({
      ...(await clientId(this.diagrams, dto.id, 'Sequence diagram')),
      projectId,
      originY: dto.originY,
      lifelineSpacing: dto.lifelineSpacing ?? 160,
      rowSpacing: dto.rowSpacing ?? 48,
      headerHeight: dto.headerHeight ?? 42,
      scale: dto.scale ?? null,
      backgroundColor: dto.backgroundColor ?? null,
      borderColor: dto.borderColor ?? null,
      title: dto.title?.trim() || null,
      morphId: dto.morphId?.trim() || null,
      slideId: dto.slideId ?? null,
      zIndex: dto.zIndex ?? -1,
    });
    const saved = await this.diagrams.save(entity);
    const model = toSequenceDiagramModel(saved);
    this.realtime.emit(projectId, { kind: 'sequenceDiagram.created', diagram: model });
    return model;
  }

  async updateDiagram(
    projectId: string,
    diagramId: string,
    dto: UpdateSequenceDiagramDto,
  ): Promise<SequenceDiagramModel> {
    await this.access.assertIdsInProject('element', [dto.slideId], projectId);
    const entity = await this.diagramOrThrow(projectId, diagramId);
    applyDiagramPatch(entity, dto);
    const saved = await this.diagrams.save(entity);
    const model = toSequenceDiagramModel(saved);
    this.realtime.emit(projectId, { kind: 'sequenceDiagram.updated', diagram: model });
    return model;
  }

  async deleteDiagram(
    projectId: string,
    diagramId: string,
  ): Promise<void> {
    await this.messages.delete({ projectId, diagramId });
    await this.lifelines.delete({ projectId, diagramId });
    const result = await this.diagrams.delete({ id: diagramId, projectId });
    if (!result.affected) {
      throw new NotFoundException(`Sequence diagram ${diagramId} not found.`);
    }
    this.realtime.emit(projectId, { kind: 'sequenceDiagram.deleted', diagramId });
  }

  // ---- Lifelines ----

  async createLifeline(
    projectId: string,
    dto: CreateLifelineDto,
  ): Promise<LifelineModel> {
    await this.diagramOrThrow(projectId, dto.diagramId);
    const entity = this.lifelines.create({
      ...(await clientId(this.lifelines, dto.id, 'Lifeline')),
      projectId,
      diagramId: dto.diagramId,
      label: dto.label,
      color: dto.color ?? null,
      lineColor: dto.lineColor ?? null,
      strokeColor: dto.strokeColor ?? null,
      textColor: dto.textColor ?? null,
      morphId: dto.morphId?.trim() || null,
      x: dto.x,
      width: dto.width ?? 120,
      orderIndex: dto.order ?? 0,
    });
    const saved = await this.lifelines.save(entity);
    const model = toLifelineModel(saved);
    this.realtime.emit(projectId, { kind: 'lifeline.created', lifeline: model });
    return model;
  }

  async updateLifeline(
    projectId: string,
    lifelineId: string,
    dto: UpdateLifelineDto,
  ): Promise<LifelineModel> {
    const entity = await this.lifelineOrThrow(projectId, lifelineId);
    applyLifelinePatch(entity, dto);
    const saved = await this.lifelines.save(entity);
    const model = toLifelineModel(saved);
    this.realtime.emit(projectId, { kind: 'lifeline.updated', lifeline: model });
    return model;
  }

  async moveLifeline(
    projectId: string,
    lifelineId: string,
    dto: UpdateLifelinePositionDto,
  ): Promise<void> {
    const result = await this.lifelines.update({ id: lifelineId, projectId }, { x: dto.x });
    if (!result.affected) {
      throw new NotFoundException(`Lifeline ${lifelineId} not found.`);
    }
    this.realtime.emit(projectId, { kind: 'lifeline.moved', lifelineId, x: dto.x });
  }

  async deleteLifeline(
    projectId: string,
    lifelineId: string,
  ): Promise<void> {
    // Remove messages touching this lifeline, then the lifeline itself.
    await this.messages.delete({ projectId, fromLifelineId: lifelineId });
    await this.messages.delete({ projectId, toLifelineId: lifelineId });
    const result = await this.lifelines.delete({ id: lifelineId, projectId });
    if (!result.affected) {
      throw new NotFoundException(`Lifeline ${lifelineId} not found.`);
    }
    this.realtime.emit(projectId, { kind: 'lifeline.deleted', lifelineId });
  }

  // ---- Messages ----

  async createMessage(
    projectId: string,
    dto: CreateSequenceMessageDto,
  ): Promise<SequenceMessageModel> {
    await this.diagramOrThrow(projectId, dto.diagramId);
    if (dto.style !== 'break' && dto.fromLifelineId === dto.toLifelineId) {
      throw new BadRequestException('A message must go between two different participants.');
    }
    await this.access.assertIdsInProject('lifeline', [dto.fromLifelineId, dto.toLifelineId], projectId);
    const entity = this.messages.create({
      ...(await clientId(this.messages, dto.id, 'Message')),
      projectId,
      diagramId: dto.diagramId,
      fromLifelineId: dto.fromLifelineId,
      toLifelineId: dto.toLifelineId,
      label: dto.label ?? null,
      y: dto.y,
      style: dto.style ?? 'solid',
      direction: dto.direction ?? 'forward',
      arrowhead: dto.arrowhead ?? 'arrow',
      color: dto.color ?? null,
      wrap: dto.wrap ?? null,
      morphId: dto.morphId?.trim() || null,
    });
    const saved = await this.messages.save(entity);
    const model = toSequenceMessageModel(saved);
    this.realtime.emit(projectId, { kind: 'message.created', message: model });
    return model;
  }

  async updateMessage(
    projectId: string,
    messageId: string,
    dto: UpdateSequenceMessageDto,
  ): Promise<SequenceMessageModel> {
    await this.access.assertIdsInProject('lifeline', [dto.fromLifelineId, dto.toLifelineId], projectId);
    const entity = await this.messageOrThrow(projectId, messageId);
    applyMessagePatch(entity, dto);
    const saved = await this.messages.save(entity);
    const model = toSequenceMessageModel(saved);
    this.realtime.emit(projectId, { kind: 'message.updated', message: model });
    return model;
  }

  async moveMessage(
    projectId: string,
    messageId: string,
    dto: UpdateSequenceMessagePositionDto,
  ): Promise<void> {
    const result = await this.messages.update({ id: messageId, projectId }, { y: dto.y });
    if (!result.affected) {
      throw new NotFoundException(`Message ${messageId} not found.`);
    }
    this.realtime.emit(projectId, { kind: 'message.moved', messageId, y: dto.y });
  }

  async deleteMessage(
    projectId: string,
    messageId: string,
  ): Promise<void> {
    const result = await this.messages.delete({ id: messageId, projectId });
    if (!result.affected) {
      throw new NotFoundException(`Message ${messageId} not found.`);
    }
    this.realtime.emit(projectId, { kind: 'message.deleted', messageId });
  }

  private async diagramOrThrow(projectId: string, id: string): Promise<SequenceDiagramEntity> {
    const entity = await this.diagrams.findOne({ where: { id, projectId } });
    if (!entity) {
      throw new NotFoundException(`Sequence diagram ${id} not found.`);
    }
    return entity;
  }

  private async lifelineOrThrow(projectId: string, id: string): Promise<LifelineEntity> {
    const entity = await this.lifelines.findOne({ where: { id, projectId } });
    if (!entity) {
      throw new NotFoundException(`Lifeline ${id} not found.`);
    }
    return entity;
  }

  private async messageOrThrow(projectId: string, id: string): Promise<SequenceMessageEntity> {
    const entity = await this.messages.findOne({ where: { id, projectId } });
    if (!entity) {
      throw new NotFoundException(`Message ${id} not found.`);
    }
    return entity;
  }
}

/** Patch helpers shared with the batch endpoint. */
export function applyDiagramPatch(entity: SequenceDiagramEntity, dto: UpdateSequenceDiagramDto): void {
  applyDefined(entity, dto, [
    'lifelineSpacing',
    'rowSpacing',
    'headerHeight',
    'scale',
    'originY',
    'zIndex',
    'groupId',
    'slideId',
    'backgroundColor',
    'borderColor',
  ]);
  for (const key of ['padLeft', 'padTop', 'boxWidth', 'boxHeight'] as const) {
    if (dto[key] !== undefined) entity[key] = dto[key] || null;
  }
  if (dto.title !== undefined) entity.title = dto.title.trim() || null;
  if (dto.morphId !== undefined) entity.morphId = dto.morphId.trim() || null;
}

export function applyLifelinePatch(entity: LifelineEntity, dto: UpdateLifelineDto): void {
  applyDefined(entity, dto, ['label', 'color', 'lineColor', 'strokeColor', 'textColor', 'width']);
  if (dto.morphId !== undefined) entity.morphId = dto.morphId.trim() || null;
}

export function applyMessagePatch(entity: SequenceMessageEntity, dto: UpdateSequenceMessageDto): void {
  applyDefined(entity, dto, [
    'fromLifelineId',
    'toLifelineId',
    'label',
    'style',
    'direction',
    'arrowhead',
    'color',
    'wrap',
  ]);
  if (dto.morphId !== undefined) entity.morphId = dto.morphId.trim() || null;
  if (entity.style !== 'break' && entity.fromLifelineId === entity.toLifelineId) {
    throw new BadRequestException('A message must go between two different participants.');
  }
}
