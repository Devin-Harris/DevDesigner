import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ColumnModel } from '@devdesigner/shared';
import { TableEntity } from '../tables/table.entity';
import { applyDefined } from '../../common/apply-patch';
import { clientId } from '../../common/client-id';
import { RealtimePublisher } from '../../../platform/realtime/realtime.publisher';
import { ColumnEntity } from './column.entity';
import { fromDataType, toColumnModel } from './column.mapper';
import { CreateColumnDto } from './dto/create-column.dto';
import { UpdateColumnDto } from './dto/update-column.dto';
import { ReorderColumnsDto } from './dto/reorder-columns.dto';

/**
 * Business logic for columns. New columns append to the end of their table;
 * reorder persists the new order in one small call. Deleting a column also
 * removes any relationships referencing it (cascade via FK). Every mutation
 * broadcasts the persisted change to the project's realtime room.
 */
@Injectable()
export class ColumnsService {
  constructor(
    @InjectRepository(ColumnEntity)
    private readonly columns: Repository<ColumnEntity>,
    @InjectRepository(TableEntity)
    private readonly tables: Repository<TableEntity>,
    private readonly realtime: RealtimePublisher,
  ) {}

  async create(
    projectId: string,
    tableId: string,
    dto: CreateColumnDto,
  ): Promise<ColumnModel> {
    const table = await this.tables.findOne({ where: { id: tableId } });
    if (!table) {
      throw new NotFoundException(`Table ${tableId} not found.`);
    }
    const count = await this.columns.count({ where: { tableId } });
    const column = this.columns.create({
      ...(await clientId(this.columns, dto.id, 'Column')),
      tableId,
      name: dto.name,
      ...fromDataType(dto.dataType),
      isPrimaryKey: dto.isPrimaryKey ?? false,
      isNullable: dto.isNullable ?? true,
      isUnique: dto.isUnique ?? false,
      isAutoIncrement: dto.isAutoIncrement ?? false,
      isUnsigned: dto.isUnsigned ?? false,
      defaultValue: dto.defaultValue ?? null,
      orderIndex: count,
    });
    const saved = await this.columns.save(column);
    const model = toColumnModel(saved);
    this.realtime.emit(projectId, { kind: 'column.created', tableId, column: model });
    return model;
  }

  async update(
    projectId: string,
    columnId: string,
    dto: UpdateColumnDto,
  ): Promise<ColumnModel> {
    const column = await this.findOrThrow(columnId);
    applyColumnPatch(column, dto);
    const saved = await this.columns.save(column);
    const model = toColumnModel(saved);
    this.realtime.emit(projectId, {
      kind: 'column.updated',
      tableId: column.tableId,
      column: model,
    });
    return model;
  }

  async reorder(
    projectId: string,
    tableId: string,
    dto: ReorderColumnsDto,
  ): Promise<void> {
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
    this.realtime.emit(projectId, {
      kind: 'column.reordered',
      tableId,
      orderedColumnIds: dto.orderedColumnIds,
    });
  }

  async remove(
    projectId: string,
    columnId: string,
  ): Promise<void> {
    const column = await this.findOrThrow(columnId);
    const tableId = column.tableId;
    const result = await this.columns.delete({ id: columnId });
    if (!result.affected) {
      throw new NotFoundException(`Column ${columnId} not found.`);
    }
    this.realtime.emit(projectId, { kind: 'column.deleted', tableId, columnId });
  }

  private async findOrThrow(columnId: string): Promise<ColumnEntity> {
    const column = await this.columns.findOne({ where: { id: columnId } });
    if (!column) {
      throw new NotFoundException(`Column ${columnId} not found.`);
    }
    return column;
  }
}

/** Apply a validated column patch in place (shared with the batch endpoint). */
export function applyColumnPatch(column: ColumnEntity, dto: UpdateColumnDto): void {
  applyDefined(column, dto, [
    'name',
    'isPrimaryKey',
    'isNullable',
    'isUnique',
    'isAutoIncrement',
    'isUnsigned',
    'defaultValue',
    'note',
  ]);
  if (dto.dataType !== undefined) {
    Object.assign(column, fromDataType(dto.dataType));
  }
}
