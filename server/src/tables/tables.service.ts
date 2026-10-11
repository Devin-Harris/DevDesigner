import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TableModel } from '@dbdesigner/shared';
import { Project } from '../projects/project.entity';
import { AccessService } from '../access/access.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { TableEntity } from './table.entity';
import { toTableModel } from './table.mapper';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { UpdatePositionDto } from './dto/update-position.dto';

/**
 * Business logic for table nodes. Data access via the injected repositories.
 * Every mutation authorizes through the policy layer first, then broadcasts the
 * persisted change to the project's realtime room (server-authoritative sync).
 * Child routes carry the parent id so ancestry resolution stays cheap (section 7).
 */
@Injectable()
export class TablesService {
  constructor(
    @InjectRepository(TableEntity)
    private readonly tables: Repository<TableEntity>,
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    private readonly access: AccessService,
    private readonly realtime: RealtimePublisher,
  ) {}

  /** All tables (with columns) for a project, as shared TableModels. */
  async getModelsForProject(projectId: string): Promise<TableModel[]> {
    const rows = await this.tables.find({
      where: { projectId },
      relations: { columns: true, indexes: true },
      order: { name: 'ASC' },
    });
    return rows.map(toTableModel);
  }

  async create(
    projectId: string,
    dto: CreateTableDto,
    userId: string | null,
    shareToken: string | null = null,
    clientId: string | null = null,
  ): Promise<TableModel> {
    await this.access.assertCanWrite(projectId, userId, shareToken);
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found.`);
    }
    const table = this.tables.create({
      projectId,
      name: dto.name,
      x: dto.x,
      y: dto.y,
      color: dto.color ?? null,
      slideId: dto.slideId ?? null,
    });
    const saved = await this.tables.save(table);
    const model = toTableModel({ ...saved, columns: [], indexes: [] });
    this.realtime.emit(projectId, clientId, { kind: 'table.created', table: model });
    return model;
  }

  async update(
    tableId: string,
    dto: UpdateTableDto,
    userId: string | null,
    shareToken: string | null = null,
    clientId: string | null = null,
  ): Promise<TableModel> {
    const projectId = await this.access.assertCanWriteTable(tableId, userId, shareToken);
    const table = await this.findOrThrow(tableId);
    if (dto.name !== undefined) {
      table.name = dto.name;
    }
    if (dto.color !== undefined) {
      table.color = dto.color;
    }
    if (dto.note !== undefined) {
      table.note = dto.note;
    }
    if (dto.width !== undefined) {
      table.width = dto.width > 0 ? dto.width : null;
    }
    if (dto.scale !== undefined) {
      table.scale = dto.scale > 0 && dto.scale !== 1 ? dto.scale : null;
    }
    if (dto.groupId !== undefined) {
      table.groupId = dto.groupId;
    }
    if (dto.slideId !== undefined) {
      table.slideId = dto.slideId;
    }
    await this.tables.save(table);
    const model = await this.getModel(tableId);
    this.realtime.emit(projectId, clientId, { kind: 'table.updated', table: model });
    return model;
  }

  async updatePosition(
    tableId: string,
    dto: UpdatePositionDto,
    userId: string | null,
    shareToken: string | null = null,
    clientId: string | null = null,
  ): Promise<void> {
    const projectId = await this.access.assertCanWriteTable(tableId, userId, shareToken);
    const result = await this.tables.update({ id: tableId }, { x: dto.x, y: dto.y });
    if (!result.affected) {
      throw new NotFoundException(`Table ${tableId} not found.`);
    }
    this.realtime.emit(projectId, clientId, {
      kind: 'table.moved',
      tableId,
      x: dto.x,
      y: dto.y,
    });
  }

  async remove(
    tableId: string,
    userId: string | null,
    shareToken: string | null = null,
    clientId: string | null = null,
  ): Promise<void> {
    const projectId = await this.access.assertCanWriteTable(tableId, userId, shareToken);
    // Columns (and any relationships referencing them) cascade via FK.
    const result = await this.tables.delete({ id: tableId });
    if (!result.affected) {
      throw new NotFoundException(`Table ${tableId} not found.`);
    }
    this.realtime.emit(projectId, clientId, { kind: 'table.deleted', tableId });
  }

  private async getModel(tableId: string): Promise<TableModel> {
    const table = await this.tables.findOne({
      where: { id: tableId },
      relations: { columns: true, indexes: true },
    });
    if (!table) {
      throw new NotFoundException(`Table ${tableId} not found.`);
    }
    return toTableModel(table);
  }

  private async findOrThrow(tableId: string): Promise<TableEntity> {
    const table = await this.tables.findOne({ where: { id: tableId } });
    if (!table) {
      throw new NotFoundException(`Table ${tableId} not found.`);
    }
    return table;
  }
}
