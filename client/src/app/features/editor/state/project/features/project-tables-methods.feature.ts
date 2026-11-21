import { patchState, signalStoreFeature, type, withMethods } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import {
   type ColumnModel,
   type CreateColumnDto,
   type CreateIndexDto,
   type CreateTableDto,
   type IndexModel,
   type PointModel,
   type RelationshipModel,
   type TableModel,
   type UpdateColumnDto,
   type UpdateIndexDto,
   type UpdateTableDto,
} from '@devdesigner/shared';
import type { ColumnSnapshot, TableGeometry } from '../models/project-state.model';
import { TABLE_PALETTE, uniqueTableName } from '../helpers/table-defaults.helper';
import { applyItemMoves } from '../helpers/item-moves.helper';
import type { SlidePlacement } from './project-slides-methods.feature';
import type { ProjectInternalsWith } from './project-internals';

/** A deleted table with what goes with it, for undo. */
interface TableSnapshot {
   table: TableModel;
   relationships: RelationshipModel[];
}

/** The fields of `row` that `patch` changes, as they are now (what undo puts back). */
function fieldsBefore<T extends object>(row: T, patch: object): Partial<T> {
   const out: Record<string, unknown> = {};
   for (const k of Object.keys(patch)) out[k] = (row as Record<string, unknown>)[k] ?? null;
   return out as Partial<T>;
}

