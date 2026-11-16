import { patchState, signalStoreFeature, type, withMethods } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import {
   nextCopyName,
   remapAnimations,
   type CanvasElementModel,
   type CloneItemsDto,
   type LifelineModel,
   type RelationshipModel,
   type SequenceDiagramModel,
   type SequenceMessageModel,
   type TableModel,
} from '@devdesigner/shared';
import { elementToCreateDto, resolveElementRefs } from '../helpers/element-dto.helper';
import type { ElementOps } from './project-elements-methods.feature';
import type { ProjectInternalsWith } from './project-internals';

/**
 * Copies: `cloneItems` (tables + relationships, diagrams and elements as ONE optimistic write and
 * one POST /clone) and `duplicateElements` (copy/paste and Alt-drag of elements).
 */
export function withProjectCloneMethods() {
   return signalStoreFeature(
      type<ProjectInternalsWith<{ _elementOps: ElementOps }>>(),
      withMethods((store) => {
         const { setSchema } = store._schema;
         const { flushTimers, runSave, enqueue, notifyFailure } = store._queue;
         const { push: pushHistory, rid, aliasTo } = store._history;
         const { projectsApi } = store._api;
         const { createElementRaw, deleteElementRaw } = store._elementOps;

         return {
            /**
             * Clone tables (with the relationships between them), sequence diagrams and
             * elements by (dx, dy) as ONE optimistic write: every copy gets a client id and
             * shows at once, a single POST /clone persists them in one transaction (all
             * copies are removed again if it fails), and one undo step removes them.
             * Content of a copied slide belongs to the copied slide. `presentation` moves
             * copied slides into that presentation (keeping their order). Relationships
             * between copied tables are copied too (only `relationshipIds` when given).
             */
            cloneItems(
               tableIds: ReadonlySet<string>,
               diagramIds: ReadonlySet<string>,
               sources: readonly CanvasElementModel[],
               dx: number,
               dy: number,
               opts: { presentation?: string; relationshipIds?: ReadonlySet<string> } = {}
            ): {
               copies: Map<string, CanvasElementModel>;
               tables: Map<string, string>;
               diagrams: Map<string, string>;
               relationships: string[];
            } {
               const { presentation, relationshipIds } = opts;
               const projectId = store.projectId();
               const schema = store.schema();
               const empty = { copies: new Map(), tables: new Map(), diagrams: new Map(), relationships: [] };
               if (!projectId || !schema) {
                  return empty;
               }
               const uid = () => crypto.randomUUID();
               // Every copied row's id, keyed by its source id (elements, tables, diagrams, children).
               const copyOf = new Map<string, string>();
               for (const e of sources) copyOf.set(e.id, uid());
               const srcTables = schema.tables.filter((t) => tableIds.has(t.id));
               const srcDiagrams = schema.sequenceDiagrams.filter((d) => diagramIds.has(d.id));
               for (const t of srcTables) copyOf.set(t.id, uid());
               for (const d of srcDiagrams) copyOf.set(d.id, uid());
               const ownerOf = (slideId: string | undefined): string | null =>
                  slideId ? (copyOf.get(slideId) ?? slideId) : null;
               const body: CloneItemsDto = {
                  dx,
                  dy,
                  tables: [],
                  relationships: [],
                  diagrams: [],
                  elements: [],
               };
               const tables: TableModel[] = [];
               const columnMap = new Map<string, string>();
               for (const t of srcTables) {
                  const columns: Record<string, string> = {};
                  const indexes: Record<string, string> = {};
                  const cols = t.columns.map((c) => {
                     columns[c.id] = uid();
                     columnMap.set(c.id, columns[c.id]);
                     return { ...c, id: columns[c.id] };
                  });
                  const idx = (t.indexes ?? []).map((x) => {
                     indexes[x.id] = uid();
                     return {
                        ...x,
                        id: indexes[x.id],
                        columnIds: x.columnIds.map((c) => columnMap.get(c) ?? c),
                     };
                  });
                  const id = copyOf.get(t.id)!;
                  const slideId = ownerOf(t.slideId);
                  body.tables!.push({ sourceId: t.id, id, slideId, columns, indexes });
                  tables.push({
                     ...t,
                     id,
                     x: t.x + dx,
                     y: t.y + dy,
                     groupId: undefined,
                     slideId: slideId ?? undefined,
                     columns: cols,
                     indexes: idx,
                  });
               }
               const relationships: RelationshipModel[] = [];
               for (const r of schema.relationships) {
                  const sourceColumnId = columnMap.get(r.sourceColumnId);
                  const targetColumnId = columnMap.get(r.targetColumnId);
                  if (!sourceColumnId || !targetColumnId) continue;
                  if (relationshipIds && !relationshipIds.has(r.id)) continue;
                  const id = uid();
                  body.relationships!.push({ sourceId: r.id, id });
                  relationships.push({
                     ...r,
                     id,
                     sourceColumnId,
                     targetColumnId,
                     waypoints: r.waypoints?.map((p) => ({ x: p.x + dx, y: p.y + dy })),
                  });
               }
               const diagrams: SequenceDiagramModel[] = [];
               const lifelines: LifelineModel[] = [];
               const messages: SequenceMessageModel[] = [];
               for (const d of srcDiagrams) {
                  const id = copyOf.get(d.id)!;
                  const slideId = ownerOf(d.slideId);
                  const lifelineIds: Record<string, string> = {};
                  const messageIds: Record<string, string> = {};
                  for (const l of schema.lifelines.filter((x) => x.diagramId === d.id)) {
                     lifelineIds[l.id] = uid();
                     lifelines.push({ ...l, id: lifelineIds[l.id], diagramId: id, x: l.x + dx });
                  }
                  for (const m of schema.sequenceMessages.filter((x) => x.diagramId === d.id)) {
                     const from = lifelineIds[m.fromLifelineId];
                     const to = lifelineIds[m.toLifelineId];
                     if (!from || !to) continue;
                     messageIds[m.id] = uid();
                     messages.push({
                        ...m,
                        id: messageIds[m.id],
                        diagramId: id,
                        fromLifelineId: from,
                        toLifelineId: to,
                        y: m.y + dy,
                     });
                  }
                  body.diagrams!.push({
                     sourceId: d.id,
                     id,
                     slideId,
                     lifelines: lifelineIds,
                     messages: messageIds,
                  });
                  diagrams.push({
                     ...d,
                     id,
                     originY: d.originY + dy,
                     groupId: undefined,
                     slideId: slideId ?? undefined,
                  });
               }
               // Bindings follow copied targets; bindings to anything else are dropped.
               const remap = (b: CanvasElementModel['startBinding']) =>
                  b && copyOf.has(b.targetId) ? { ...b, targetId: copyOf.get(b.targetId)! } : null;
               const frameNames = schema.elements
                  .filter((e) => e.type === 'frame' && e.text)
                  .map((e) => e.text as string);
               const baseZ = schema.elements.reduce((m, e) => Math.max(m, e.zIndex + 1), 0);
               const ordered = [...sources].sort((a, b) => a.zIndex - b.zIndex);
               const copies = new Map<string, CanvasElementModel>();
               for (const [i, src] of ordered.entries()) {
                  const id = copyOf.get(src.id)!;
                  const slide = src.slide
                     ? {
                          ...src.slide,
                          ...(presentation !== undefined ? { presentation } : { order: src.slide.order + 0.01 }),
                          ...(src.slide.animations?.length
                             ? { animations: remapAnimations(src.slide.animations, copyOf) }
                             : {}),
                       }
                     : undefined;
                  const text =
                     src.type === 'frame' && src.text && !src.slide ? nextCopyName(src.text, frameNames) : src.text;
                  const copy: CanvasElementModel = {
                     ...src,
                     id,
                     x: src.x + dx,
                     y: src.y + dy,
                     zIndex: baseZ + i,
                     groupId: undefined,
                     // Copies share their source's lineage so they morph with it.
                     morphId: src.morphId ?? src.id,
                     slideId: src.type === 'frame' ? undefined : (ownerOf(src.slideId) ?? undefined),
                     slide,
                     text,
                     startBinding: remap(src.startBinding) ?? undefined,
                     endBinding: remap(src.endBinding) ?? undefined,
                  };
                  copies.set(src.id, copy);
                  body.elements!.push({
                     sourceId: src.id,
                     id,
                     slideId: copy.slideId ?? null,
                     slide: slide ?? null,
                     morphId: copy.morphId ?? null,
                     zIndex: copy.zIndex,
                     text: copy.text ?? null,
                     startBinding: copy.startBinding ?? null,
                     endBinding: copy.endBinding ?? null,
                  });
               }
               const created = {
                  tables,
                  relationships,
                  sequenceDiagrams: diagrams,
                  lifelines,
                  sequenceMessages: messages,
                  elements: [...copies.values()],
               };
               const ids = {
                  tables: tables.map((t) => t.id),
                  relationships: relationships.map((r) => r.id),
                  diagrams: diagrams.map((d) => d.id),
                  elements: created.elements.map((e) => e.id),
               };
               const add = () =>
                  setSchema((s) => ({
                     ...s,
                     tables: [...s.tables, ...created.tables],
                     relationships: [...s.relationships, ...created.relationships],
                     sequenceDiagrams: [...s.sequenceDiagrams, ...created.sequenceDiagrams],
                     lifelines: [...s.lifelines, ...created.lifelines],
                     sequenceMessages: [...s.sequenceMessages, ...created.sequenceMessages],
                     elements: [...s.elements, ...created.elements],
                  }));
               const remove = () => {
                  const gone = new Set([...ids.tables, ...ids.relationships, ...ids.diagrams, ...ids.elements]);
                  setSchema((s) => ({
                     ...s,
                     tables: s.tables.filter((t) => !gone.has(t.id)),
                     relationships: s.relationships.filter((r) => !gone.has(r.id)),
                     sequenceDiagrams: s.sequenceDiagrams.filter((d) => !gone.has(d.id)),
                     lifelines: s.lifelines.filter((l) => !gone.has(l.diagramId)),
                     sequenceMessages: s.sequenceMessages.filter((m) => !gone.has(m.diagramId)),
                     elements: s.elements.filter((e) => !gone.has(e.id)),
                  }));
                  patchState(store, {
                     selectedElementIds: store.selectedElementIds().filter((x) => !gone.has(x)),
                     selectedTableIds: store.selectedTableIds().filter((x) => !gone.has(x)),
                     selectedDiagramIds: store.selectedDiagramIds().filter((x) => !gone.has(x)),
                  });
               };
               const persist = () => {
                  add();
                  void enqueue('clone', () => runSave(() => firstValueFrom(projectsApi.clone(projectId, body)))).catch(
                     () => {
                        remove();
                        notifyFailure('copy those items');
                     }
                  );
               };
               persist();
               pushHistory({
                  undo: async () => {
                     flushTimers('batch');
                     remove();
                     void enqueue('clone', () =>
                        runSave(() =>
                           firstValueFrom(
                              projectsApi.batch(projectId, {
                                 deletes: {
                                    elements: ids.elements,
                                    relationships: ids.relationships,
                                    diagrams: ids.diagrams,
                                    tables: ids.tables,
                                 },
                              })
                           )
                        )
                     ).catch(() => notifyFailure('undo the copy'));
                  },
                  redo: async () => persist(),
               });
               return {
                  copies,
                  tables: new Map(srcTables.map((t) => [t.id, copyOf.get(t.id)!])),
                  diagrams: new Map(srcDiagrams.map((d) => [d.id, copyOf.get(d.id)!])),
                  relationships: ids.relationships,
               };
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
               dy: number
            ): Promise<Map<string, CanvasElementModel>> {
               if (!sources.length) {
                  return new Map();
               }
               // Frames first, so what belongs to a copied slide can be pointed at its copy.
               const ordered = [...sources].sort(
                  (a, b) => (b.type === 'frame' ? 1 : 0) - (a.type === 'frame' ? 1 : 0) || a.zIndex - b.zIndex
               );
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
                     // Copies share their source's lineage so they morph with it, and a
                     // copied slide lands right after its source in the sequence.
                     morphId: src.morphId ?? src.id,
                     slideId: src.slideId && idMap.has(src.slideId) ? idMap.get(src.slideId) : src.slideId,
                     // A copied plain frame counts its name up ("Page 2" -> "Page 3"); slides are
                     // named by their order instead.
                     text:
                        src.type === 'frame' && src.text && !src.slide
                           ? nextCopyName(
                                src.text,
                                store
                                   .elements()
                                   .filter((e) => e.type === 'frame' && e.text)
                                   .map((e) => e.text as string)
                             )
                           : dto.text,
                     slide: src.slide ? { ...src.slide, order: src.slide.order + 0.01 } : undefined,
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
               pushHistory({
                  undo: async () => {
                     for (const c of created) {
                        await deleteElementRaw(rid(c.id));
                     }
                  },
                  redo: async () => {
                     for (const c of created) {
                        const again = await createElementRaw(resolveElementRefs(elementToCreateDto(c), rid));
                        if (again && again.id !== rid(c.id)) {
                           aliasTo(c.id, again.id);
                        }
                     }
                  },
               });
               return copiesBySource;
            },
         };
      })
   );
}
