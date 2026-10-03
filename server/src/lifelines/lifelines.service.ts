import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { LifelineModel } from '@dbdesigner/shared';
import { Project } from '../projects/project.entity';
import { AccessService } from '../access/access.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { LifelineEntity } from './lifeline.entity';
import { toLifelineModel } from './lifeline.mapper';
import { CreateLifelineDto } from './dto/create-lifeline.dto';
import { UpdateLifelineDto } from './dto/update-lifeline.dto';
import { UpdateLifelinePositionDto } from './dto/update-lifeline-position.dto';
import { ReorderLifelinesDto } from './dto/reorder-lifelines.dto';

@Injectable()
export class LifelinesService {
  constructor(
    @InjectRepository(LifelineEntity)
    private readonly lifelines: Repository<LifelineEntity>,
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    private readonly access: AccessService,
    private readonly realtime: RealtimePublisher,
  ) {}

  async getModelsForProject(projectId: string): Promise<LifelineModel[]> {
    const rows = await this.lifelines.find({
      where: { projectId },
      order: { order: 'ASC', x: 'ASC' },
    });
    return rows.map(toLifelineModel);
  }

  async create(
    projectId: string,
    dto: CreateLifelineDto,
    userId: string | null,
    shareToken: string | null = null,
    clientId: string | null = null,
  ): Promise<LifelineModel> {
    await this.access.assertCanWrite(projectId, userId, shareToken);
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found.`);
    }
    const maxOrder = await this.lifelines.count({ where: { projectId } });
    const lifeline = this.lifelines.create({
      projectId,
      label: dto.label,
      color: dto.color ?? null,
      x: dto.x,
      width: dto.width ?? 120,
      order: dto.order ?? maxOrder,
    });
    const saved = await this.lifelines.save(lifeline);
    const model = toLifelineModel(saved);
    this.realtime.emit(projectId, clientId, { kind: 'lifeline.created', lifeline: model });
    return model;
  }

  async update(
    lifelineId: string,
    dto: UpdateLifelineDto,
    userId: string | null,
    shareToken: string | null = null,
    clientId: string | null = null,
  ): Promise<LifelineModel> {
    const projectId = await this.projectIdForLifeline(lifelineId);
    await this.access.assertCanWrite(projectId, userId, shareToken);
    const lifeline = await this.findOrThrow(lifelineId);
    if (dto.label !== undefined) lifeline.label = dto.label;
    if (dto.color !== undefined) lifeline.color = dto.color;
    if (dto.width !== undefined) lifeline.width = dto.width;
    const saved = await this.lifelines.save(lifeline);
    const model = toLifelineModel(saved);
    this.realtime.emit(projectId, clientId, { kind: 'lifeline.updated', lifeline: model });
    return model;
  }

  async updatePosition(
    lifelineId: string,
    dto: UpdateLifelinePositionDto,
    userId: string | null,
    shareToken: string | null = null,
    clientId: string | null = null,
  ): Promise<void> {
    const projectId = await this.projectIdForLifeline(lifelineId);
    await this.access.assertCanWrite(projectId, userId, shareToken);
    const result = await this.lifelines.update({ id: lifelineId }, { x: dto.x });
    if (!result.affected) {
      throw new NotFoundException(`Lifeline ${lifelineId} not found.`);
    }
    this.realtime.emit(projectId, clientId, { kind: 'lifeline.moved', lifelineId, x: dto.x });
  }

  async reorder(
    projectId: string,
    dto: ReorderLifelinesDto,
    userId: string | null,
    shareToken: string | null = null,
    clientId: string | null = null,
  ): Promise<void> {
    await this.access.assertCanWrite(projectId, userId, shareToken);
    await Promise.all(
      dto.orderedLifelineIds.map((id, index) =>
        this.lifelines.update({ id, projectId }, { order: index }),
      ),
    );
    this.realtime.emit(projectId, clientId, {
      kind: 'lifeline.reordered',
      orderedLifelineIds: dto.orderedLifelineIds,
    });
  }

  async remove(
    lifelineId: string,
    userId: string | null,
    shareToken: string | null = null,
    clientId: string | null = null,
  ): Promise<void> {
    const projectId = await this.projectIdForLifeline(lifelineId);
    await this.access.assertCanWrite(projectId, userId, shareToken);
    const result = await this.lifelines.delete({ id: lifelineId });
    if (!result.affected) {
      throw new NotFoundException(`Lifeline ${lifelineId} not found.`);
    }
    this.realtime.emit(projectId, clientId, { kind: 'lifeline.deleted', lifelineId });
  }

  private async findOrThrow(lifelineId: string): Promise<LifelineEntity> {
    const lifeline = await this.lifelines.findOne({ where: { id: lifelineId } });
    if (!lifeline) throw new NotFoundException(`Lifeline ${lifelineId} not found.`);
    return lifeline;
  }

  private async projectIdForLifeline(lifelineId: string): Promise<string> {
    const lifeline = await this.lifelines.findOne({
      where: { id: lifelineId },
      select: { id: true, projectId: true },
    });
    if (!lifeline) throw new NotFoundException(`Lifeline ${lifelineId} not found.`);
    return lifeline.projectId;
  }
}
