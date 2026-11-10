import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TableModel } from '@devdesigner/shared';
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
      // Columns and indexes in their own IN queries, not one columns x indexes JOIN.
      relationLoadStrategy: 'query',
      order: { name: 'ASC' },
    });
    return rows.map(toTableModel);
  }

  async create(
    projectId: string,
    dto: CreateTableDto,
  ): Promise<TableModel> {
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
      morphId: dto.morphId?.trim() || null,
    });
    const saved = await this.tables.save(table);
    const model = toTableModel({ ...saved, columns: [], indexes: [] });
    this.realtime.emit(projectId, { kind: 'table.created', table: model });
    return model;
  }

  async update(
    projectId: string,
    tableId: string,
    dto: UpdateTableDto,
  ): Promise<TableModel> {
    const table = await this.findOrThrow(tableId);
    applyTablePatch(table, dto);
    await this.tables.save(table);
    const model = await this.getModel(tableId);
    this.realtime.emit(projectId, { kind: 'table.updated', table: model });
    return model;
  }

  async updatePosition(
    projectId: string,
    tableId: string,
    dto: UpdatePositionDto,
  ): Promise<void> {
    const result = await this.tables.update({ id: tableId }, { x: dto.x, y: dto.y });
    if (!result.affected) {
      throw new NotFoundException(`Table ${tableId} not found.`);
    }
    this.realtime.emit(projectId, {
      kind: 'table.moved',
      tableId,
      x: dto.x,
      y: dto.y,
    });
  }

  async remove(
    projectId: string,
    tableId: string,
  ): Promise<void> {
    // Columns (and any relationships referencing them) cascade via FK.
    const result = await this.tables.delete({ id: tableId });
    if (!result.affected) {
      throw new NotFoundException(`Table ${tableId} not found.`);
    }
    this.realtime.emit(projectId, { kind: 'table.deleted', tableId });
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

/** Apply an update DTO onto a table entity (shared with the batch endpoint). */
export function applyTablePatch(table: TableEntity, dto: UpdateTableDto): void {
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
  if (dto.morphId !== undefined) {
    table.morphId = dto.morphId.trim() || null;
  }
}
