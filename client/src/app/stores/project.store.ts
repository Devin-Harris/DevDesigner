import { computed, inject } from '@angular/core';
import type {
  AccessLevel,
  ColumnModel,
  CreateColumnDto,
  PointModel,
  RelationshipModel,
  RelationshipType,
  SchemaModel,
  SchemaMutation,
  TableModel,
  UpdateColumnDto,
  UpdateRelationshipDto,
  UpdateTableDto,
  ViewportModel,
} from '@dbdesigner/shared';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { ColumnsService } from '../core/services/columns.service';
import { ProjectsService } from '../core/services/projects.service';
import { RelationshipsService } from '../core/services/relationships.service';
import { TablesService } from '../core/services/tables.service';
import { ShareLinksService } from '../core/services/share-links.service';
import { ShareSessionService } from '../core/services/share-session.service';

/**
 * Editor store: the single source of truth for the loaded project's schema,
 * viewport, selection, access mode, and save status (BUILD_INSTRUCTIONS.md
 * section 8.4). Every edit goes through a method that calls the matching
 * granular endpoint and updates local state optimistically; high-frequency
 * changes (drag, pan/zoom, reorder) are debounced and coalesced per entity.
 */
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface EditorState {
  projectId: string | null;
  schema: SchemaModel | null;
  accessMode: AccessLevel;
  /** True when the project was opened via a /shared/:token link (anonymous mode). */
  shared: boolean;
  selectedTableIds: string[];
  selectedRelationshipIds: string[];
  loading: boolean;
  error: string | null;
  saveStatus: SaveStatus;
}

const DEFAULT_VIEWPORT: ViewportModel = { x: 0, y: 0, zoom: 1 };

/** Header colors assigned round-robin to new tables so the canvas reads clearly. */
const TABLE_PALETTE = [
  '#e5484d',
  '#f5a623',
  '#12b76a',
  '#0ea5e9',
  '#2f6bff',
  '#7c5cff',
  '#ec4899',
  '#64748b',
];

const initialState: EditorState = {
  projectId: null,
  schema: null,
  accessMode: 'VIEW',
  shared: false,
  selectedTableIds: [],
  selectedRelationshipIds: [],
  loading: false,
  error: null,
  saveStatus: 'idle',
};

function messageOf(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return 'Something went wrong.';
}

/** Generate a unique default table name like table_1, table_2, ... */
function uniqueTableName(tables: readonly TableModel[]): string {
  const names = new Set(tables.map((t) => t.name));
  let i = tables.length + 1;
  let name = `table_${i}`;
  while (names.has(name)) {
    i += 1;
    name = `table_${i}`;
  }
  return name;
}

