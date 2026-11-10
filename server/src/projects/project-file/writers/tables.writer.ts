import { randomUUID } from 'node:crypto';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { IndexModel, SchemaModel, TableModel } from '@devdesigner/shared';
import { ColumnEntity } from '../../schema/columns/column.entity';
import { fromDataType } from '../../schema/columns/column.mapper';
import { IndexEntity } from '../../schema/indexes/index.entity';
import { TableEntity } from '../../schema/tables/table.entity';
import { insertAll, type WriteContext } from './write-context';

/** Tables with their columns and indexes (index columns that did not survive are dropped). */
export async function writeTables(ctx: WriteContext, schema: SchemaModel): Promise<TableModel[]> {
  const tableModels: TableModel[] = [];
  const tableRows: QueryDeepPartialEntity<TableEntity>[] = [];
  const columnRows: QueryDeepPartialEntity<ColumnEntity>[] = [];
  const indexRows: QueryDeepPartialEntity<IndexEntity>[] = [];
  for (const t of schema.tables) {
    const tableId = ctx.tableIds.get(t.id)!;
    const groupId = ctx.group(t.groupId);
    const columns = t.columns.map((c) => ({ ...c, id: ctx.columnIds.mint(c.id) }));
    const indexes: IndexModel[] = [];
    for (const ix of t.indexes ?? []) {
      const covered = ix.columnIds
        .map((id) => ctx.columnIds.get(id))
        .filter((id): id is string => id !== undefined);
      if (covered.length === 0) continue;
      indexes.push({ id: randomUUID(), name: ix.name, columnIds: covered, isUnique: ix.isUnique });
    }
    tableModels.push({
      ...t,
      id: tableId,
      x: t.x + ctx.dx,
      y: t.y + ctx.dy,
      columns,
      indexes: indexes.length ? indexes : undefined,
      groupId: groupId ?? undefined,
      slideId: ctx.slideOf(t.slideId) ?? undefined,
    });
    tableRows.push({
      id: tableId,
      projectId: ctx.projectId,
      name: t.name,
      x: t.x + ctx.dx,
      y: t.y + ctx.dy,
      color: t.color ?? null,
      note: t.note ?? null,
      width: t.width ?? null,
      scale: t.scale && t.scale > 0 && t.scale !== 1 ? Math.min(8, t.scale) : null,
      groupId,
      slideId: ctx.slideOf(t.slideId),
      morphId: t.morphId?.startsWith('tag:') ? t.morphId : null,
    });
    columns.forEach((c, orderIndex) => {
      columnRows.push({
        id: c.id,
        tableId,
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
    indexes.forEach((ix, orderIndex) => {
      indexRows.push({
        id: ix.id,
        tableId,
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

  return tableModels;
}
