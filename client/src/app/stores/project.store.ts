import { computed, inject } from '@angular/core';
import type {
  AccessLevel,
  CanvasElementModel,
  ColumnModel,
  CreateColumnDto,
  CreateElementDto,
  CreateIndexDto,
  CreateLifelineDto,
  CreateSequenceMessageDto,
  IndexModel,
  LifelineModel,
  PointModel,
  RelationshipModel,
  RelationshipType,
  SchemaModel,
  SchemaMutation,
  SequenceDiagramModel,
  SequenceMessageModel,
  TableModel,
  UpdateColumnDto,
  UpdateElementDto,
  UpdateIndexDto,
  UpdateLifelineDto,
  UpdateRelationshipDto,
  UpdateSequenceDiagramDto,
  UpdateSequenceMessageDto,
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
import { SequenceService } from '../core/services/sequence.service';
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
  selectedLifelineIds: string[];
  selectedMessageIds: string[];
  /** The sequence diagram whose bounding box is selected (null = none). */
  selectedDiagramId: string | null;
  /** Transient: a message whose inline label editor should open (toolbar pencil). */
  pendingMessageEditId: string | null;
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
  selectedLifelineIds: [],
  selectedMessageIds: [],
  selectedDiagramId: null,
  pendingMessageEditId: null,
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
    cornerRadius: e.cornerRadius,
    points: e.points,
    text: e.text,
    fontSize: e.fontSize,
    fontFamily: e.fontFamily,
    bold: e.bold,
    italic: e.italic,
    textAlign: e.textAlign,
    verticalAlign: e.verticalAlign,
    startBinding: e.startBinding,
    endBinding: e.endBinding,
    startArrowhead: e.startArrowhead,
    endArrowhead: e.endArrowhead,
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
      selectedLifelineIds,
      selectedMessageIds,
      selectedDiagramId,
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
    // ---- Sequence diagrams ----
    sequenceDiagrams: computed(() => schema()?.sequenceDiagrams ?? []),
    lifelines: computed(() => schema()?.lifelines ?? []),
    sequenceMessages: computed(() => schema()?.sequenceMessages ?? []),
    selectedLifeline: computed(() => {
      const ids = selectedLifelineIds();
      return ids.length === 1 ? (schema()?.lifelines.find((l) => l.id === ids[0]) ?? null) : null;
    }),
    selectedMessage: computed(() => {
      const ids = selectedMessageIds();
      return ids.length === 1
        ? (schema()?.sequenceMessages.find((m) => m.id === ids[0]) ?? null)
        : null;
    }),
    /** The selected diagram (its bounding box), for the inspector. */
    selectedDiagram: computed(() => {
      const id = selectedDiagramId();
      return id ? (schema()?.sequenceDiagrams.find((d) => d.id === id) ?? null) : null;
    }),
    /** True when any sequence diagram's box is selected. */
    sequenceSelected: computed(() => selectedDiagramId() != null),
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
      sequenceApi = inject(SequenceService),
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

      function mapLifeline(id: string, fn: (l: LifelineModel) => LifelineModel): void {
        setSchema((s) => ({
          ...s,
          lifelines: s.lifelines.map((l) => (l.id === id ? fn(l) : l)),
        }));
      }

      function mapMessage(id: string, fn: (m: SequenceMessageModel) => SequenceMessageModel): void {
        setSchema((s) => ({
          ...s,
          sequenceMessages: s.sequenceMessages.map((m) => (m.id === id ? fn(m) : m)),
        }));
      }

      function mapDiagram(
        id: string,
        fn: (d: SequenceDiagramModel) => SequenceDiagramModel,
      ): void {
        setSchema((s) => ({
          ...s,
          sequenceDiagrams: s.sequenceDiagrams.map((d) => (d.id === id ? fn(d) : d)),
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
            case 'sequenceDiagram.created':
              setSchema((s) =>
                s.sequenceDiagrams.some((d) => d.id === mutation.diagram.id)
                  ? s
                  : { ...s, sequenceDiagrams: [...s.sequenceDiagrams, mutation.diagram] },
              );
              break;
            case 'sequenceDiagram.updated':
              mapDiagram(mutation.diagram.id, () => mutation.diagram);
              break;
            case 'sequenceDiagram.deleted':
              setSchema((s) => ({
                ...s,
                sequenceDiagrams: s.sequenceDiagrams.filter((d) => d.id !== mutation.diagramId),
                lifelines: s.lifelines.filter((l) => l.diagramId !== mutation.diagramId),
                sequenceMessages: s.sequenceMessages.filter(
                  (m) => m.diagramId !== mutation.diagramId,
                ),
              }));
              break;
            case 'lifeline.created':
              setSchema((s) =>
                s.lifelines.some((l) => l.id === mutation.lifeline.id)
                  ? s
                  : { ...s, lifelines: [...s.lifelines, mutation.lifeline] },
              );
              break;
            case 'lifeline.updated':
              mapLifeline(mutation.lifeline.id, () => mutation.lifeline);
              break;
            case 'lifeline.moved':
              mapLifeline(mutation.lifelineId, (l) => ({ ...l, x: mutation.x }));
              break;
            case 'lifeline.deleted':
              setSchema((s) => ({
                ...s,
                lifelines: s.lifelines.filter((l) => l.id !== mutation.lifelineId),
                sequenceMessages: s.sequenceMessages.filter(
                  (m) =>
                    m.fromLifelineId !== mutation.lifelineId &&
                    m.toLifelineId !== mutation.lifelineId,
                ),
              }));
              break;
            case 'message.created':
              setSchema((s) =>
                s.sequenceMessages.some((m) => m.id === mutation.message.id)
                  ? s
                  : { ...s, sequenceMessages: [...s.sequenceMessages, mutation.message] },
              );
              break;
            case 'message.updated':
              mapMessage(mutation.message.id, () => mutation.message);
              break;
            case 'message.moved':
              mapMessage(mutation.messageId, (m) => ({ ...m, y: mutation.y }));
              break;
            case 'message.deleted':
              setSchema((s) => ({
                ...s,
                sequenceMessages: s.sequenceMessages.filter((m) => m.id !== mutation.messageId),
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
            selectedLifelineIds: [],
            selectedMessageIds: [],
            selectedDiagramId: null,
          });
        },

        // ================= Sequence diagrams =================

        /** Select one sequence diagram (its bounding box). */
        selectSequence(diagramId: string): void {
          patchState(store, {
            selectedDiagramId: diagramId,
            selectedLifelineIds: [],
            selectedMessageIds: [],
            selectedTableIds: [],
            selectedRelationshipIds: [],
            selectedElementIds: [],
          });
        },

        selectLifeline(lifelineId: string): void {
          patchState(store, {
            selectedLifelineIds: [lifelineId],
            selectedMessageIds: [],
            selectedDiagramId: null,
            selectedTableIds: [],
            selectedRelationshipIds: [],
            selectedElementIds: [],
          });
        },

        selectMessage(messageId: string): void {
          patchState(store, {
            selectedMessageIds: [messageId],
            selectedLifelineIds: [],
            selectedDiagramId: null,
            selectedTableIds: [],
            selectedRelationshipIds: [],
            selectedElementIds: [],
          });
        },

        /** Ask the canvas to open a message's inline label editor (toolbar pencil). */
        requestMessageEdit(messageId: string): void {
          patchState(store, { pendingMessageEditId: messageId });
        },
        clearMessageEditRequest(): void {
          patchState(store, { pendingMessageEditId: null });
        },

        /** Drop a NEW sequence diagram at (x, y): its own group + two participants + a message. */
        async addSequenceStarter(x: number, y: number): Promise<void> {
          const projectId = store.projectId();
          if (!projectId) {
            return;
          }
          const diagram = await runSave(() =>
            firstValueFrom(sequenceApi.createDiagram(projectId, { originY: y })),
          );
          setSchema((s) => ({ ...s, sequenceDiagrams: [...s.sequenceDiagrams, diagram] }));
          const spacing = diagram.lifelineSpacing;
          const a = await runSave(() =>
            firstValueFrom(
              sequenceApi.createLifeline(projectId, {
                diagramId: diagram.id,
                label: 'Participant 1',
                x,
                width: 120,
                order: 0,
                color: TABLE_PALETTE[0],
              }),
            ),
          );
          const b = await runSave(() =>
            firstValueFrom(
              sequenceApi.createLifeline(projectId, {
                diagramId: diagram.id,
                label: 'Participant 2',
                x: x + spacing,
                width: 120,
                order: 1,
                color: TABLE_PALETTE[1],
              }),
            ),
          );
          // Seed one message so the diagram reads as a sequence immediately.
          const m = await runSave(() =>
            firstValueFrom(
              sequenceApi.createMessage(projectId, {
                diagramId: diagram.id,
                fromLifelineId: a.id,
                toLifelineId: b.id,
                y: y + diagram.headerHeight + diagram.rowSpacing,
                style: 'solid',
                direction: 'forward',
                arrowhead: 'arrow',
              }),
            ),
          );
          setSchema((s) => ({
            ...s,
            lifelines: [...s.lifelines, a, b],
            sequenceMessages: [...s.sequenceMessages, m],
          }));
          patchState(store, {
            selectedDiagramId: diagram.id,
            selectedLifelineIds: [],
            selectedMessageIds: [],
            selectedTableIds: [],
            selectedRelationshipIds: [],
            selectedElementIds: [],
          });
        },

        /** Add a participant column to a diagram, on the given side of its spread. */
        async addLifeline(diagramId: string, side: 'left' | 'right' = 'right'): Promise<void> {
          const projectId = store.projectId();
          if (!projectId) {
            return;
          }
          const diagram = store.sequenceDiagrams().find((d) => d.id === diagramId);
          const lls = store.lifelines().filter((l) => l.diagramId === diagramId);
          const spacing = diagram?.lifelineSpacing ?? 160;
          const order = lls.length;
          let x = 0;
          if (lls.length) {
            x =
              side === 'left'
                ? Math.min(...lls.map((l) => l.x)) - spacing
                : Math.max(...lls.map((l) => l.x)) + spacing;
          }
          const created = await runSave(() =>
            firstValueFrom(
              sequenceApi.createLifeline(projectId, {
                diagramId,
                label: `Participant ${order + 1}`,
                x,
                width: 120,
                order,
                color: TABLE_PALETTE[order % TABLE_PALETTE.length],
              }),
            ),
          );
          setSchema((s) => ({ ...s, lifelines: [...s.lifelines, created] }));
          patchState(store, {
            selectedLifelineIds: [created.id],
            selectedMessageIds: [],
            selectedDiagramId: null,
          });
        },

        async updateLifeline(lifelineId: string, patch: UpdateLifelineDto): Promise<void> {
          const projectId = store.projectId();
          if (!projectId) {
            return;
          }
          const updated = await runSave(() =>
            firstValueFrom(sequenceApi.updateLifeline(projectId, lifelineId, patch)),
          );
          mapLifeline(lifelineId, () => updated);
        },

        /** Optimistic horizontal move; the position PATCH is debounced per lifeline. */
        moveLifeline(lifelineId: string, x: number): void {
          const projectId = store.projectId();
          if (!projectId) {
            return;
          }
          mapLifeline(lifelineId, (l) => ({ ...l, x }));
          debounce(`llpos:${lifelineId}`, () => {
            void runSave(() => firstValueFrom(sequenceApi.moveLifeline(projectId, lifelineId, { x })));
          });
        },

        async deleteLifeline(lifelineId: string): Promise<void> {
          const projectId = store.projectId();
          if (!projectId) {
            return;
          }
          await runSave(() => firstValueFrom(sequenceApi.deleteLifeline(projectId, lifelineId)));
          setSchema((s) => ({
            ...s,
            lifelines: s.lifelines.filter((l) => l.id !== lifelineId),
            sequenceMessages: s.sequenceMessages.filter(
              (m) => m.fromLifelineId !== lifelineId && m.toLifelineId !== lifelineId,
            ),
          }));
          patchState(store, {
            selectedLifelineIds: store.selectedLifelineIds().filter((id) => id !== lifelineId),
          });
        },

        /**
         * Create a message between two lifelines. `atY` is the world-y where the
         * connection was drawn; it snaps to the nearest row of the grid. Multiple
         * messages may share a row (simultaneous messages). Without `atY` it goes
         * on the row after the lowest existing one.
         */
        async addMessage(
          diagramId: string,
          fromLifelineId: string,
          toLifelineId: string,
          atY?: number,
        ): Promise<void> {
          const projectId = store.projectId();
          if (!projectId) {
            return;
          }
          const diagram = store.sequenceDiagrams().find((d) => d.id === diagramId);
          if (!diagram) {
            return;
          }
          const base = diagram.originY + diagram.headerHeight;
          const gap = diagram.rowSpacing;
          const rowOf = (y: number) => Math.max(1, Math.round((y - base) / gap));
          const msgs = store.sequenceMessages().filter((m) => m.diagramId === diagramId);
          const row =
            atY != null ? rowOf(atY) : (msgs.length ? Math.max(...msgs.map((m) => rowOf(m.y))) + 1 : 1);
          const y = base + gap * row;
          const created = await runSave(() =>
            firstValueFrom(
              sequenceApi.createMessage(projectId, {
                diagramId,
                fromLifelineId,
                toLifelineId,
                y,
                style: 'solid',
                direction: 'forward',
                arrowhead: 'arrow',
              }),
            ),
          );
          setSchema((s) => ({ ...s, sequenceMessages: [...s.sequenceMessages, created] }));
          patchState(store, {
            selectedMessageIds: [created.id],
            selectedLifelineIds: [],
            selectedDiagramId: null,
          });
        },

        /**
         * Clone a whole sequence diagram (config, participants, messages) offset by
         * (dx, dy) and select the copy. Returns the new diagram id.
         */
        async duplicateSequence(diagramId: string, dx = 0, dy = 0): Promise<string | null> {
          const projectId = store.projectId();
          const src = store.sequenceDiagrams().find((d) => d.id === diagramId);
          if (!projectId || !src) {
            return null;
          }
          const diagram = await runSave(() =>
            firstValueFrom(
              sequenceApi.createDiagram(projectId, {
                originY: src.originY + dy,
                lifelineSpacing: src.lifelineSpacing,
                rowSpacing: src.rowSpacing,
                headerHeight: src.headerHeight,
              }),
            ),
          );
          setSchema((s) => ({ ...s, sequenceDiagrams: [...s.sequenceDiagrams, diagram] }));
          patchState(store, {
            selectedDiagramId: diagram.id,
            selectedLifelineIds: [],
            selectedMessageIds: [],
            selectedTableIds: [],
            selectedRelationshipIds: [],
            selectedElementIds: [],
          });
          const idMap = new Map<string, string>();
          const lifelines = store
            .lifelines()
            .filter((l) => l.diagramId === diagramId)
            .sort((a, b) => a.order - b.order);
          for (const l of lifelines) {
            const copy = await runSave(() =>
              firstValueFrom(
                sequenceApi.createLifeline(projectId, {
                  diagramId: diagram.id,
                  label: l.label,
                  color: l.color,
                  x: l.x + dx,
                  width: l.width,
                  order: l.order,
                }),
              ),
            );
            idMap.set(l.id, copy.id);
            setSchema((s) => ({ ...s, lifelines: [...s.lifelines, copy] }));
          }
          const messages = store.sequenceMessages().filter((m) => m.diagramId === diagramId);
          for (const m of messages) {
            const from = idMap.get(m.fromLifelineId);
            const to = idMap.get(m.toLifelineId);
            if (!from || !to) {
              continue;
            }
            const copy = await runSave(() =>
              firstValueFrom(
                sequenceApi.createMessage(projectId, {
                  diagramId: diagram.id,
                  fromLifelineId: from,
                  toLifelineId: to,
                  label: m.label,
                  y: m.y + dy,
                  style: m.style,
                  direction: m.direction,
                  arrowhead: m.arrowhead,
                }),
              ),
            );
            setSchema((s) => ({ ...s, sequenceMessages: [...s.sequenceMessages, copy] }));
          }
          return diagram.id;
        },

        /** Clone one participant column (same diagram, label and color) and select it. */
        async duplicateLifeline(lifelineId: string, dx = 0): Promise<string | null> {
          const projectId = store.projectId();
          const src = store.lifelines().find((l) => l.id === lifelineId);
          if (!projectId || !src) {
            return null;
          }
          const order = store.lifelines().filter((l) => l.diagramId === src.diagramId).length;
          const copy = await runSave(() =>
            firstValueFrom(
              sequenceApi.createLifeline(projectId, {
                diagramId: src.diagramId,
                label: src.label,
                color: src.color,
                x: src.x + dx,
                width: src.width,
                order,
              }),
            ),
          );
          setSchema((s) => ({ ...s, lifelines: [...s.lifelines, copy] }));
          patchState(store, {
            selectedLifelineIds: [copy.id],
            selectedMessageIds: [],
            selectedDiagramId: null,
          });
          return copy.id;
        },

        /** Clone one message (same endpoints, style and row) and select it. */
        async duplicateMessage(messageId: string, dy = 0): Promise<string | null> {
          const projectId = store.projectId();
          const src = store.sequenceMessages().find((m) => m.id === messageId);
          if (!projectId || !src) {
            return null;
          }
          const copy = await runSave(() =>
            firstValueFrom(
              sequenceApi.createMessage(projectId, {
                diagramId: src.diagramId,
                fromLifelineId: src.fromLifelineId,
                toLifelineId: src.toLifelineId,
                label: src.label,
                y: src.y + dy,
                style: src.style,
                direction: src.direction,
                arrowhead: src.arrowhead,
              }),
            ),
          );
          setSchema((s) => ({ ...s, sequenceMessages: [...s.sequenceMessages, copy] }));
          patchState(store, {
            selectedMessageIds: [copy.id],
            selectedLifelineIds: [],
            selectedDiagramId: null,
          });
          return copy.id;
        },

        /** Delete one sequence diagram and all its participants + messages. */
        async deleteSequence(diagramId: string): Promise<void> {
          const projectId = store.projectId();
          if (!projectId) {
            return;
          }
          await runSave(() => firstValueFrom(sequenceApi.deleteDiagram(projectId, diagramId)));
          setSchema((s) => ({
            ...s,
            sequenceDiagrams: s.sequenceDiagrams.filter((d) => d.id !== diagramId),
            lifelines: s.lifelines.filter((l) => l.diagramId !== diagramId),
            sequenceMessages: s.sequenceMessages.filter((m) => m.diagramId !== diagramId),
          }));
          patchState(store, {
            selectedDiagramId:
              store.selectedDiagramId() === diagramId ? null : store.selectedDiagramId(),
            selectedLifelineIds: [],
            selectedMessageIds: [],
          });
        },

        async updateMessage(messageId: string, patch: UpdateSequenceMessageDto): Promise<void> {
          const projectId = store.projectId();
          if (!projectId) {
            return;
          }
          const updated = await runSave(() =>
            firstValueFrom(sequenceApi.updateMessage(projectId, messageId, patch)),
          );
          mapMessage(messageId, () => updated);
        },

        /** Optimistic vertical move; the position PATCH is debounced per message. */
        moveMessage(messageId: string, y: number): void {
          const projectId = store.projectId();
          if (!projectId) {
            return;
          }
          mapMessage(messageId, (m) => ({ ...m, y }));
          debounce(`msgpos:${messageId}`, () => {
            void runSave(() => firstValueFrom(sequenceApi.moveMessage(projectId, messageId, { y })));
          });
        },

        async deleteMessage(messageId: string): Promise<void> {
          const projectId = store.projectId();
          if (!projectId) {
            return;
          }
          await runSave(() => firstValueFrom(sequenceApi.deleteMessage(projectId, messageId)));
          setSchema((s) => ({
            ...s,
            sequenceMessages: s.sequenceMessages.filter((m) => m.id !== messageId),
          }));
          patchState(store, {
            selectedMessageIds: store.selectedMessageIds().filter((id) => id !== messageId),
          });
        },

        /** Update one diagram's layout config (spacing / origin), persisted. */
        async updateSequenceConfig(
          diagramId: string,
          patch: UpdateSequenceDiagramDto,
        ): Promise<void> {
          const projectId = store.projectId();
          if (!projectId) {
            return;
          }
          const updated = await runSave(() =>
            firstValueFrom(sequenceApi.updateDiagram(projectId, diagramId, patch)),
          );
          mapDiagram(diagramId, () => updated);
        },

        /**
         * Live (local-only) shift of one diagram: every lifeline's x plus the row
         * origin, and every message moves with it (kept on its row via `startRows`),
         * so the diagram translates as a whole. Persist on drag end.
         */
        shiftSequence(
          diagramId: string,
          startXs: ReadonlyMap<string, number>,
          dx: number,
          startOriginY: number,
          dy: number,
          startRows: ReadonlyMap<string, number>,
        ): void {
          setSchema((s) => {
            const d = s.sequenceDiagrams.find((x) => x.id === diagramId);
            const base = startOriginY + dy + (d?.headerHeight ?? 42);
            const gap = d?.rowSpacing ?? 48;
            return {
              ...s,
              lifelines: s.lifelines.map((l) =>
                l.diagramId === diagramId ? { ...l, x: (startXs.get(l.id) ?? l.x) + dx } : l,
              ),
              sequenceMessages: s.sequenceMessages.map((m) =>
                m.diagramId === diagramId && startRows.has(m.id)
                  ? { ...m, y: base + gap * (startRows.get(m.id) ?? 1) }
                  : m,
              ),
              sequenceDiagrams: s.sequenceDiagrams.map((x) =>
                x.id === diagramId ? { ...x, originY: startOriginY + dy } : x,
              ),
            };
          });
        },

        /**
         * Live (local-only) resize of one diagram: each lifeline's x is scaled
         * around `anchorX` by `scaleX`, the vertical size is set via `rowSpacing` +
         * `originY`, and messages are re-spaced to keep their rows. Persist on end.
         */
        resizeSequenceTo(
          diagramId: string,
          startXs: ReadonlyMap<string, number>,
          anchorX: number,
          scaleX: number,
          rowSpacing: number,
          originY: number,
          startRows: ReadonlyMap<string, number>,
        ): void {
          setSchema((s) => {
            const d = s.sequenceDiagrams.find((x) => x.id === diagramId);
            const base = originY + (d?.headerHeight ?? 42);
            return {
              ...s,
              lifelines: s.lifelines.map((l) =>
                l.diagramId === diagramId
                  ? { ...l, x: anchorX + ((startXs.get(l.id) ?? l.x) - anchorX) * scaleX }
                  : l,
              ),
              sequenceMessages: s.sequenceMessages.map((m) =>
                m.diagramId === diagramId && startRows.has(m.id)
                  ? { ...m, y: base + rowSpacing * (startRows.get(m.id) ?? 1) }
                  : m,
              ),
              sequenceDiagrams: s.sequenceDiagrams.map((x) =>
                x.id === diagramId ? { ...x, rowSpacing, originY } : x,
              ),
            };
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
        async duplicateTable(
          tableId: string,
          dx = 40,
          dy = 40,
          select = true,
          waitForColumns = true,
        ): Promise<string | null> {
          const projectId = store.projectId();
          const source = store.tables().find((t) => t.id === tableId);
          if (!projectId || !source) {
            return null;
          }
          const name = `${source.name}_copy`.slice(0, 120);
          const created = await runSave(() =>
            firstValueFrom(
              tablesApi.create(projectId, {
                name,
                x: source.x + dx,
                y: source.y + dy,
                color: source.color ?? undefined,
              }),
            ),
          );
          // Show the copy as soon as the table exists; columns stream in after, so
          // an Alt-drag can grab it immediately instead of waiting on N round trips.
          setSchema((s) => ({ ...s, tables: [...s.tables, created] }));
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
                }),
              );
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

        /**
         * Clone elements (copy/paste, Alt-drag) offset by (dx, dy) and select the
         * copies. Bindings to elements that were also cloned are remapped to their
         * copies; bindings to anything else are dropped so a copied arrow keeps its
         * own geometry. One undo step removes every copy.
         */
        async duplicateElements(
          sources: CanvasElementModel[],
          dx: number,
          dy: number,
        ): Promise<Map<string, CanvasElementModel>> {
          if (!sources.length) {
            return new Map();
          }
          const ordered = [...sources].sort((a, b) => a.zIndex - b.zIndex);
          const idMap = new Map<string, string>();
          const copiesBySource = new Map<string, CanvasElementModel>();
          const created: CanvasElementModel[] = [];
          const baseZ = store.elements().length;
          for (const src of ordered) {
            const dto = elementToCreateDto(src);
            const remap = (b: CanvasElementModel['startBinding']) =>
              b && b.targetKind === 'element' && idMap.has(b.targetId)
                ? { ...b, targetId: idMap.get(b.targetId)! }
                : null;
            const copy = await createElementRaw({
              ...dto,
              x: src.x + dx,
              y: src.y + dy,
              zIndex: baseZ + created.length,
              startBinding: remap(src.startBinding),
              endBinding: remap(src.endBinding),
            });
            if (copy) {
              idMap.set(src.id, copy.id);
              copiesBySource.set(src.id, copy);
              created.push(copy);
            }
          }
          if (!created.length) {
            return copiesBySource;
          }
          patchState(store, {
            selectedElementIds: created.map((c) => c.id),
            selectedTableIds: [],
            selectedRelationshipIds: [],
          });
          const refs = created.map((c) => ({ id: c.id, snapshot: c }));
          pushHistory({
            undo: async () => {
              for (const r of refs) {
                await deleteElementRaw(r.id);
              }
            },
            redo: async () => {
              for (const r of refs) {
                const again = await createElementRaw(elementToCreateDto(r.snapshot));
                if (again) {
                  r.id = again.id;
                }
              }
            },
          });
          return copiesBySource;
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
