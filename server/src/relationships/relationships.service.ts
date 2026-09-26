import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { RelationshipModel } from '@dbdesigner/shared';
import { ColumnEntity } from '../columns/column.entity';
import { AccessService } from '../access/access.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { RelationshipEntity } from './relationship.entity';
import { toRelationshipModel } from './relationship.mapper';
import { CreateRelationshipDto } from './dto/create-relationship.dto';
import { UpdateRelationshipDto } from './dto/update-relationship.dto';

/**
 * Business logic for relationships. Enforces integrity rules before any write
 * (section 7): both endpoints must exist and belong to the project, a column
 * cannot relate to itself, and duplicate edges between the same column pair are
 * rejected in either direction.
 */
@Injectable()
export class RelationshipsService {
  constructor(
    @InjectRepository(RelationshipEntity)
    private readonly relationships: Repository<RelationshipEntity>,
    @InjectRepository(ColumnEntity)
    private readonly columns: Repository<ColumnEntity>,
    private readonly access: AccessService,
    private readonly realtime: RealtimePublisher,
  ) {}

  async getModelsForProject(projectId: string): Promise<RelationshipModel[]> {
    const rows = await this.relationships.find({ where: { projectId } });
    return rows.map(toRelationshipModel);
  }

  async create(
    projectId: string,
    dto: CreateRelationshipDto,
    userId: string | null,
    shareToken: string | null = null,
    clientId: string | null = null,
  ): Promise<RelationshipModel> {
    await this.access.assertCanWrite(projectId, userId, shareToken);
    if (dto.sourceColumnId === dto.targetColumnId) {
      throw new BadRequestException('A column cannot relate to itself.');
    }

    await this.assertColumnInProject(dto.sourceColumnId, projectId, 'source');
    await this.assertColumnInProject(dto.targetColumnId, projectId, 'target');
    await this.assertNoDuplicate(projectId, dto.sourceColumnId, dto.targetColumnId);

    const relationship = this.relationships.create({
      projectId,
      sourceColumnId: dto.sourceColumnId,
      targetColumnId: dto.targetColumnId,
      type: dto.type,
      onDelete: dto.onDelete ?? null,
      onUpdate: dto.onUpdate ?? null,
    });
    const saved = await this.relationships.save(relationship);
    const model = toRelationshipModel(saved);
    this.realtime.emit(projectId, clientId, { kind: 'relationship.created', relationship: model });
    return model;
  }

  async update(
    id: string,
    dto: UpdateRelationshipDto,
    userId: string | null,
    shareToken: string | null = null,
    clientId: string | null = null,
  ): Promise<RelationshipModel> {
    const projectId = await this.access.assertCanWriteRelationship(id, userId, shareToken);
    const relationship = await this.findOrThrow(id);

    // Re-pointing an endpoint: validate the new column(s) and reject self/duplicate.
    const nextSource = dto.sourceColumnId ?? relationship.sourceColumnId;
    const nextTarget = dto.targetColumnId ?? relationship.targetColumnId;
    if (dto.sourceColumnId !== undefined || dto.targetColumnId !== undefined) {
      if (nextSource === nextTarget) {
        throw new BadRequestException('A column cannot relate to itself.');
      }
      if (dto.sourceColumnId !== undefined) {
        await this.assertColumnInProject(nextSource, relationship.projectId, 'source');
      }
      if (dto.targetColumnId !== undefined) {
        await this.assertColumnInProject(nextTarget, relationship.projectId, 'target');
      }
      await this.assertNoDuplicate(relationship.projectId, nextSource, nextTarget, id);
      relationship.sourceColumnId = nextSource;
      relationship.targetColumnId = nextTarget;
    }

    if (dto.type !== undefined) {
      relationship.type = dto.type;
    }
    if (dto.onDelete !== undefined) {
      relationship.onDelete = dto.onDelete;
    }
    if (dto.onUpdate !== undefined) {
      relationship.onUpdate = dto.onUpdate;
    }
    if (dto.waypoints !== undefined) {
      relationship.waypointsJson = dto.waypoints.length ? JSON.stringify(dto.waypoints) : null;
    }
    const saved = await this.relationships.save(relationship);
    const model = toRelationshipModel(saved);
    this.realtime.emit(projectId, clientId, { kind: 'relationship.updated', relationship: model });
    return model;
  }

  async remove(
    id: string,
    userId: string | null,
    shareToken: string | null = null,
    clientId: string | null = null,
  ): Promise<void> {
    const projectId = await this.access.assertCanWriteRelationship(id, userId, shareToken);
    const result = await this.relationships.delete({ id });
    if (!result.affected) {
      throw new NotFoundException(`Relationship ${id} not found.`);
    }
    this.realtime.emit(projectId, clientId, { kind: 'relationship.deleted', relationshipId: id });
  }

  /** Reject an edge that already exists between the same column pair (either direction). */
  private async assertNoDuplicate(
    projectId: string,
    sourceColumnId: string,
    targetColumnId: string,
    excludeId?: string,
  ): Promise<void> {
    const matches = await this.relationships.find({
      where: [
        { projectId, sourceColumnId, targetColumnId },
        { projectId, sourceColumnId: targetColumnId, targetColumnId: sourceColumnId },
      ],
    });
    const duplicate = matches.find((r) => r.id !== excludeId);
    if (duplicate) {
      throw new ConflictException('A relationship between these columns already exists.');
    }
  }

  private async assertColumnInProject(
    columnId: string,
    projectId: string,
    role: 'source' | 'target',
  ): Promise<void> {
    const column = await this.columns.findOne({
      where: { id: columnId },
      relations: { table: true },
    });
    if (!column) {
      throw new NotFoundException(`The ${role} column ${columnId} was not found.`);
    }
    if (column.table.projectId !== projectId) {
      throw new BadRequestException(`The ${role} column does not belong to this project.`);
    }
  }

  private async findOrThrow(id: string): Promise<RelationshipEntity> {
    const relationship = await this.relationships.findOne({ where: { id } });
    if (!relationship) {
      throw new NotFoundException(`Relationship ${id} not found.`);
    }
    return relationship;
  }
}
