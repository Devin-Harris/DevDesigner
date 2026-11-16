import { patchState, signalStoreFeature, type, withMethods } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import {
   type ColumnModel,
   type CreateColumnDto,
   type CreateIndexDto,
   type CreateTableDto,
   type IndexModel,
   type TableModel,
   type UpdateColumnDto,
   type UpdateIndexDto,
   type UpdateTableDto,
} from '@devdesigner/shared';
import type { ColumnSnapshot, TableGeometry } from '../models/project-state.model';
import { TABLE_PALETTE, uniqueTableName } from '../helpers/table-defaults.helper';
import type { SlidePlacement } from './project-slides-methods.feature';
import type { ProjectInternalsWith } from './project-internals';

/** ERD tables, their columns (with undo through id aliases) and indexes. */
export function withProjectTablesMethods() {
   return signalStoreFeature(
      type<ProjectInternalsWith<{ _placement: SlidePlacement }>>(),
      withMethods((store) => {
         const { setSchema, mapTable } = store._schema;
         const { debounce, flushTimers, runSave, optimistic, createOptimistic, commitPatch, stage, patchTableLocal } =
            store._queue;
         const { push: pushHistory, rid, aliasTo } = store._history;
         const { tablesApi, columnsApi, indexesApi, relationshipsApi } = store._api;
         const { shownSlideAt } = store._placement;

         // ---- Column undo/redo ----
         // A re-created column gets a new id; history refers to the original id via rid().
         function captureColumn(tableId: string, columnId: string): ColumnSnapshot | null {
            const table = store.tables().find((t) => t.id === tableId);
            const index = table?.columns.findIndex((c) => c.id === columnId) ?? -1;
            if (!table || index < 0) return null;
            const relationships = (store.schema()?.relationships ?? []).filter(
               (r) => r.sourceColumnId === columnId || r.targetColumnId === columnId
            );
            return { tableId, column: { ...table.columns[index] }, index, relationships };
         }

         async function removeColumnRaw(tableId: string, columnId: string): Promise<void> {
            flushTimers(`reorder:${tableId}`, `patch:col:${columnId}`);
            await optimistic(
               `table:${tableId}`,
               () => {
                  mapTable(tableId, (t) => ({
                     ...t,
                     columns: t.columns.filter((c) => c.id !== columnId),
                  }));
                  // The server cascades the column's relationships; mirror that locally.
                  setSchema((s) => ({
                     ...s,
                     relationships: s.relationships.filter(
                        (r) => r.sourceColumnId !== columnId && r.targetColumnId !== columnId
                     ),
                  }));
               },
               () => firstValueFrom(columnsApi.remove(columnId)),
               'delete the column'
            );
         }

         async function restoreColumn(snap: ColumnSnapshot): Promise<void> {
            const projectId = store.projectId();
            const { tableId, column: col } = snap;
            if (!projectId || !store.tables().some((t) => t.id === tableId)) return;
            const created = await runSave(() =>
               firstValueFrom(
                  columnsApi.create(tableId, {
                     name: col.name,
                     dataType: col.dataType,
                     isPrimaryKey: col.isPrimaryKey,
                     isNullable: col.isNullable,
                     isUnique: col.isUnique,
                     isAutoIncrement: col.isAutoIncrement,
                     isUnsigned: col.isUnsigned,
                     defaultValue: col.defaultValue,
                  })
               )
            );
            let restored = created;
            if (col.note) {
               restored = { ...created, note: col.note };
               void runSave(() => firstValueFrom(columnsApi.update(created.id, { note: col.note })));
            }
            aliasTo(col.id, created.id);
            let order: string[] = [];
            mapTable(tableId, (t) => {
               const columns = [...t.columns];
               const at = snap.index < 0 ? columns.length : Math.min(snap.index, columns.length);
               columns.splice(at, 0, restored);
               order = columns.map((c) => c.id);
               return { ...t, columns };
            });
            if (snap.index >= 0 && order[order.length - 1] !== created.id) {
               await runSave(() => firstValueFrom(columnsApi.reorder(tableId, { orderedColumnIds: order })));
            }
            for (const rel of snap.relationships) {
               const sourceColumnId = rid(rel.sourceColumnId);
               const targetColumnId = rid(rel.targetColumnId);
               const exists =
                  store.tables().some((t) => t.columns.some((c) => c.id === sourceColumnId)) &&
                  store.tables().some((t) => t.columns.some((c) => c.id === targetColumnId));
               if (!exists) continue;
               let rc = await runSave(() =>
                  firstValueFrom(
                     relationshipsApi.create(projectId, {
                        sourceColumnId,
                        targetColumnId,
                        type: rel.type,
                        onDelete: rel.onDelete,
                        onUpdate: rel.onUpdate,
                        sourceSide: rel.sourceSide,
                        targetSide: rel.targetSide,
                        autoRoute: rel.autoRoute,
                     })
                  )
               );
               if (rel.waypoints?.length) {
                  const waypoints = rel.waypoints.map((w) => ({ ...w }));
                  rc = await runSave(() => firstValueFrom(relationshipsApi.update(rc.id, { waypoints })));
               }
               setSchema((s) => ({ ...s, relationships: [...s.relationships, rc] }));
            }
         }

         return {
            async addTable(x: number, y: number): Promise<void> {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               const name = uniqueTableName(store.tables());
               const color = TABLE_PALETTE[store.tables().length % TABLE_PALETTE.length];
               // Optimistic (P3.2): the table shows at once under a client id.
               const dto: CreateTableDto = { id: crypto.randomUUID(), name, x, y, color, slideId: shownSlideAt(x, y) };
               const id = dto.id!;
               const local = { ...dto, id, columns: [], indexes: [] } as TableModel;
               createOptimistic({
                  id,
                  queueKey: `table:${id}`,
                  section: 'tables',
                  insert: () => setSchema((s) => ({ ...s, tables: [...s.tables, local] })),
                  remove: () => {
                     setSchema((s) => ({ ...s, tables: s.tables.filter((tb) => tb.id !== id) }));
                     patchState(store, { selectedTableIds: store.selectedTableIds().filter((x) => x !== id) });
                  },
                  persist: () => firstValueFrom(tablesApi.create(projectId, dto)),
                  // Keep columns/indexes added locally since; the server copy has none yet.
                  reconcile: (created) =>
                     mapTable(id, (tb) => ({ ...created, columns: tb.columns, indexes: tb.indexes })),
                  what: 'add the table',
               });
               patchState(store, { selectedTableIds: [id], selectedRelationshipIds: [] });
            },

            /** Optimistic local move; the position PATCH is debounced per table. */
            moveTable(tableId: string, x: number, y: number): void {
               stage('tables', tableId, { x, y });
               mapTable(tableId, (t) => ({ ...t, x, y }));
            },

            /** Live (local-only) scale while dragging a corner; persist via updateTable. */
            setTableScaleLocal(tableId: string, scale: number | undefined): void {
               mapTable(tableId, (t) => ({ ...t, scale }));
            },

            async updateTable(tableId: string, patch: UpdateTableDto): Promise<void> {
               patchTableLocal(tableId, patch);
            },

            async deleteTable(tableId: string): Promise<void> {
               flushTimers(`pos:${tableId}`, `patch:table:${tableId}`);
               await optimistic(
                  `table:${tableId}`,
                  () => {
                     setSchema((s) => ({ ...s, tables: s.tables.filter((t) => t.id !== tableId) }));
                     patchState(store, {
                        selectedTableIds: store.selectedTableIds().filter((id) => id !== tableId),
                     });
                  },
                  () => firstValueFrom(tablesApi.remove(tableId)),
                  'delete the table'
               );
            },

            /** Duplicate a table (offset copy) with all its columns; selects the copy. */
            async duplicateTable(
               tableId: string,
               dx = 40,
               dy = 40,
               select = true,
               waitForColumns = true,
               columnMap?: Map<string, string>
            ): Promise<string | null> {
               const projectId = store.projectId();
               const source = store.tables().find((t) => t.id === tableId);
               if (!projectId || !source) {
                  return null;
               }
               const created = await runSave(() =>
                  firstValueFrom(
                     tablesApi.create(projectId, {
                        name: source.name,
                        x: source.x + dx,
                        y: source.y + dy,
                        color: source.color ?? undefined,
                        slideId: source.slideId,
                        morphId: source.morphId,
                     })
                  )
               );
               // Show the copy as soon as the table exists; columns stream in after, so
               // an Alt-drag can grab it immediately instead of waiting on N round trips.
               setSchema((s) => ({ ...s, tables: [...s.tables, created] }));
               if (source.scale && source.scale !== 1) {
                  mapTable(created.id, (t) => ({ ...t, scale: source.scale }));
                  void tablesApi.update(created.id, { scale: source.scale }).subscribe();
               }
               if (select) {
                  patchState(store, {
                     selectedTableIds: [created.id],
                     selectedRelationshipIds: [],
                     selectedElementIds: [],
                  });
               }
               const fillColumns = (async () => {
                  for (const col of source.columns) {
                     const newCol = await firstValueFrom(
                        columnsApi.create(created.id, {
                           name: col.name,
                           dataType: col.dataType,
                           isPrimaryKey: col.isPrimaryKey,
                           isNullable: col.isNullable,
                           isUnique: col.isUnique,
                           isAutoIncrement: col.isAutoIncrement,
                        })
                     );
                     columnMap?.set(col.id, newCol.id);
                     mapTable(created.id, (t) => ({ ...t, columns: [...t.columns, newCol] }));
                  }
               })();
               if (waitForColumns) {
                  await fillColumns;
               } else {
                  void fillColumns;
               }
               return created.id;
            },

            /** Record a finished table scale gesture (scale + position, already applied). */
            recordTableScale(changes: { id: string; before: TableGeometry; after: TableGeometry }[]): void {
               const moved = changes.filter(
                  (c) => c.before.scale !== c.after.scale || c.before.x !== c.after.x || c.before.y !== c.after.y
               );
               if (!moved.length) return;
               const apply = (which: 'before' | 'after'): void => {
                  for (const c of moved) {
                     const g = c[which];
                     if (store.tables().some((t) => t.id === c.id)) {
                        patchTableLocal(c.id, { scale: g.scale });
                        this.moveTable(c.id, g.x, g.y);
                     }
                  }
               };
               pushHistory({ undo: () => apply('before'), redo: () => apply('after') });
            },

            async addColumn(tableId: string, dto: CreateColumnDto): Promise<void> {
               // Optimistic (P3.2): the column shows at once under a client id.
               const body: CreateColumnDto = { ...dto, id: dto.id ?? crypto.randomUUID() };
               const created = {
                  isPrimaryKey: false,
                  isNullable: true,
                  isUnique: false,
                  isAutoIncrement: false,
                  ...body,
               } as ColumnModel;
               const id = created.id;
               const withoutColumn = (): void =>
                  mapTable(tableId, (t) => ({ ...t, columns: t.columns.filter((c) => c.id !== id) }));
               createOptimistic({
                  id,
                  queueKey: `table:${tableId}`,
                  insert: () => mapTable(tableId, (t) => ({ ...t, columns: [...t.columns, created] })),
                  remove: withoutColumn,
                  persist: () => firstValueFrom(columnsApi.create(tableId, body)),
                  reconcile: (saved) =>
                     mapTable(tableId, (t) => ({ ...t, columns: t.columns.map((c) => (c.id === id ? saved : c)) })),
                  what: 'add the column',
               });
               const snap: ColumnSnapshot = { tableId, column: created, index: -1, relationships: [] };
               pushHistory({
                  undo: async () => {
                     const s = captureColumn(tableId, rid(created.id));
                     if (s) Object.assign(snap, s, { column: { ...s.column, id: created.id } });
                     await removeColumnRaw(tableId, rid(created.id));
                  },
                  redo: () => restoreColumn(snap),
               });
            },

            async updateColumn(tableId: string, columnId: string, patch: UpdateColumnDto): Promise<void> {
               commitPatch(
                  `patch:col:${columnId}`,
                  `table:${tableId}`,
                  tableId,
                  patch,
                  (p) => firstValueFrom(columnsApi.update(columnId, p)),
                  'save the column'
               );
               mapTable(tableId, (t) => ({
                  ...t,
                  columns: t.columns.map((c) => (c.id === columnId ? { ...c, ...(patch as Partial<ColumnModel>) } : c)),
               }));
            },

            async deleteColumn(tableId: string, columnId: string): Promise<void> {
               const snap = captureColumn(tableId, columnId);
               await removeColumnRaw(tableId, columnId);
               if (
                  !snap ||
                  store
                     .tables()
                     .find((t) => t.id === tableId)
                     ?.columns.some((c) => c.id === columnId)
               ) {
                  return; // rolled back
               }
               pushHistory({
                  undo: () => restoreColumn(snap),
                  redo: async () => {
                     const s = captureColumn(tableId, rid(columnId));
                     if (s) Object.assign(snap, s, { column: { ...s.column, id: columnId } });
                     await removeColumnRaw(tableId, rid(columnId));
                  },
               });
            },

            /** Reorder columns optimistically; persist the new order (debounced). */
            reorderColumns(tableId: string, orderedColumnIds: string[]): void {
               mapTable(tableId, (t) => {
                  const byId = new Map(t.columns.map((c) => [c.id, c]));
                  const columns = orderedColumnIds
                     .map((id) => byId.get(id))
                     .filter((c): c is ColumnModel => Boolean(c));
                  return { ...t, columns };
               });
               debounce(`reorder:${tableId}`, () => {
                  void runSave(() => firstValueFrom(columnsApi.reorder(tableId, { orderedColumnIds })));
               });
            },

            async addIndex(tableId: string, dto: CreateIndexDto): Promise<void> {
               // Optimistic (P3.2): the index shows at once under a client id.
               const body: CreateIndexDto = { ...dto, id: dto.id ?? crypto.randomUUID() };
               const created = { isUnique: false, ...body } as IndexModel;
               const id = created.id;
               const mapIndexes = (fn: (list: IndexModel[]) => IndexModel[]): void =>
                  mapTable(tableId, (t) => ({ ...t, indexes: fn(t.indexes ?? []) }));
               createOptimistic({
                  id,
                  queueKey: `table:${tableId}`,
                  insert: () => mapIndexes((list) => [...list, created]),
                  remove: () => mapIndexes((list) => list.filter((i) => i.id !== id)),
                  persist: () => firstValueFrom(indexesApi.create(tableId, body)),
                  reconcile: (saved) => mapIndexes((list) => list.map((i) => (i.id === id ? saved : i))),
                  what: 'add the index',
               });
            },

            async updateIndex(tableId: string, indexId: string, patch: UpdateIndexDto): Promise<void> {
               commitPatch(
                  `patch:index:${indexId}`,
                  `table:${tableId}`,
                  tableId,
                  patch,
                  (p) => firstValueFrom(indexesApi.update(indexId, p)),
                  'save the index'
               );
               mapTable(tableId, (t) => ({
                  ...t,
                  indexes: (t.indexes ?? []).map((i) => (i.id === indexId ? ({ ...i, ...patch } as typeof i) : i)),
               }));
            },

            async deleteIndex(tableId: string, indexId: string): Promise<void> {
               flushTimers(`patch:index:${indexId}`);
               await optimistic(
                  `table:${tableId}`,
                  () =>
                     mapTable(tableId, (t) => ({
                        ...t,
                        indexes: (t.indexes ?? []).filter((i) => i.id !== indexId),
                     })),
                  () => firstValueFrom(indexesApi.remove(indexId)),
                  'delete the index'
               );
            },
         };
      })
   );
}
