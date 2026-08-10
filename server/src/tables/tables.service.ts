import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TableModel } from '@dbdesigner/shared';
import { Project } from '../projects/project.entity';
import { TableEntity } from './table.entity';
import { toTableModel } from './table.mapper';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { UpdatePositionDto } from './dto/update-position.dto';

/**
 * Business logic for table nodes. Data access via the injected repositories.
 * Access checks move into the policy layer once auth/sharing land; child routes
 * carry the parent id so ancestry resolution stays cheap (section 7).
 */
@Injectable()
export class TablesService {
  constructor(
    @InjectRepository(TableEntity)
    private readonly tables: Repository<TableEntity>,
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
  ) {}

  /** All tables (with columns) for a project, as shared TableModels. */
  async getModelsForProject(projectId: string): Promise<TableModel[]> {
    const rows = await this.tables.find({
      where: { projectId },
      relations: { columns: true },
      order: { name: 'ASC' },
    });
    return rows.map(toTableModel);
  }

  async create(projectId: string, dto: CreateTableDto): Promise<TableModel> {
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
    });
    const saved = await this.tables.save(table);
    return toTableModel({ ...saved, columns: [] });
  }

  async update(tableId: string, dto: UpdateTableDto): Promise<TableModel> {
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
    await this.tables.save(table);
    return this.getModel(tableId);
  }

  async updatePosition(tableId: string, dto: UpdatePositionDto): Promise<void> {
    const result = await this.tables.update({ id: tableId }, { x: dto.x, y: dto.y });
    if (!result.affected) {
      throw new NotFoundException(`Table ${tableId} not found.`);
    }
  }

  async remove(tableId: string): Promise<void> {
    // Columns (and any relationships referencing them) cascade via FK.
    const result = await this.tables.delete({ id: tableId });
    if (!result.affected) {
      throw new NotFoundException(`Table ${tableId} not found.`);
    }
  }

  private async getModel(tableId: string): Promise<TableModel> {
    const table = await this.tables.findOne({
      where: { id: tableId },
      relations: { columns: true },
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
