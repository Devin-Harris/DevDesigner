import type { TableModel } from '@dbdesigner/shared';
import { toColumnModel } from '../columns/column.mapper';
import { TableEntity } from './table.entity';

/** Map a Table entity (with its columns loaded) to the shared TableModel. */
export function toTableModel(entity: TableEntity): TableModel {
  const columns = [...(entity.columns ?? [])]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map(toColumnModel);
  return {
    id: entity.id,
    name: entity.name,
    columns,
    x: entity.x,
    y: entity.y,
    color: entity.color ?? undefined,
    note: entity.note ?? undefined,
  };
}
