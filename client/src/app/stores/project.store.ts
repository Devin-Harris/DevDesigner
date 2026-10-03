import { computed, inject } from '@angular/core';
import type {
  AccessLevel,
  CanvasElementModel,
  ColumnModel,
  CreateColumnDto,
  CreateElementDto,
  CreateIndexDto,
  IndexModel,
  PointModel,
  RelationshipModel,
  RelationshipType,
  SchemaModel,
  SchemaMutation,
  TableModel,
  UpdateColumnDto,
  UpdateElementDto,
  UpdateIndexDto,
  UpdateRelationshipDto,
  UpdateTableDto,
  ViewportModel,
} from '@dbdesigner/shared';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { ColumnsService } from '../core/services/columns.service';
import { IndexesService } from '../core/services/indexes.service';
import { ElementsService } from '../core/services/elements.service';
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
  selectedElementIds: string[];
  loading: boolean;
  error: string | null;
  saveStatus: SaveStatus;
  /** Depth of the element undo/redo stacks, for toolbar button enablement. */
  undoDepth: number;
  redoDepth: number;
  /** Style applied to newly drawn elements; updated as the user restyles (session-sticky). */
  elementStyle: ElementStyleState;
}

/** Sticky drawing style carried across new elements in a session. */
interface ElementStyleState {
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle: CanvasElementModel['fillStyle'];
  strokeWidth: number;
  strokeStyle: CanvasElementModel['strokeStyle'];
  opacity: number;
  fontFamily: string;
  fontSize: number;
  cornerRadius?: number;
  startArrowhead?: CanvasElementModel['startArrowhead'];
  endArrowhead?: CanvasElementModel['endArrowhead'];
}

/** A reversible element operation: closures that reuse the granular store methods. */
interface HistoryEntry {
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
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
  selectedElementIds: [],
  loading: false,
  error: null,
  saveStatus: 'idle',
  undoDepth: 0,
  redoDepth: 0,
  elementStyle: {
    fillStyle: 'none',
    strokeWidth: 2,
    strokeStyle: 'solid',
    opacity: 100,
    fontFamily: 'hand',
    fontSize: 20,
  },
};

/** Build a create DTO from an existing element (for undo/redo re-creation). */
function elementToCreateDto(e: CanvasElementModel): CreateElementDto {
  return {
    type: e.type,
    x: e.x,
    y: e.y,
    width: e.width,
    height: e.height,
    angle: e.angle,
    strokeColor: e.strokeColor,
    backgroundColor: e.backgroundColor,
    fillStyle: e.fillStyle,
    strokeWidth: e.strokeWidth,
    strokeStyle: e.strokeStyle,
    opacity: e.opacity,
    zIndex: e.zIndex,
    points: e.points,
    text: e.text,
    fontSize: e.fontSize,
    fontFamily: e.fontFamily,
    textAlign: e.textAlign,
    startBinding: e.startBinding,
    endBinding: e.endBinding,
  };
}

function messageOf(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return 'Something went wrong.';
}

/**
 * Drop any line/arrow bindings that point at a now-deleted target (a table or
 * element), so a bound endpoint reverts to its stored point instead of dangling.
 * Mirrors the server-side integrity rule so remote peers converge identically.
 */
