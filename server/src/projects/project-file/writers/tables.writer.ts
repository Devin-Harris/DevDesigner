import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { TableModel } from '@devdesigner/shared';
import { ColumnEntity } from '../../schema/columns/column.entity';
import { fromDataType } from '../../schema/columns/column.mapper';
import { IndexEntity } from '../../schema/indexes/index.entity';
import { TableEntity } from '../../schema/tables/table.entity';
import { insertAll, type WriteContext } from './write-context';

/** Planned tables with their columns and indexes (ids already remapped). */
export async function writeTables(ctx: WriteContext, tables: readonly TableModel[]): Promise<void> {
  const tableRows: QueryDeepPartialEntity<TableEntity>[] = [];
  const columnRows: QueryDeepPartialEntity<ColumnEntity>[] = [];
  const indexRows: QueryDeepPartialEntity<IndexEntity>[] = [];
  for (const t of tables) {
    tableRows.push({
      id: t.id,
      projectId: ctx.projectId,
      name: t.name,
      x: t.x,
      y: t.y,
      color: t.color ?? null,
      note: t.note ?? null,
      width: t.width ?? null,
      scale: t.scale && t.scale > 0 && t.scale !== 1 ? Math.min(8, t.scale) : null,
      groupId: t.groupId ?? null,
      slideId: t.slideId ?? null,
      morphId: t.morphId?.startsWith('tag:') ? t.morphId : null,
    });
    t.columns.forEach((c, orderIndex) => {
      columnRows.push({
        id: c.id,
        tableId: t.id,
        name: c.name,
        ...fromDataType(c.dataType),
        isPrimaryKey: c.isPrimaryKey,
        isNullable: c.isNullable,
        isUnique: c.isUnique,
        isAutoIncrement: c.isAutoIncrement,
        isUnsigned: c.isUnsigned ?? false,
        defaultValue: c.defaultValue ?? null,
        note: c.note ?? null,
        orderIndex,
      });
    });
    (t.indexes ?? []).forEach((ix, orderIndex) => {
      indexRows.push({
        id: ix.id,
        tableId: t.id,
        name: ix.name,
        columnIdsJson: JSON.stringify(ix.columnIds),
        isUnique: ix.isUnique,
        orderIndex,
      });
    });
  }
  await insertAll(ctx.manager, TableEntity, tableRows);
  await insertAll(ctx.manager, ColumnEntity, columnRows);
  await insertAll(ctx.manager, IndexEntity, indexRows);
}
