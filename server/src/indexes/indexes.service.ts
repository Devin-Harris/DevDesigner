import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { IndexModel } from '@dbdesigner/shared';
import { TableEntity } from '../tables/table.entity';
import { AccessService } from '../access/access.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { IndexEntity } from './index.entity';
import { toIndexModel } from './index.mapper';
import { CreateIndexDto } from './dto/create-index.dto';
import { UpdateIndexDto } from './dto/update-index.dto';
import { ReorderIndexesDto } from './dto/reorder-indexes.dto';

/**
 * Business logic for table indexes. New indexes append to the end of their
 * table; reorder persists the new order in one small call. Deleting the parent
 * table cascades to its indexes (FK). Every mutation broadcasts the persisted
 * change to the project's realtime room.
 */
@Injectable()
export class IndexesService {
  constructor(
    @InjectRepository(IndexEntity)
    private readonly indexes: Repository<IndexEntity>,
    @InjectRepository(TableEntity)
    private readonly tables: Repository<TableEntity>,
    private readonly access: AccessService,
    private readonly realtime: RealtimePublisher,
  ) {}

  async create(
    tableId: string,
    dto: CreateIndexDto,
    userId: string | null,
    shareToken: string | null = null,
    clientId: string | null = null,
  ): Promise<IndexModel> {
    const projectId = await this.access.assertCanWriteTable(tableId, userId, shareToken);
    const table = await this.tables.findOne({ where: { id: tableId } });
    if (!table) {
      throw new NotFoundException(`Table ${tableId} not found.`);
    }
    const count = await this.indexes.count({ where: { tableId } });
    const entity = this.indexes.create({
      tableId,
      name: dto.name,
      columnIdsJson: JSON.stringify(dto.columnIds),
      isUnique: dto.isUnique ?? false,
      orderIndex: count,
    });
    const saved = await this.indexes.save(entity);
    const model = toIndexModel(saved);
    this.realtime.emit(projectId, clientId, { kind: 'index.created', tableId, index: model });
    return model;
  }

  async update(
    indexId: string,
    dto: UpdateIndexDto,
    userId: string | null,
    shareToken: string | null = null,
    clientId: string | null = null,
  ): Promise<IndexModel> {
    const projectId = await this.access.assertCanWriteIndex(indexId, userId, shareToken);
    const index = await this.findOrThrow(indexId);
    if (dto.name !== undefined) {
      index.name = dto.name;
    }
    if (dto.columnIds !== undefined) {
      index.columnIdsJson = JSON.stringify(dto.columnIds);
    }
    if (dto.isUnique !== undefined) {
      index.isUnique = dto.isUnique;
    }
    const saved = await this.indexes.save(index);
    const model = toIndexModel(saved);
    this.realtime.emit(projectId, clientId, {
      kind: 'index.updated',
      tableId: index.tableId,
      index: model,
    });
    return model;
  }

  async reorder(
    tableId: string,
    dto: ReorderIndexesDto,
    userId: string | null,
    shareToken: string | null = null,
    clientId: string | null = null,
  ): Promise<void> {
    const projectId = await this.access.assertCanWriteTable(tableId, userId, shareToken);
    const indexes = await this.indexes.find({ where: { tableId } });
    const byId = new Map(indexes.map((i) => [i.id, i]));
    const updates: IndexEntity[] = [];
    dto.orderedIndexIds.forEach((id, order) => {
      const index = byId.get(id);
      if (index && index.orderIndex !== order) {
        index.orderIndex = order;
        updates.push(index);
      }
    });
    if (updates.length) {
      await this.indexes.save(updates);
    }
    this.realtime.emit(projectId, clientId, {
      kind: 'index.reordered',
      tableId,
      orderedIndexIds: dto.orderedIndexIds,
    });
  }

  async remove(
    indexId: string,
    userId: string | null,
    shareToken: string | null = null,
    clientId: string | null = null,
  ): Promise<void> {
    const projectId = await this.access.assertCanWriteIndex(indexId, userId, shareToken);
    const index = await this.findOrThrow(indexId);
    const tableId = index.tableId;
    const result = await this.indexes.delete({ id: indexId });
    if (!result.affected) {
      throw new NotFoundException(`Index ${indexId} not found.`);
    }
    this.realtime.emit(projectId, clientId, { kind: 'index.deleted', tableId, indexId });
  }

  private async findOrThrow(indexId: string): Promise<IndexEntity> {
    const index = await this.indexes.findOne({ where: { id: indexId } });
    if (!index) {
      throw new NotFoundException(`Index ${indexId} not found.`);
    }
    return index;
  }
}