function clearBindingsTo(
  elements: readonly CanvasElementModel[],
  targetId: string,
): CanvasElementModel[] {
  return elements.map((e) => {
    const startHit = e.startBinding?.targetId === targetId;
    const endHit = e.endBinding?.targetId === targetId;
    if (!startHit && !endHit) {
      return e;
    }
    return {
      ...e,
      startBinding: startHit ? undefined : e.startBinding,
      endBinding: endHit ? undefined : e.endBinding,
    };
  });
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
  withComputed(
    ({
      schema,
      selectedTableIds,
      selectedRelationshipIds,
      selectedElementIds,
      accessMode,
      undoDepth,
      redoDepth,
    }) => ({
    tables: computed(() => schema()?.tables ?? []),
    relationships: computed(() => schema()?.relationships ?? []),
    /**
     * Column ids that participate in any relationship. A non-PK column in this
     * set is a foreign key (the table node shows it a link glyph); a PK in it is
     * still shown as a key. Kept as a Set for O(1) per-row lookup.
     */
    foreignKeyColumnIds: computed(() => {
      const ids = new Set<string>();
      for (const r of schema()?.relationships ?? []) {
        ids.add(r.sourceColumnId);
        ids.add(r.targetColumnId);
      }
      return ids as ReadonlySet<string>;
    }),
    elements: computed(() => schema()?.elements ?? []),
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
    /** The single selected element (only when exactly one is selected), for the inspector. */
    selectedElement: computed(() => {
      const ids = selectedElementIds();
      return ids.length === 1
        ? (schema()?.elements.find((e) => e.id === ids[0]) ?? null)
        : null;
    }),
    canEdit: computed(() => accessMode() !== 'VIEW'),
    canUndo: computed(() => undoDepth() > 0),
    canRedo: computed(() => redoDepth() > 0),
    }),
  ),
  withMethods(
    (
      store,
      projectsApi = inject(ProjectsService),
      tablesApi = inject(TablesService),
      columnsApi = inject(ColumnsService),
      indexesApi = inject(IndexesService),
      relationshipsApi = inject(RelationshipsService),
      elementsApi = inject(ElementsService),
      shareLinksApi = inject(ShareLinksService),
      shareSession = inject(ShareSessionService),
    ) => {
      const timers = new Map<string, ReturnType<typeof setTimeout>>();

      // Element undo/redo. Entries reuse the granular element methods so an undo is
      // itself a persisted, broadcast mutation (collaboration-safe). Remote edits
      // and the undo/redo application itself never push new entries.
      const undoStack: HistoryEntry[] = [];
      const redoStack: HistoryEntry[] = [];
      let applyingHistory = false;

      function syncHistoryDepth(): void {
        patchState(store, { undoDepth: undoStack.length, redoDepth: redoStack.length });
      }

      function pushHistory(entry: HistoryEntry): void {
        if (applyingHistory) {
          return;
        }
        undoStack.push(entry);
        redoStack.length = 0;
        syncHistoryDepth();
      }

      async function runHistory(action: () => void | Promise<void>): Promise<void> {
        applyingHistory = true;
        try {
          await action();
        } finally {
          applyingHistory = false;
        }
      }

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

      function mapElement(
        elementId: string,
        fn: (element: CanvasElementModel) => CanvasElementModel,
      ): void {
        setSchema((s) => ({
          ...s,
          elements: s.elements.map((e) => (e.id === elementId ? fn(e) : e)),
        }));
      }

      // Raw element operations (persist + local update, no history). Both the
      // public methods and the undo/redo closures build on these.
      async function createElementRaw(dto: CreateElementDto): Promise<CanvasElementModel | null> {
        const projectId = store.projectId();
        if (!projectId) {
          return null;
        }
        const created = await runSave(() => firstValueFrom(elementsApi.create(projectId, dto)));
        setSchema((s) => ({ ...s, elements: [...s.elements, created] }));
        return created;
      }

      async function updateElementRaw(elementId: string, patch: UpdateElementDto): Promise<void> {
        const updated = await runSave(() => firstValueFrom(elementsApi.update(elementId, patch)));
        mapElement(elementId, () => updated);
      }

      async function deleteElementRaw(elementId: string): Promise<void> {
        await runSave(() => firstValueFrom(elementsApi.remove(elementId)));
        setSchema((s) => ({
          ...s,
          elements: clearBindingsTo(
            s.elements.filter((e) => e.id !== elementId),
            elementId,
          ),
        }));
        patchState(store, {
          selectedElementIds: store.selectedElementIds().filter((id) => id !== elementId),
        });
      }

      /** Capture the current values of the keys a patch will change (for undo). */
      function captureBefore(
        element: CanvasElementModel,
        patch: UpdateElementDto,
      ): UpdateElementDto {
        const before: Record<string, unknown> = {};
        for (const key of Object.keys(patch)) {
          if (key === 'startBinding' || key === 'endBinding') {
            before[key] = element[key] ?? null;
          } else {
            before[key] = (element as unknown as Record<string, unknown>)[key];
          }
        }
        return before as UpdateElementDto;
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
                  // A bound arrow attached to this table reverts to its stored point.
                  elements: clearBindingsTo(s.elements, mutation.tableId),
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
            case 'index.created':
              mapTable(mutation.tableId, (t) => {
                const existing = t.indexes ?? [];
                return existing.some((i) => i.id === mutation.index.id)
                  ? t
                  : { ...t, indexes: [...existing, mutation.index] };
              });
              break;
            case 'index.updated':
              mapTable(mutation.tableId, (t) => ({
                ...t,
                indexes: (t.indexes ?? []).map((i) =>
                  i.id === mutation.index.id ? mutation.index : i,
                ),
              }));
              break;
            case 'index.deleted':
              mapTable(mutation.tableId, (t) => ({
                ...t,
                indexes: (t.indexes ?? []).filter((i) => i.id !== mutation.indexId),
              }));
              break;
            case 'index.reordered':
              mapTable(mutation.tableId, (t) => {
                const byId = new Map((t.indexes ?? []).map((i) => [i.id, i]));
                const indexes = mutation.orderedIndexIds
                  .map((id) => byId.get(id))
                  .filter((i): i is IndexModel => Boolean(i));
                return { ...t, indexes };
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
            case 'element.created':
              setSchema((s) =>
                s.elements.some((e) => e.id === mutation.element.id)
                  ? s
                  : { ...s, elements: [...s.elements, mutation.element] },
              );
              break;
            case 'element.updated':
              mapElement(mutation.element.id, () => mutation.element);
              break;
            case 'element.moved':
              mapElement(mutation.elementId, (e) => ({
                ...e,
                ...(mutation.x !== undefined ? { x: mutation.x } : {}),
                ...(mutation.y !== undefined ? { y: mutation.y } : {}),
                ...(mutation.points !== undefined ? { points: mutation.points } : {}),
              }));
              break;
            case 'element.deleted':
              setSchema((s) => ({
                ...s,
                elements: clearBindingsTo(
                  s.elements.filter((e) => e.id !== mutation.elementId),
                  mutation.elementId,
                ),
              }));
              break;
            case 'element.reordered':
              setSchema((s) => {
                const byId = new Map(s.elements.map((e) => [e.id, e]));
                const ordered = mutation.orderedElementIds
                  .map((id, index) => {
                    const el = byId.get(id);
                    return el ? { ...el, zIndex: index } : undefined;
                  })
                  .filter((e): e is CanvasElementModel => Boolean(e));
                // Keep any elements not named in the order (defensive) at the end.
                const named = new Set(mutation.orderedElementIds);
                const rest = s.elements.filter((e) => !named.has(e.id));
                return { ...s, elements: [...ordered, ...rest] };
              });
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

        /** Select a single element. additive (ctrl/shift) toggles it in the set. */
        selectElement(elementId: string, additive = false): void {
          if (!additive) {
            patchState(store, {
              selectedElementIds: [elementId],
              selectedTableIds: [],
              selectedRelationshipIds: [],
            });
            return;
          }
          const current = store.selectedElementIds();
          patchState(store, {
            selectedElementIds: current.includes(elementId)
              ? current.filter((id) => id !== elementId)
              : [...current, elementId],
          });
        },

        setSelection(
          tableIds: string[],
          relationshipIds: string[],
          elementIds: string[] = [],
        ): void {
          patchState(store, {
            selectedTableIds: tableIds,
            selectedRelationshipIds: relationshipIds,
            selectedElementIds: elementIds,
          });
        },

        clearSelection(): void {
          patchState(store, {
            selectedTableIds: [],
            selectedRelationshipIds: [],
            selectedElementIds: [],
          });
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

        /** Duplicate a table (offset copy) with all its columns; selects the copy. */
        async duplicateTable(tableId: string): Promise<void> {
          const projectId = store.projectId();
          const source = store.tables().find((t) => t.id === tableId);
          if (!projectId || !source) {
            return;
          }
          const name = `${source.name}_copy`.slice(0, 120);
          const created = await runSave(() =>
            firstValueFrom(
              tablesApi.create(projectId, {
                name,
                x: source.x + 40,
                y: source.y + 40,
                color: source.color ?? undefined,
              }),
            ),
          );
          let copy = created;
          for (const col of source.columns) {
            const newCol = await firstValueFrom(
              columnsApi.create(created.id, {
                name: col.name,
                dataType: col.dataType,
                isPrimaryKey: col.isPrimaryKey,
                isNullable: col.isNullable,
                isUnique: col.isUnique,
                isAutoIncrement: col.isAutoIncrement,
              }),
            );
            copy = { ...copy, columns: [...copy.columns, newCol] };
          }
          setSchema((s) => ({ ...s, tables: [...s.tables, copy] }));
          patchState(store, { selectedTableIds: [created.id], selectedRelationshipIds: [] });
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

        async addIndex(tableId: string, dto: CreateIndexDto): Promise<void> {
          const created = await runSave(() => firstValueFrom(indexesApi.create(tableId, dto)));
          mapTable(tableId, (t) => ({ ...t, indexes: [...(t.indexes ?? []), created] }));
        },

        async updateIndex(
          tableId: string,
          indexId: string,
          patch: UpdateIndexDto,
        ): Promise<void> {
          const updated = await runSave(() => firstValueFrom(indexesApi.update(indexId, patch)));
          mapTable(tableId, (t) => ({
            ...t,
            indexes: (t.indexes ?? []).map((i) => (i.id === indexId ? updated : i)),
          }));
        },

        async deleteIndex(tableId: string, indexId: string): Promise<void> {
          await runSave(() => firstValueFrom(indexesApi.remove(indexId)));
          mapTable(tableId, (t) => ({
            ...t,
            indexes: (t.indexes ?? []).filter((i) => i.id !== indexId),
          }));
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

        // --- Canvas elements (excalidraw-style drawing layer) ---

        /** Update the sticky style applied to subsequently drawn elements. */
        setElementStyle(patch: Partial<ElementStyleState>): void {
          patchState(store, { elementStyle: { ...store.elementStyle(), ...patch } });
        },

        /** Create an element and persist it. Selects it unless `select` is false. */
        async addElement(
          dto: CreateElementDto,
          select = true,
        ): Promise<CanvasElementModel | null> {
          const created = await createElementRaw(dto);
          if (!created) {
            return null;
          }
          if (select) {
            patchState(store, {
              selectedElementIds: [created.id],
              selectedTableIds: [],
              selectedRelationshipIds: [],
            });
          }
          // Undo removes it; redo re-creates from the creation snapshot (new id).
          const ref = { id: created.id };
          pushHistory({
            undo: () => deleteElementRaw(ref.id),
            redo: async () => {
              const again = await createElementRaw(elementToCreateDto(created));
              if (again) {
                ref.id = again.id;
              }
            },
          });
          return created;
        },

        async updateElement(elementId: string, patch: UpdateElementDto): Promise<void> {
          const current = store.schema()?.elements.find((e) => e.id === elementId);
          const before = current ? captureBefore(current, patch) : null;
          await updateElementRaw(elementId, patch);
          if (before) {
            pushHistory({
              undo: () => updateElementRaw(elementId, before),
              redo: () => updateElementRaw(elementId, patch),
            });
          }
        },

        /**
         * Persist a geometry change made live (resize/rotate/endpoint) and record it
         * for undo. The element already holds `after` locally; `before` is its state
         * at gesture start.
         */
        async commitElementGeometry(
          elementId: string,
          before: UpdateElementDto,
          after: UpdateElementDto,
        ): Promise<void> {
          await updateElementRaw(elementId, after);
          pushHistory({
            undo: () => updateElementRaw(elementId, before),
            redo: () => updateElementRaw(elementId, after),
          });
        },

        /** Record a completed drag (already persisted) so it can be undone. */
        recordElementMove(moves: { id: string; from: PointModel; to: PointModel }[]): void {
          if (!moves.length) {
            return;
          }
          pushHistory({
            undo: () =>
              Promise.all(
                moves.map((m) => updateElementRaw(m.id, { x: m.from.x, y: m.from.y })),
              ).then(() => undefined),
            redo: () =>
              Promise.all(
                moves.map((m) => updateElementRaw(m.id, { x: m.to.x, y: m.to.y })),
              ).then(() => undefined),
          });
        },

        /** Undo the most recent element operation (no-op when the stack is empty). */
        undoElement(): void {
          const entry = undoStack.pop();
          if (!entry) {
            return;
          }
          redoStack.push(entry);
          syncHistoryDepth();
          void runHistory(() => entry.undo());
        },

        redoElement(): void {
          const entry = redoStack.pop();
          if (!entry) {
            return;
          }
          undoStack.push(entry);
          syncHistoryDepth();
          void runHistory(() => entry.redo());
        },

        /**
         * Optimistic local-only merge, no persistence. Used for live feedback during
         * a resize/rotate/endpoint gesture; the editor persists once on pointer-up.
         */
        patchElementLocal(
          elementId: string,
          patch: Partial<Omit<CanvasElementModel, 'startBinding' | 'endBinding'>> & {
            startBinding?: CanvasElementModel['startBinding'] | null;
            endBinding?: CanvasElementModel['endBinding'] | null;
          },
        ): void {
          mapElement(elementId, (e) => {
            const { startBinding, endBinding, ...rest } = patch;
            const next: CanvasElementModel = { ...e, ...rest };
            // A binding key present in the patch sets it; null clears it.
            if ('startBinding' in patch) {
              next.startBinding = startBinding ?? undefined;
            }
            if ('endBinding' in patch) {
              next.endBinding = endBinding ?? undefined;
            }
            return next;
          });
        },

        /** Optimistic local move; the position PATCH is debounced per element. */
        moveElement(elementId: string, x: number, y: number): void {
          mapElement(elementId, (e) => ({ ...e, x, y }));
          debounce(`pos:elem:${elementId}`, () => {
            void runSave(() => firstValueFrom(elementsApi.updatePosition(elementId, { x, y })));
          });
        },

        /** Optimistic local reshape (vertices); the position PATCH is debounced. */
        setElementPoints(elementId: string, points: PointModel[]): void {
          mapElement(elementId, (e) => ({ ...e, points }));
          debounce(`pts:elem:${elementId}`, () => {
            void runSave(() => firstValueFrom(elementsApi.updatePosition(elementId, { points })));
          });
        },

        async deleteElement(elementId: string): Promise<void> {
          const snapshot = store.schema()?.elements.find((e) => e.id === elementId);
          await deleteElementRaw(elementId);
          if (snapshot) {
            // Undo re-creates it (new id); redo deletes the re-created element.
            const ref = { id: elementId };
            pushHistory({
              undo: async () => {
                const again = await createElementRaw(elementToCreateDto(snapshot));
                if (again) {
                  ref.id = again.id;
                }
              },
              redo: () => deleteElementRaw(ref.id),
            });
          }
        },

        /** Reorder element stacking optimistically; persist the new order (debounced). */
        reorderElements(orderedElementIds: string[]): void {
          setSchema((s) => {
            const byId = new Map(s.elements.map((e) => [e.id, e]));
            const ordered = orderedElementIds
              .map((id, index) => {
                const el = byId.get(id);
                return el ? { ...el, zIndex: index } : undefined;
              })
              .filter((e): e is CanvasElementModel => Boolean(e));
            const named = new Set(orderedElementIds);
            const rest = s.elements.filter((e) => !named.has(e.id));
            return { ...s, elements: [...ordered, ...rest] };
          });
          const projectId = store.projectId();
          if (!projectId) {
            return;
          }
          debounce('elements:reorder', () => {
            void runSave(() => firstValueFrom(elementsApi.reorder(projectId, { orderedElementIds })));
          });
        },
      };
    },
  ),
);
