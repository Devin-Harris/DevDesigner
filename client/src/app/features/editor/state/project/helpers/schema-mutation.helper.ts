import type {
   CanvasElementModel,
   ColumnModel,
   IndexModel,
   LifelineModel,
   SchemaModel,
   SchemaMutation,
   SequenceDiagramModel,
   SequenceMessageModel,
   SlideTheme,
   TableModel,
   ViewportModel,
} from '@devdesigner/shared';

// Pure schema reducers: one realtime SchemaMutation applied to a SchemaModel (the body of the
// store's `applyRemote`), plus the row helpers local edits share with it. No signals, no I/O,
// so the characterization spec can test them directly (§4.4).

/** Replace one table (by id) through `fn`; the schema and tables array are always new. */
export function mapTable(s: SchemaModel, id: string, fn: (t: TableModel) => TableModel): SchemaModel {
   return { ...s, tables: s.tables.map((t) => (t.id === id ? fn(t) : t)) };
}

export function mapElement(s: SchemaModel, id: string, fn: (e: CanvasElementModel) => CanvasElementModel): SchemaModel {
   return { ...s, elements: s.elements.map((e) => (e.id === id ? fn(e) : e)) };
}

export function mapLifeline(s: SchemaModel, id: string, fn: (l: LifelineModel) => LifelineModel): SchemaModel {
   return { ...s, lifelines: s.lifelines.map((l) => (l.id === id ? fn(l) : l)) };
}

export function mapMessage(
   s: SchemaModel,
   id: string,
   fn: (m: SequenceMessageModel) => SequenceMessageModel
): SchemaModel {
   return { ...s, sequenceMessages: s.sequenceMessages.map((m) => (m.id === id ? fn(m) : m)) };
}

export function mapDiagram(
   s: SchemaModel,
   id: string,
   fn: (d: SequenceDiagramModel) => SequenceDiagramModel
): SchemaModel {
   return { ...s, sequenceDiagrams: s.sequenceDiagrams.map((d) => (d.id === id ? fn(d) : d)) };
}

/**
 * Drop any line/arrow bindings that point at a now-deleted target (a table or
 * element), so a bound endpoint reverts to its stored point instead of dangling.
 * Mirrors the server-side integrity rule so remote peers converge identically.
 */