export const ProjectStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ schema, selectedTableIds, selectedRelationshipIds, accessMode }) => ({
    tables: computed(() => schema()?.tables ?? []),
    relationships: computed(() => schema()?.relationships ?? []),
    viewport: computed(() => schema()?.viewport ?? DEFAULT_VIEWPORT),
    /** The single selected table (only when exactly one is selected), for the inspector. */
    selectedTable: computed(() => {
      const ids = selectedTableIds();
      return ids.length === 1 ? (schema()?.tables.find((t) => t.id === ids[0]) ?? null) : null;
    }),
    selectedRelationship: computed(() => {
      const ids = selectedRelationshipIds();
      return ids.length === 1
        ? (schema()?.relationships.find((r) => r.id === ids[0]) ?? null)
        : null;
    }),
    canEdit: computed(() => accessMode() !== 'VIEW'),
  })),
  withMethods(
    (
      store,
      projectsApi = inject(ProjectsService),
      tablesApi = inject(TablesService),
      columnsApi = inject(ColumnsService),
      relationshipsApi = inject(RelationshipsService),
      shareLinksApi = inject(ShareLinksService),
      shareSession = inject(ShareSessionService),
    ) => {
      const timers = new Map<string, ReturnType<typeof setTimeout>>();

      function setSchema(updater: (schema: SchemaModel) => SchemaModel): void {
        const current = store.schema();
        if (current) {
          patchState(store, { schema: updater(current) });
        }
      }

      function mapTable(tableId: string, fn: (table: TableModel) => TableModel): void {
        setSchema((s) => ({
          ...s,
          tables: s.tables.map((t) => (t.id === tableId ? fn(t) : t)),
        }));
      }

      async function runSave<T>(action: () => Promise<T>): Promise<T> {
        patchState(store, { saveStatus: 'saving' });
        try {
          const result = await action();
          patchState(store, { saveStatus: 'saved' });
          return result;
        } catch (err) {
          patchState(store, { saveStatus: 'error' });
          throw err;
        }
      }

      function debounce(key: string, fn: () => void, ms = 500): void {
        const existing = timers.get(key);
        if (existing) {
          clearTimeout(existing);
        }
        timers.set(
          key,
          setTimeout(() => {
            timers.delete(key);
            fn();
          }, ms),
        );
      }

      return {
        async load(projectId: string): Promise<void> {
          // Owner/anonymous-open load: never carry a share token from a prior visit.
          shareSession.setToken(null);
          patchState(store, {
            loading: true,
            error: null,
            projectId,
            shared: false,
            selectedTableIds: [],
            selectedRelationshipIds: [],
          });
          try {
            const graph = await firstValueFrom(projectsApi.getGraph(projectId));
            patchState(store, {
              schema: graph.schema,
              accessMode: graph.accessLevel,
              loading: false,
            });
          } catch (err) {
            patchState(store, { loading: false, error: messageOf(err), schema: null });
          }
        },

        /** Open a project from a /shared/:token link (no account). */
        async loadShared(token: string): Promise<void> {
          shareSession.setToken(token);
          patchState(store, {
            loading: true,
            error: null,
            shared: true,
            projectId: null,
            selectedTableIds: [],
            selectedRelationshipIds: [],
          });
          try {
            const graph = await firstValueFrom(shareLinksApi.getShared(token));
            patchState(store, {
              projectId: graph.project.id,
              schema: graph.schema,
              accessMode: graph.accessLevel,
              loading: false,
            });
          } catch (err) {
            patchState(store, { loading: false, error: messageOf(err), schema: null });
          }
        },

        /**
         * Apply a schema change broadcast from another participant. Patches local
         * state only (the change is already persisted server-side) and never calls
         * an endpoint. Cascades that the DB performs (deleting a table removes its
         * columns and dependent relationships) are mirrored here.
         */
        applyRemote(mutation: SchemaMutation): void {
          switch (mutation.kind) {
            case 'table.created':
              setSchema((s) =>
                s.tables.some((t) => t.id === mutation.table.id)
                  ? s
                  : { ...s, tables: [...s.tables, mutation.table] },
              );
              break;
            case 'table.updated':
              mapTable(mutation.table.id, () => mutation.table);
              break;
            case 'table.moved':
              mapTable(mutation.tableId, (t) => ({ ...t, x: mutation.x, y: mutation.y }));
              break;
            case 'table.deleted':
              setSchema((s) => {
                const removed = s.tables.find((t) => t.id === mutation.tableId);
                const columnIds = new Set((removed?.columns ?? []).map((c) => c.id));
                return {
                  ...s,
                  tables: s.tables.filter((t) => t.id !== mutation.tableId),
                  relationships: s.relationships.filter(
                    (r) => !columnIds.has(r.sourceColumnId) && !columnIds.has(r.targetColumnId),
                  ),
                };
              });
              break;
            case 'column.created':
              mapTable(mutation.tableId, (t) =>
                t.columns.some((c) => c.id === mutation.column.id)
                  ? t
                  : { ...t, columns: [...t.columns, mutation.column] },
              );
              break;
            case 'column.updated':
              mapTable(mutation.tableId, (t) => ({
                ...t,
                columns: t.columns.map((c) => (c.id === mutation.column.id ? mutation.column : c)),
              }));
              break;
            case 'column.deleted':
              setSchema((s) => ({
                ...s,
                tables: s.tables.map((t) =>
                  t.id === mutation.tableId
                    ? { ...t, columns: t.columns.filter((c) => c.id !== mutation.columnId) }
                    : t,
                ),
                relationships: s.relationships.filter(
                  (r) =>
                    r.sourceColumnId !== mutation.columnId && r.targetColumnId !== mutation.columnId,
                ),
              }));
              break;
            case 'column.reordered':
              mapTable(mutation.tableId, (t) => {
                const byId = new Map(t.columns.map((c) => [c.id, c]));
                const columns = mutation.orderedColumnIds
                  .map((id) => byId.get(id))
                  .filter((c): c is ColumnModel => Boolean(c));
                return { ...t, columns };
              });
              break;
            case 'relationship.created':
              setSchema((s) =>
                s.relationships.some((r) => r.id === mutation.relationship.id)
                  ? s
                  : { ...s, relationships: [...s.relationships, mutation.relationship] },
              );
              break;
            case 'relationship.updated':
              setSchema((s) => ({
                ...s,
                relationships: s.relationships.map((r) =>
                  r.id === mutation.relationship.id ? mutation.relationship : r,
                ),
              }));
              break;
            case 'relationship.deleted':
              setSchema((s) => ({
                ...s,
                relationships: s.relationships.filter((r) => r.id !== mutation.relationshipId),
              }));
              break;
          }
        },

        /** Select a table. additive (ctrl/shift) toggles it within the current set. */
        selectTable(tableId: string, additive = false): void {
          if (!additive) {
            patchState(store, { selectedTableIds: [tableId], selectedRelationshipIds: [] });
            return;
          }
          const current = store.selectedTableIds();
          patchState(store, {
            selectedTableIds: current.includes(tableId)
              ? current.filter((id) => id !== tableId)
              : [...current, tableId],
          });
        },

        selectRelationship(relationshipId: string, additive = false): void {
          if (!additive) {
            patchState(store, { selectedRelationshipIds: [relationshipId], selectedTableIds: [] });
            return;
          }
          const current = store.selectedRelationshipIds();
          patchState(store, {
            selectedRelationshipIds: current.includes(relationshipId)
              ? current.filter((id) => id !== relationshipId)
              : [...current, relationshipId],
          });
        },

        setSelection(tableIds: string[], relationshipIds: string[]): void {
          patchState(store, {
            selectedTableIds: tableIds,
            selectedRelationshipIds: relationshipIds,
          });
        },

        clearSelection(): void {
          patchState(store, { selectedTableIds: [], selectedRelationshipIds: [] });
        },

        async addTable(x: number, y: number): Promise<void> {
          const projectId = store.projectId();
          if (!projectId) {
            return;
          }
          const name = uniqueTableName(store.tables());
          const color = TABLE_PALETTE[store.tables().length % TABLE_PALETTE.length];
          const created = await runSave(() =>
            firstValueFrom(tablesApi.create(projectId, { name, x, y, color })),
          );
          setSchema((s) => ({ ...s, tables: [...s.tables, created] }));
          patchState(store, { selectedTableIds: [created.id], selectedRelationshipIds: [] });
        },

        /** Optimistic local move; the position PATCH is debounced per table. */
        moveTable(tableId: string, x: number, y: number): void {
          mapTable(tableId, (t) => ({ ...t, x, y }));
          debounce(`pos:${tableId}`, () => {
            void runSave(() => firstValueFrom(tablesApi.updatePosition(tableId, { x, y })));
          });
        },

        async updateTable(tableId: string, patch: UpdateTableDto): Promise<void> {
          const updated = await runSave(() => firstValueFrom(tablesApi.update(tableId, patch)));
          mapTable(tableId, () => updated);
        },

        async deleteTable(tableId: string): Promise<void> {
          await runSave(() => firstValueFrom(tablesApi.remove(tableId)));
          setSchema((s) => ({ ...s, tables: s.tables.filter((t) => t.id !== tableId) }));
          patchState(store, {
            selectedTableIds: store.selectedTableIds().filter((id) => id !== tableId),
          });
        },

        async addColumn(tableId: string, dto: CreateColumnDto): Promise<void> {
          const created = await runSave(() => firstValueFrom(columnsApi.create(tableId, dto)));
          mapTable(tableId, (t) => ({ ...t, columns: [...t.columns, created] }));
        },

        async updateColumn(
          tableId: string,
          columnId: string,
          patch: UpdateColumnDto,
        ): Promise<void> {
          const updated = await runSave(() => firstValueFrom(columnsApi.update(columnId, patch)));
          mapTable(tableId, (t) => ({
            ...t,
            columns: t.columns.map((c) => (c.id === columnId ? updated : c)),
          }));
        },

        async deleteColumn(tableId: string, columnId: string): Promise<void> {
          await runSave(() => firstValueFrom(columnsApi.remove(columnId)));
          mapTable(tableId, (t) => ({
            ...t,
            columns: t.columns.filter((c) => c.id !== columnId),
          }));
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

        /** Optimistic local viewport; the viewport PATCH is debounced. */
        setViewport(x: number, y: number, zoom: number): void {
          setSchema((s) => ({ ...s, viewport: { x, y, zoom } }));
          const projectId = store.projectId();
          if (!projectId) {
            return;
          }
          debounce('viewport', () => {
            void runSave(() =>
              firstValueFrom(
                projectsApi.updateViewport(projectId, { viewportX: x, viewportY: y, zoom }),
              ),
            );
          });
        },

        async addRelationship(
          sourceColumnId: string,
          targetColumnId: string,
          type: RelationshipType = 'ONE_TO_MANY',
        ): Promise<void> {
          const projectId = store.projectId();
          if (!projectId) {
            return;
          }
          const created = await runSave(() =>
            firstValueFrom(
              relationshipsApi.create(projectId, { sourceColumnId, targetColumnId, type }),
            ),
          );
          setSchema((s) => ({ ...s, relationships: [...s.relationships, created] }));
          patchState(store, { selectedRelationshipIds: [created.id], selectedTableIds: [] });
        },

        async updateRelationship(id: string, patch: UpdateRelationshipDto): Promise<void> {
          const updated = await runSave(() => firstValueFrom(relationshipsApi.update(id, patch)));
          setSchema((s) => ({
            ...s,
            relationships: s.relationships.map((r: RelationshipModel) =>
              r.id === id ? updated : r,
            ),
          }));
        },

        /** Optimistic local routing; the waypoints PATCH is debounced per relationship. */
        setWaypoints(id: string, waypoints: PointModel[]): void {
          setSchema((s) => ({
            ...s,
            relationships: s.relationships.map((r: RelationshipModel) =>
              r.id === id ? { ...r, waypoints } : r,
            ),
          }));
          debounce(`wp:${id}`, () => {
            void runSave(() => firstValueFrom(relationshipsApi.update(id, { waypoints })));
          });
        },

        async deleteRelationship(id: string): Promise<void> {
          await runSave(() => firstValueFrom(relationshipsApi.remove(id)));
          setSchema((s) => ({
            ...s,
            relationships: s.relationships.filter((r: RelationshipModel) => r.id !== id),
          }));
          patchState(store, {
            selectedRelationshipIds: store.selectedRelationshipIds().filter((rid) => rid !== id),
          });
        },
      };
    },
  ),
);
