import type { TableModel } from '@dbdesigner/shared';
import { toColumnModel } from '../columns/column.mapper';
import { toIndexModel } from '../indexes/index.mapper';
import { TableEntity } from './table.entity';

/** Map a Table entity (with its columns + indexes loaded) to the shared TableModel. */
export function toTableModel(entity: TableEntity): TableModel {
  const columns = [...(entity.columns ?? [])]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map(toColumnModel);
  const indexes = [...(entity.indexes ?? [])]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map(toIndexModel);
  return {
    id: entity.id,
    name: entity.name,
    columns,
    indexes,
    x: entity.x,
    y: entity.y,
    color: entity.color ?? undefined,
    note: entity.note ?? undefined,
    width: entity.width ?? undefined,
    scale: entity.scale ?? undefined,
    groupId: entity.groupId ?? undefined,
    slideId: entity.slideId ?? undefined,
    morphId: entity.morphId ?? undefined,
  };
}
