import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { SequenceMessageModel } from '@dbdesigner/shared';
import { Project } from '../projects/project.entity';
import { AccessService } from '../access/access.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { SequenceMessageEntity } from './sequence-message.entity';
import { toSequenceMessageModel } from './sequence-message.mapper';
import { CreateSequenceMessageDto } from './dto/create-sequence-message.dto';
import { UpdateSequenceMessageDto } from './dto/update-sequence-message.dto';
import { UpdateSequenceMessagePositionDto } from './dto/update-sequence-message-position.dto';

@Injectable()
export class SequenceMessagesService {
  constructor(
    @InjectRepository(SequenceMessageEntity)
    private readonly messages: Repository<SequenceMessageEntity>,
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    private readonly access: AccessService,
    private readonly realtime: RealtimePublisher,
  ) {}

  async getModelsForProject(projectId: string): Promise<SequenceMessageModel[]> {
    const rows = await this.messages.find({
      where: { projectId },
      order: { y: 'ASC' },
    });
    return rows.map(toSequenceMessageModel);
  }

  async create(
    projectId: string,
    dto: CreateSequenceMessageDto,
    userId: string | null,
    shareToken: string | null = null,
    clientId: string | null = null,
  ): Promise<SequenceMessageModel> {
    await this.access.assertCanWrite(projectId, userId, shareToken);
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found.`);
    }
    const message = this.messages.create({
      projectId,
      fromLifelineId: dto.fromLifelineId,
      toLifelineId: dto.toLifelineId,
      label: dto.label ?? null,
      y: dto.y,
      style: dto.style ?? 'solid',
      direction: dto.direction ?? 'forward',
      arrowhead: dto.arrowhead ?? 'arrow',
    });
    const saved = await this.messages.save(message);
    const model = toSequenceMessageModel(saved);
    this.realtime.emit(projectId, clientId, { kind: 'sequenceMessage.created', message: model });
    return model;
  }

  async update(
    messageId: string,
    dto: UpdateSequenceMessageDto,
    userId: string | null,
    shareToken: string | null = null,
    clientId: string | null = null,
  ): Promise<SequenceMessageModel> {
    const projectId = await this.projectIdForMessage(messageId);
    await this.access.assertCanWrite(projectId, userId, shareToken);
    const message = await this.findOrThrow(messageId);
    if (dto.fromLifelineId !== undefined) message.fromLifelineId = dto.fromLifelineId;
    if (dto.toLifelineId !== undefined) message.toLifelineId = dto.toLifelineId;
    if (dto.label !== undefined) message.label = dto.label;
    if (dto.style !== undefined) message.style = dto.style;
    if (dto.direction !== undefined) message.direction = dto.direction;
    if (dto.arrowhead !== undefined) message.arrowhead = dto.arrowhead;
    const saved = await this.messages.save(message);
    const model = toSequenceMessageModel(saved);
    this.realtime.emit(projectId, clientId, { kind: 'sequenceMessage.updated', message: model });
    return model;
  }

  async updatePosition(
    messageId: string,
    dto: UpdateSequenceMessagePositionDto,
    userId: string | null,
    shareToken: string | null = null,
    clientId: string | null = null,
  ): Promise<void> {
    const projectId = await this.projectIdForMessage(messageId);
    await this.access.assertCanWrite(projectId, userId, shareToken);
    const result = await this.messages.update({ id: messageId }, { y: dto.y });
    if (!result.affected) {
      throw new NotFoundException(`SequenceMessage ${messageId} not found.`);
    }
    this.realtime.emit(projectId, clientId, {
      kind: 'sequenceMessage.moved',
      messageId,
      y: dto.y,
    });
  }

  async remove(
    messageId: string,
    userId: string | null,
    shareToken: string | null = null,
    clientId: string | null = null,
  ): Promise<void> {
    const projectId = await this.projectIdForMessage(messageId);
    await this.access.assertCanWrite(projectId, userId, shareToken);
    const result = await this.messages.delete({ id: messageId });
    if (!result.affected) {
      throw new NotFoundException(`SequenceMessage ${messageId} not found.`);
    }
    this.realtime.emit(projectId, clientId, { kind: 'sequenceMessage.deleted', messageId });
  }

  private async findOrThrow(messageId: string): Promise<SequenceMessageEntity> {
    const msg = await this.messages.findOne({ where: { id: messageId } });
    if (!msg) throw new NotFoundException(`SequenceMessage ${messageId} not found.`);
    return msg;
  }

  private async projectIdForMessage(messageId: string): Promise<string> {
    const msg = await this.messages.findOne({
      where: { id: messageId },
      select: { id: true, projectId: true },
    });
    if (!msg) throw new NotFoundException(`SequenceMessage ${messageId} not found.`);
    return msg.projectId;
  }
}
