import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { ColumnModel } from '@dbdesigner/shared';
import { TableEntity } from '../tables/table.entity';
import { ColumnEntity } from './column.entity';
import { fromDataType, toColumnModel } from './column.mapper';
import { CreateColumnDto } from './dto/create-column.dto';
import { UpdateColumnDto } from './dto/update-column.dto';
import { ReorderColumnsDto } from './dto/reorder-columns.dto';

/**
 * Business logic for columns. New columns append to the end of their table;
 * reorder persists the new order in one small call. Deleting a column also
 * removes any relationships referencing it (cascade added with Phase 3).
 */
@Injectable()
export class ColumnsService {
  constructor(
    @InjectRepository(ColumnEntity)
    private readonly columns: Repository<ColumnEntity>,
    @InjectRepository(TableEntity)
    private readonly tables: Repository<TableEntity>,
  ) {}

  async create(tableId: string, dto: CreateColumnDto): Promise<ColumnModel> {
    const table = await this.tables.findOne({ where: { id: tableId } });
    if (!table) {
      throw new NotFoundException(`Table ${tableId} not found.`);
    }
    const count = await this.columns.count({ where: { tableId } });
    const column = this.columns.create({
      tableId,
      name: dto.name,
      ...fromDataType(dto.dataType),
      isPrimaryKey: dto.isPrimaryKey ?? false,
      isNullable: dto.isNullable ?? true,
      isUnique: dto.isUnique ?? false,
      isAutoIncrement: dto.isAutoIncrement ?? false,
      defaultValue: dto.defaultValue ?? null,
      orderIndex: count,
    });
    const saved = await this.columns.save(column);
    return toColumnModel(saved);
  }

  async update(columnId: string, dto: UpdateColumnDto): Promise<ColumnModel> {
    const column = await this.findOrThrow(columnId);
    if (dto.name !== undefined) {
      column.name = dto.name;
    }
    if (dto.dataType !== undefined) {
      const mapped = fromDataType(dto.dataType);
      column.dataTypeName = mapped.dataTypeName;
      column.dataTypeLength = mapped.dataTypeLength;
      column.dataTypeArgs = mapped.dataTypeArgs;
    }
    if (dto.isPrimaryKey !== undefined) {
      column.isPrimaryKey = dto.isPrimaryKey;
    }
    if (dto.isNullable !== undefined) {
      column.isNullable = dto.isNullable;
    }
    if (dto.isUnique !== undefined) {
      column.isUnique = dto.isUnique;
    }
    if (dto.isAutoIncrement !== undefined) {
      column.isAutoIncrement = dto.isAutoIncrement;
    }
    if (dto.defaultValue !== undefined) {
      column.defaultValue = dto.defaultValue;
    }
    if (dto.note !== undefined) {
      column.note = dto.note;
    }
    const saved = await this.columns.save(column);
    return toColumnModel(saved);
  }

  async reorder(tableId: string, dto: ReorderColumnsDto): Promise<void> {
    const columns = await this.columns.find({ where: { tableId } });
    const byId = new Map(columns.map((c) => [c.id, c]));
    const updates: ColumnEntity[] = [];
    dto.orderedColumnIds.forEach((id, index) => {
      const column = byId.get(id);
      if (column && column.orderIndex !== index) {
        column.orderIndex = index;
        updates.push(column);
      }
    });
    if (updates.length) {
      await this.columns.save(updates);
    }
  }

  async remove(columnId: string): Promise<void> {
    const result = await this.columns.delete({ id: columnId });
    if (!result.affected) {
      throw new NotFoundException(`Column ${columnId} not found.`);
    }
  }

  /** Unused today but handy: fetch models for a set of tables in one query. */
  async getModelsForTables(tableIds: string[]): Promise<ColumnModel[]> {
    if (!tableIds.length) {
      return [];
    }
    const rows = await this.columns.find({
      where: { tableId: In(tableIds) },
      order: { orderIndex: 'ASC' },
    });
    return rows.map(toColumnModel);
  }

  private async findOrThrow(columnId: string): Promise<ColumnEntity> {
    const column = await this.columns.findOne({ where: { id: columnId } });
    if (!column) {
      throw new NotFoundException(`Column ${columnId} not found.`);
    }
    return column;
  }
}