export function clearBindingsTo(elements: readonly CanvasElementModel[], targetId: string): CanvasElementModel[] {
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

/**
 * Restack elements to the given order (zIndex = position). Elements not named keep their
 * place after the named ones (defensive).
 */
export function reorderElementsIn(s: SchemaModel, orderedElementIds: readonly string[]): SchemaModel {
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
}

/**
 * Apply one change broadcast by another participant. The change is already persisted
 * server-side; cascades the DB performs (deleting a table removes its columns and dependent
 * relationships) are mirrored here. Creates are idempotent (a create echoing a local one is
 * ignored). `home.updated` / `themes.updated` live outside the schema and return it as is.
 */
export function applySchemaMutation(s: SchemaModel, mutation: SchemaMutation): SchemaModel {
   switch (mutation.kind) {
      case 'table.created':
         return s.tables.some((t) => t.id === mutation.table.id) ? s : { ...s, tables: [...s.tables, mutation.table] };
      case 'table.updated':
         return mapTable(s, mutation.table.id, () => mutation.table);
      case 'table.moved':
         return mapTable(s, mutation.tableId, (t) => ({ ...t, x: mutation.x, y: mutation.y }));
      case 'table.deleted': {
         const removed = s.tables.find((t) => t.id === mutation.tableId);
         const columnIds = new Set((removed?.columns ?? []).map((c) => c.id));
         return {
            ...s,
            tables: s.tables.filter((t) => t.id !== mutation.tableId),
            relationships: s.relationships.filter(
               (r) => !columnIds.has(r.sourceColumnId) && !columnIds.has(r.targetColumnId)
            ),
            // A bound arrow attached to this table reverts to its stored point.
            elements: clearBindingsTo(s.elements, mutation.tableId),
         };
      }
      case 'column.created':
         return mapTable(s, mutation.tableId, (t) =>
            t.columns.some((c) => c.id === mutation.column.id) ? t : { ...t, columns: [...t.columns, mutation.column] }
         );
      case 'column.updated':
         return mapTable(s, mutation.tableId, (t) => ({
            ...t,
            columns: t.columns.map((c) => (c.id === mutation.column.id ? mutation.column : c)),
         }));
      case 'column.deleted':
         return {
            ...s,
            tables: s.tables.map((t) =>
               t.id === mutation.tableId ? { ...t, columns: t.columns.filter((c) => c.id !== mutation.columnId) } : t
            ),
            relationships: s.relationships.filter(
               (r) => r.sourceColumnId !== mutation.columnId && r.targetColumnId !== mutation.columnId
            ),
         };
      case 'column.reordered':
         return mapTable(s, mutation.tableId, (t) => {
            const byId = new Map(t.columns.map((c) => [c.id, c]));
            const columns = mutation.orderedColumnIds
               .map((id) => byId.get(id))
               .filter((c): c is ColumnModel => Boolean(c));
            return { ...t, columns };
         });
      case 'index.created':
         return mapTable(s, mutation.tableId, (t) => {
            const existing = t.indexes ?? [];
            return existing.some((i) => i.id === mutation.index.id)
               ? t
               : { ...t, indexes: [...existing, mutation.index] };
         });
      case 'index.updated':
         return mapTable(s, mutation.tableId, (t) => ({
            ...t,
            indexes: (t.indexes ?? []).map((i) => (i.id === mutation.index.id ? mutation.index : i)),
         }));
      case 'index.deleted':
         return mapTable(s, mutation.tableId, (t) => ({
            ...t,
            indexes: (t.indexes ?? []).filter((i) => i.id !== mutation.indexId),
         }));
      case 'index.reordered':
         return mapTable(s, mutation.tableId, (t) => {
            const byId = new Map((t.indexes ?? []).map((i) => [i.id, i]));
            const indexes = mutation.orderedIndexIds
               .map((id) => byId.get(id))
               .filter((i): i is IndexModel => Boolean(i));
            return { ...t, indexes };
         });
      case 'relationship.created':
         return s.relationships.some((r) => r.id === mutation.relationship.id)
            ? s
            : { ...s, relationships: [...s.relationships, mutation.relationship] };
      case 'relationship.updated':
         return {
            ...s,
            relationships: s.relationships.map((r) => (r.id === mutation.relationship.id ? mutation.relationship : r)),
         };
      case 'relationship.deleted':
         return {
            ...s,
            relationships: s.relationships.filter((r) => r.id !== mutation.relationshipId),
         };
      case 'element.created':
         return s.elements.some((e) => e.id === mutation.element.id)
            ? s
            : { ...s, elements: [...s.elements, mutation.element] };
      case 'element.updated': {
         const prev = s.elements.find((e) => e.id === mutation.element.id);
         const elements = s.elements.map((e) => (e.id === mutation.element.id ? mutation.element : e));
         // Elements draw in array order: a restack (new zIndex) re-sorts them.
         const restacked = !!prev && prev.zIndex !== mutation.element.zIndex;
         return { ...s, elements: restacked ? elements.sort((a, b) => a.zIndex - b.zIndex) : elements };
      }
      case 'element.moved':
         return mapElement(s, mutation.elementId, (e) => ({
            ...e,
            ...(mutation.x !== undefined ? { x: mutation.x } : {}),
            ...(mutation.y !== undefined ? { y: mutation.y } : {}),
            ...(mutation.points !== undefined ? { points: mutation.points } : {}),
         }));
      case 'element.deleted':
         return {
            ...s,
            elements: clearBindingsTo(
               s.elements.filter((e) => e.id !== mutation.elementId),
               mutation.elementId
            ),
         };
      case 'element.reordered':
         return reorderElementsIn(s, mutation.orderedElementIds);
      case 'sequenceDiagram.created':
         return s.sequenceDiagrams.some((d) => d.id === mutation.diagram.id)
            ? s
            : { ...s, sequenceDiagrams: [...s.sequenceDiagrams, mutation.diagram] };
      case 'sequenceDiagram.updated':
         return mapDiagram(s, mutation.diagram.id, () => mutation.diagram);
      case 'sequenceDiagram.deleted':
         return {
            ...s,
            sequenceDiagrams: s.sequenceDiagrams.filter((d) => d.id !== mutation.diagramId),
            lifelines: s.lifelines.filter((l) => l.diagramId !== mutation.diagramId),
            sequenceMessages: s.sequenceMessages.filter((m) => m.diagramId !== mutation.diagramId),
         };
      case 'lifeline.created':
         return s.lifelines.some((l) => l.id === mutation.lifeline.id)
            ? s
            : { ...s, lifelines: [...s.lifelines, mutation.lifeline] };
      case 'lifeline.updated':
         return mapLifeline(s, mutation.lifeline.id, () => mutation.lifeline);
      case 'lifeline.moved':
         return mapLifeline(s, mutation.lifelineId, (l) => ({ ...l, x: mutation.x }));
      case 'lifeline.deleted':
         return {
            ...s,
            lifelines: s.lifelines.filter((l) => l.id !== mutation.lifelineId),
            sequenceMessages: s.sequenceMessages.filter(
               (m) => m.fromLifelineId !== mutation.lifelineId && m.toLifelineId !== mutation.lifelineId
            ),
         };
      case 'message.created':
         return s.sequenceMessages.some((m) => m.id === mutation.message.id)
            ? s
            : { ...s, sequenceMessages: [...s.sequenceMessages, mutation.message] };
      case 'message.updated':
         return mapMessage(s, mutation.message.id, () => mutation.message);
      case 'message.moved':
         return mapMessage(s, mutation.messageId, (m) => ({ ...m, y: mutation.y }));
      case 'message.deleted':
         return {
            ...s,
            sequenceMessages: s.sequenceMessages.filter((m) => m.id !== mutation.messageId),
         };
      case 'home.updated':
      case 'themes.updated':
         return s;
   }
}

/** The view slots a batch of mutations touches, outside the schema. */
export interface RemoteSlots {
   schema: SchemaModel | null;
   home: ViewportModel | null;
   customThemes: SlideTheme[];
}

/**
 * Fold a batch of remote mutations into the store's slots. Only the slots that changed are
 * returned, so a batch costs at most one schema write (and none when nothing changed).
 * Without a loaded schema only `home` / `themes` apply.
 */
export function applyRemoteMutations(slots: RemoteSlots, mutations: readonly SchemaMutation[]): Partial<RemoteSlots> {
   const patch: Partial<RemoteSlots> = {};
   let schema = slots.schema;
   for (const m of mutations) {
      if (m.kind === 'home.updated') patch.home = m.home ?? null;
      else if (m.kind === 'themes.updated') patch.customThemes = m.themes;
      else if (schema) schema = applySchemaMutation(schema, m);
   }
   if (schema !== slots.schema) patch.schema = schema;
   return patch;
}