/** ERD tables, their columns and indexes, with undo (re-created rows keep their ids; see `rid`). */
export function withProjectTablesMethods() {
   return signalStoreFeature(
      type<ProjectInternalsWith<{ _placement: SlidePlacement }>>(),
      withMethods((store) => {
         const { setSchema, mapTable } = store._schema;
         const { debounce, flushTimers, runSave, optimistic, createOptimistic, stage, patchTableLocal } = store._queue;
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

         // ---- Table undo/redo ----
         function captureTable(tableId: string): TableSnapshot | null {
            const table = store.tables().find((t) => t.id === tableId);
            if (!table) return null;
            const cols = new Set(table.columns.map((c) => c.id));
            const relationships = (store.schema()?.relationships ?? []).filter(
               (r) => cols.has(r.sourceColumnId) || cols.has(r.targetColumnId)
            );
            return { table: structuredClone(table), relationships: structuredClone(relationships) };
         }

         async function removeTableRaw(tableId: string): Promise<void> {
            flushTimers(`pos:${tableId}`, `patch:table:${tableId}`);
            await optimistic(
               `table:${tableId}`,
               () => {
                  setSchema((s) => {
                     const cols = new Set(s.tables.find((t) => t.id === tableId)?.columns.map((c) => c.id) ?? []);
                     return {
                        ...s,
                        tables: s.tables.filter((t) => t.id !== tableId),
                        // The server cascades the table's relationships; mirror that locally.
                        relationships: s.relationships.filter(
                           (r) => !cols.has(r.sourceColumnId) && !cols.has(r.targetColumnId)
                        ),
                     };
                  });
                  patchState(store, {
                     selectedTableIds: store.selectedTableIds().filter((id) => id !== tableId),
                  });
               },
               () => firstValueFrom(tablesApi.remove(tableId)),
               'delete the table'
            );
         }

         /** Re-create a deleted table under its own ids: columns, indexes, then its relationships. */
         async function restoreTable(snap: TableSnapshot): Promise<void> {
            const projectId = store.projectId();
            const t = snap.table;
            const id = rid(t.id);
            if (!projectId || store.tables().some((x) => x.id === id)) return;
            await runSave(() =>
               firstValueFrom(
                  tablesApi.create(projectId, {
                     id,
                     name: t.name,
                     x: t.x,
                     y: t.y,
                     color: t.color,
                     slideId: t.slideId ? rid(t.slideId) : undefined,
                     morphId: t.morphId,
                  })
               )
            );
            const columns: ColumnModel[] = [];
            for (const c of t.columns) {
               const saved = await runSave(() =>
                  firstValueFrom(
                     columnsApi.create(id, {
                        id: rid(c.id),
                        name: c.name,
                        dataType: c.dataType,
                        isPrimaryKey: c.isPrimaryKey,
                        isNullable: c.isNullable,
                        isUnique: c.isUnique,
                        isAutoIncrement: c.isAutoIncrement,
                        isUnsigned: c.isUnsigned,
                        defaultValue: c.defaultValue,
                     })
                  )
               );
               if (c.note) void runSave(() => firstValueFrom(columnsApi.update(saved.id, { note: c.note })));
               columns.push({ ...saved, note: c.note });
            }
            const indexes: IndexModel[] = [];
            for (const ix of t.indexes ?? []) {
               indexes.push(
                  await runSave(() =>
                     firstValueFrom(
                        indexesApi.create(id, {
                           id: rid(ix.id),
                           name: ix.name,
                           columnIds: ix.columnIds.map(rid),
                           isUnique: ix.isUnique,
                        })
                     )
                  )
               );
            }
            setSchema((s) => ({ ...s, tables: [...s.tables, { ...t, id, columns, indexes }] }));
            const extra: UpdateTableDto = {};
            if (t.note) extra.note = t.note;
            if (t.scale) extra.scale = t.scale;
            if (t.groupId) extra.groupId = t.groupId;
            if (Object.keys(extra).length) patchTableLocal(id, extra);
            const has = (cid: string): boolean => store.tables().some((x) => x.columns.some((c) => c.id === cid));
            for (const rel of snap.relationships) {
               const sourceColumnId = rid(rel.sourceColumnId);
               const targetColumnId = rid(rel.targetColumnId);
               if (!has(sourceColumnId) || !has(targetColumnId)) continue;
               if (store.relationships().some((r) => r.id === rid(rel.id))) continue;
               let rc = await runSave(() =>
                  firstValueFrom(
                     relationshipsApi.create(projectId, {
                        id: rid(rel.id),
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

         function captureIndex(tableId: string, indexId: string): IndexModel | null {
            const ix = store.tables().find((t) => t.id === tableId)?.indexes?.find((i) => i.id === indexId);
            return ix ? { ...ix, columnIds: [...ix.columnIds] } : null;
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
               // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- a partial row completed from its DTO / patch (the model type is the intent)
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
               let snap: TableSnapshot = { table: local, relationships: [] };
               pushHistory({
                  undo: async () => {
                     snap = captureTable(rid(id)) ?? snap;
                     await removeTableRaw(rid(id));
                  },
                  redo: () => restoreTable(snap),
               });
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
               const current = store.tables().find((t) => t.id === tableId);
               patchTableLocal(tableId, patch);
               if (current) {
                  const prev = fieldsBefore(current, patch) as UpdateTableDto;
                  pushHistory({
                     undo: () => patchTableLocal(rid(tableId), prev),
                     redo: () => patchTableLocal(rid(tableId), patch),
                  });
               }
            },

            /** Persist a table change that is recorded some other way (no undo step of its own). */
            updateTableSilently(tableId: string, patch: UpdateTableDto): void {
               patchTableLocal(tableId, patch);
            },

            /** Record a finished table drag (tables and the relationship bends that moved with them). */
            recordTableDrag(
               tables: { id: string; from: PointModel; to: PointModel }[],
               waypoints: { id: string; from: PointModel[]; to: PointModel[] }[] = []
            ): void {
               if (!tables.length && !waypoints.length) return;
               const apply = (which: 'from' | 'to'): void => {
                  const moves = {
                     tables: new Map(tables.map((m) => [rid(m.id), m[which]] as const)),
                     waypoints: new Map(waypoints.map((w) => [rid(w.id), w[which]] as const)),
                  };
                  for (const [id, p] of moves.tables) stage('tables', id, { x: p.x, y: p.y });
                  for (const [id, wp] of moves.waypoints) stage('relationships', id, { waypoints: wp });
                  setSchema((s) => applyItemMoves(s, moves));
               };
               pushHistory({ undo: () => apply('from'), redo: () => apply('to') });
            },

            async deleteTable(tableId: string): Promise<void> {
               const snap = captureTable(tableId);
               await removeTableRaw(tableId);
               if (!snap || store.tables().some((t) => t.id === tableId)) return; // rolled back
               pushHistory({
                  undo: () => restoreTable(snap),
                  redo: async () => {
                     const now = captureTable(rid(tableId));
                     if (now) Object.assign(snap, now);
                     await removeTableRaw(rid(tableId));
                  },
               });
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
               // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- a partial row completed from its DTO / patch (the model type is the intent)
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
                  section: 'columns',
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
               const current = store.tables().find((t) => t.id === tableId)?.columns.find((c) => c.id === columnId);
               this.updateColumnRaw(tableId, columnId, patch);
               if (current) {
                  const prev = fieldsBefore(current, patch) as UpdateColumnDto;
                  pushHistory({
                     undo: () => this.updateColumnRaw(rid(tableId), rid(columnId), prev),
                     redo: () => this.updateColumnRaw(rid(tableId), rid(columnId), patch),
                  });
               }
            },

            /** Apply a column edit without recording it (undo/redo use this). */
            updateColumnRaw(tableId: string, columnId: string, patch: UpdateColumnDto): void {
               // Batched with every other staged edit (P3.6) instead of a per-column PATCH.
               stage('columns', columnId, patch, 300, tableId);
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
               const prev = store.tables().find((t) => t.id === tableId)?.columns.map((c) => c.id);
               this.reorderColumnsRaw(tableId, orderedColumnIds);
               if (prev && prev.join() !== orderedColumnIds.join()) {
                  pushHistory({
                     undo: () => this.reorderColumnsRaw(rid(tableId), prev.map(rid)),
                     redo: () => this.reorderColumnsRaw(rid(tableId), orderedColumnIds.map(rid)),
                  });
               }
            },

            /** Reorder without recording it (undo/redo use this). */
            reorderColumnsRaw(tableId: string, orderedColumnIds: string[]): void {
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
               // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- a partial row completed from its DTO / patch (the model type is the intent)
               const created = { isUnique: false, ...body } as IndexModel;
               const id = created.id;
               const mapIndexes = (fn: (list: IndexModel[]) => IndexModel[]): void =>
                  mapTable(tableId, (t) => ({ ...t, indexes: fn(t.indexes ?? []) }));
               createOptimistic({
                  id,
                  queueKey: `table:${tableId}`,
                  section: 'indexes',
                  insert: () => mapIndexes((list) => [...list, created]),
                  remove: () => mapIndexes((list) => list.filter((i) => i.id !== id)),
                  persist: () => firstValueFrom(indexesApi.create(tableId, body)),
                  reconcile: (saved) => mapIndexes((list) => list.map((i) => (i.id === id ? saved : i))),
                  what: 'add the index',
               });
               let snap: IndexModel = created;
               pushHistory({
                  undo: async () => {
                     snap = captureIndex(rid(tableId), rid(id)) ?? snap;
                     await this.deleteIndexRaw(rid(tableId), rid(id));
                  },
                  redo: () => this.restoreIndex(rid(tableId), snap),
               });
            },

            /** Re-create an index under its own id (undo of a delete). */
            async restoreIndex(tableId: string, ix: IndexModel): Promise<void> {
               if (!store.tables().some((t) => t.id === tableId)) return;
               const saved = await runSave(() =>
                  firstValueFrom(
                     indexesApi.create(tableId, {
                        id: rid(ix.id),
                        name: ix.name,
                        columnIds: ix.columnIds.map(rid),
                        isUnique: ix.isUnique,
                     })
                  )
               );
               mapTable(tableId, (t) => ({ ...t, indexes: [...(t.indexes ?? []), saved] }));
            },

            async updateIndex(tableId: string, indexId: string, patch: UpdateIndexDto): Promise<void> {
               const current = captureIndex(tableId, indexId);
               this.updateIndexRaw(tableId, indexId, patch);
               if (current) {
                  const prev = fieldsBefore(current, patch) as UpdateIndexDto;
                  pushHistory({
                     undo: () => this.updateIndexRaw(rid(tableId), rid(indexId), prev),
                     redo: () => this.updateIndexRaw(rid(tableId), rid(indexId), patch),
                  });
               }
            },

            /** Apply an index edit without recording it (undo/redo use this). */
            updateIndexRaw(tableId: string, indexId: string, patch: UpdateIndexDto): void {
               stage('indexes', indexId, patch, 300, tableId);
               mapTable(tableId, (t) => ({
                  ...t,
                  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- a partial row completed from its DTO / patch (the model type is the intent)
                  indexes: (t.indexes ?? []).map((i) => (i.id === indexId ? ({ ...i, ...patch } as typeof i) : i)),
               }));
            },

            async deleteIndex(tableId: string, indexId: string): Promise<void> {
               const snap = captureIndex(tableId, indexId);
               await this.deleteIndexRaw(tableId, indexId);
               if (!snap || captureIndex(tableId, indexId)) return; // rolled back
               pushHistory({
                  undo: () => this.restoreIndex(rid(tableId), snap),
                  redo: () => this.deleteIndexRaw(rid(tableId), rid(indexId)),
               });
            },

            /** Delete without recording it (undo/redo use this). */
            async deleteIndexRaw(tableId: string, indexId: string): Promise<void> {
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
