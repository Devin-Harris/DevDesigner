import { patchState, signalStoreFeature, type, withMethods, withProps } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import {
   type CanvasElementModel,
   type CreateElementDto,
   DEFAULT_THEME,
   presentationOf,
   presentationThemes,
   resolveThemeElement,
   type PointModel,
   type UpdateElementDto,
} from '@devdesigner/shared';
import type { ElementStyleState, ItemMoves } from '../models/project-state.model';
import { clearBindingsTo, reorderElementsIn } from '../helpers/schema-mutation.helper';
import { applyItemMoves } from '../helpers/item-moves.helper';
import { elementToCreateDto, captureBefore, resolveElementRefs } from '../helpers/element-dto.helper';
import type { SlidePlacement } from './project-slides-methods.feature';
import type { ProjectInternalsStore, ProjectInternalsWith } from './project-internals';

type ElementOpsHost = ProjectInternalsStore<{ _placement: SlidePlacement }>;

/**
 * Raw element operations (persist + local update, no history). The public methods and the
 * undo/redo closures build on these; `withProjectCloneMethods` reaches them as `_elementOps`.
 */
function createElementOps(store: ElementOpsHost) {
   const { setSchema, mapElement } = store._schema;
   const { flushTimers, runSave, enqueue, queueSettling, failedCreates, notifyFailure, optimistic, stage, isStaged } =
      store._queue;
   const { elementsApi } = store._api;
   const { shownSlideAt } = store._placement;

   async function createElementRaw(dto: CreateElementDto): Promise<CanvasElementModel | null> {
      const projectId = store.projectId();
      if (!projectId) {
         return null;
      }
      // New content drawn on a presentation's shown slide joins that slide.
      const withSlide: CreateElementDto =
         dto.slideId || dto.type === 'frame'
            ? dto
            : {
                 ...dto,
                 slideId: shownSlideAt(dto.x + dto.width / 2, dto.y + dto.height / 2),
              };
      // The id is generated here so the element shows (and can be moved, edited
      // or deleted) at once; those follow-ups queue behind the create request.
      const id = dto.id ?? crypto.randomUUID();
      const zIndex =
         withSlide.zIndex ?? (store.schema()?.elements ?? []).reduce((m, e) => Math.max(m, e.zIndex + 1), 0);
      const body: CreateElementDto = { ...withSlide, id, zIndex };
      const local = { angle: 0, ...body, id, zIndex } as CanvasElementModel;
      setSchema((s) => ({ ...s, elements: [...s.elements, local] }));
      const key = `element:${id}`;
      void enqueue(key, () => runSave(() => firstValueFrom(elementsApi.create(projectId, body))))
         .then((created) => {
            // Local edits made since (staged or in flight) are newer than this copy.
            if (!queueSettling(key) || isStaged('elements', id)) return;
            mapElement(id, () => created);
         })
         .catch(() => {
            failedCreates.add(id);
            setSchema((s) => ({
               ...s,
               elements: clearBindingsTo(
                  s.elements.filter((e) => e.id !== id),
                  id
               ),
            }));
            patchState(store, {
               selectedElementIds: store.selectedElementIds().filter((x) => x !== id),
            });
            notifyFailure('add the element');
         });
      return local;
   }

   /** Local-first element patch; the save is merged and debounced per element. */
   async function updateElementRaw(elementId: string, patch: UpdateElementDto): Promise<void> {
      stage('elements', elementId, patch);
      mapElement(elementId, (e) => {
         const { startBinding, endBinding, ...rest } = patch;
         const next = { ...e, ...(rest as Partial<CanvasElementModel>) };
         if ('startBinding' in patch) next.startBinding = startBinding ?? undefined;
         if ('endBinding' in patch) next.endBinding = endBinding ?? undefined;
         return next;
      });
   }

   /** Local-first delete; the request is queued and the element restored if it fails. */
   async function deleteElementRaw(elementId: string): Promise<boolean> {
      if (failedCreates.has(elementId)) {
         return false;
      }
      flushTimers(`pos:elem:${elementId}`, `pts:elem:${elementId}`, `patch:elem:${elementId}`);
      void optimistic(
         `element:${elementId}`,
         () => {
            setSchema((s) => ({
               ...s,
               elements: clearBindingsTo(
                  s.elements.filter((e) => e.id !== elementId),
                  elementId
               ),
            }));
            patchState(store, {
               selectedElementIds: store.selectedElementIds().filter((id) => id !== elementId),
            });
         },
         () => firstValueFrom(elementsApi.remove(elementId)),
         'delete the element'
      );
      return true;
   }

   return { createElementRaw, updateElementRaw, deleteElementRaw };
}

export type ElementOps = ReturnType<typeof createElementOps>;

/**
 * Canvas elements (the excalidraw-style drawing layer): add/update/delete with undo, live
 * local patches and moves, the sticky style, slide assignment and stacking/arrange.
 */
export function withProjectElementsMethods() {
   return signalStoreFeature(
      type<ProjectInternalsWith<{ _placement: SlidePlacement }>>(),
      withProps((store) => ({ _elementOps: createElementOps(store) })),
      withMethods((store) => {
         const { setSchema, mapElement, mapDiagram } = store._schema;
         const { runSave, stage, patchTableLocal, patchDiagramLocal } = store._queue;
         // Undo/redo can re-create an element under a new id; closures refer to the original id
         // and resolve it through the history alias chain at run time.
         const { push: pushHistory, rid, aliasTo } = store._history;
         const { sequenceApi } = store._api;
         const { createElementRaw, updateElementRaw, deleteElementRaw } = store._elementOps;

         return {
            // --- Canvas elements (excalidraw-style drawing layer) ---

            /** Update the sticky style applied to subsequently drawn elements. */
            /** Persist an element patch without an undo step (automatic bookkeeping). */
            async patchElementSilently(elementId: string, patch: UpdateElementDto): Promise<void> {
               await updateElementRaw(elementId, patch);
            },

            /**
             * Put things on a slide without recording undo steps: used to adopt content
             * that was dropped or moved into the shown slide's frame.
             */
            async assignSlide(
               items: { elements: string[]; tables: string[]; diagrams: string[] },
               slideId: string | null
            ): Promise<void> {
               const projectId = store.projectId();
               const all = store.schema()?.elements ?? [];
               const themes = slideId === null ? presentationThemes(all) : null;
               for (const id of items.elements) {
                  const el = all.find((e) => e.id === id);
                  const frame = el?.slideId ? all.find((f) => f.id === el.slideId) : undefined;
                  if (themes && el && frame) {
                     // Off the slide, theme tokens ($body, $accent1...) have nothing to follow:
                     // bake in the values they showed as.
                     const theme = themes.get(presentationOf(frame)) ?? DEFAULT_THEME;
                     const r = resolveThemeElement(el, theme);
                     if (r !== el) {
                        void updateElementRaw(id, {
                           slideId,
                           strokeColor: r.strokeColor,
                           backgroundColor: r.backgroundColor,
                           fontFamily: r.fontFamily,
                           runs: r.runs ?? null,
                           ...(r.text !== el.text ? { text: r.text } : {}),
                           ...(r.fillStyle !== el.fillStyle ? { fillStyle: r.fillStyle } : {}),
                        });
                        continue;
                     }
                  }
                  void updateElementRaw(id, { slideId });
               }
               for (const id of items.tables) {
                  patchTableLocal(id, { slideId });
               }
               if (projectId) {
                  for (const id of items.diagrams) {
                     patchDiagramLocal(id, { slideId });
                  }
               }
            },

            setElementStyle(patch: Partial<ElementStyleState>): void {
               patchState(store, { elementStyle: { ...store.elementStyle(), ...patch } });
            },

            /** Create an element without an undo step or selection (automatic bookkeeping). */
            async addElementSilently(dto: CreateElementDto): Promise<CanvasElementModel | null> {
               return createElementRaw(dto);
            },

            /** Delete an element without an undo step (automatic bookkeeping). */
            async deleteElementSilently(elementId: string): Promise<void> {
               await deleteElementRaw(elementId);
            },

            /** Create an element and persist it. Selects it unless `select` is false. */
            async addElement(dto: CreateElementDto, select = true): Promise<CanvasElementModel | null> {
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
               // Undo removes it; redo re-creates from the creation snapshot (new id, aliased).
               pushHistory({
                  undo: async () => {
                     await deleteElementRaw(rid(created.id));
                  },
                  redo: async () => {
                     const again = await createElementRaw(resolveElementRefs(elementToCreateDto(created), rid));
                     if (again && again.id !== rid(created.id)) {
                        aliasTo(created.id, again.id);
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
                     undo: () => updateElementRaw(rid(elementId), before),
                     redo: () => updateElementRaw(rid(elementId), patch),
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
               after: UpdateElementDto
            ): Promise<void> {
               await updateElementRaw(elementId, after);
               pushHistory({
                  undo: () => updateElementRaw(rid(elementId), before),
                  redo: () => updateElementRaw(rid(elementId), after),
               });
            },

            /** Record a completed drag (already persisted) so it can be undone. */
            recordElementMove(moves: { id: string; from: PointModel; to: PointModel }[]): void {
               if (!moves.length) {
                  return;
               }
               const to = (pick: (m: (typeof moves)[number]) => PointModel) =>
                  this.moveItemsLocal({ elements: new Map(moves.map((m) => [rid(m.id), pick(m)])) });
               pushHistory({ undo: () => to((m) => m.from), redo: () => to((m) => m.to) });
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
               }
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
               stage('elements', elementId, { x, y });
               mapElement(elementId, (e) => ({ ...e, x, y }));
            },

            /** Optimistic local reshape (vertices); the position PATCH is debounced. */
            setElementPoints(elementId: string, points: PointModel[]): void {
               stage('elements', elementId, { points });
               mapElement(elementId, (e) => ({ ...e, points }));
            },

            async deleteElement(elementId: string): Promise<void> {
               const snapshot = store.schema()?.elements.find((e) => e.id === elementId);
               if ((await deleteElementRaw(elementId)) && snapshot) {
                  // Undo re-creates it under the same id, so whatever points at it (a slide's
                  // layout, items on a frame, placeholder copies) still does; redo deletes it.
                  pushHistory({
                     undo: async () => {
                        const id = rid(elementId);
                        if (store.schema()?.elements.some((e) => e.id === id)) return;
                        await createElementRaw({ ...resolveElementRefs(elementToCreateDto(snapshot), rid), id });
                     },
                     redo: async () => {
                        await deleteElementRaw(rid(elementId));
                     },
                  });
               }
            },

            /**
             * Move elements, tables, relationship waypoints and sequence diagrams together:
             * one state write per drag frame (one pass per collection) instead of one per
             * item. Element/table/waypoint rows are staged for the batch save like
             * `moveElement`/`moveTable`/`setWaypoints`; sequence shifts stay local (persist
             * them when the gesture ends).
             */
            moveItemsLocal(moves: ItemMoves): void {
               for (const [id, p] of moves.elements ?? []) stage('elements', id, { x: p.x, y: p.y });
               for (const [id, p] of moves.tables ?? []) stage('tables', id, { x: p.x, y: p.y });
               for (const [id, waypoints] of moves.waypoints ?? []) stage('relationships', id, { waypoints });
               setSchema((s) => applyItemMoves(s, moves));
            },

            /** Reorder element stacking optimistically; persist the new order (debounced). */
            reorderElements(orderedElementIds: string[]): void {
               const before = new Map(store.elements().map((e) => [e.id, e.zIndex]));
               setSchema((s) => reorderElementsIn(s, orderedElementIds));
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               // Only the rows whose index changed go out, in the staged batch with other edits.
               orderedElementIds.forEach((id, zIndex) => {
                  const was = before.get(id);
                  if (was !== undefined && was !== zIndex) stage('elements', id, { zIndex });
               });
            },

            /**
             * Re-stack the selected elements and sequence diagrams together: all the way
             * to the front/back, or one step past the next item they visually overlap.
             * Diagrams sit between elements via a fractional zIndex (see
             * SequenceDiagramModel.zIndex), so both kinds share one ordering.
             */
            arrangeSelection(op: 'front' | 'back' | 'forward' | 'backward'): void {
               const elements = store.elements();
               const selEls = new Set(store.selectedElementIds());
               const selDiagrams = new Set(store.selectedDiagramIds());
               if (!store.canEdit() || (selEls.size === 0 && selDiagrams.size === 0)) {
                  return;
               }
               type Item = { id: string; diagram: boolean; cls: 'frame' | 'line' | 'content' };
               const diagrams = [...store.sequenceDiagrams()].sort((a, b) => a.zIndex - b.zIndex);
               const items: Item[] = [];
               let di = 0;
               const pushDiagramsBelow = (z: number): void => {
                  while (di < diagrams.length && diagrams[di].zIndex < z) {
                     items.push({ id: diagrams[di].id, diagram: true, cls: 'content' });
                     di++;
                  }
               };
               for (const e of elements) {
                  pushDiagramsBelow(e.zIndex);
                  items.push({
                     id: e.id,
                     diagram: false,
                     cls: e.type === 'frame' ? 'frame' : e.type === 'line' || e.type === 'arrow' ? 'line' : 'content',
                  });
               }
               pushDiagramsBelow(Infinity);

               const isSel = (it: Item): boolean => (it.diagram ? selDiagrams : selEls).has(it.id);
               let next = items;
               if (op === 'front') {
                  next = [...items.filter((i) => !isSel(i)), ...items.filter(isSel)];
               } else if (op === 'back') {
                  next = [...items.filter(isSel), ...items.filter((i) => !isSel(i))];
               } else {
                  const step = op === 'forward' ? 1 : -1;
                  next = [...items];
                  const order = next.map((_, i) => i);
                  if (step === 1) order.reverse();
                  for (const i of order) {
                     const it = next[i];
                     if (!isSel(it)) continue;
                     // Hop to the nearest neighbor it visually overlaps (same layer class).
                     let j = i + step;
                     while (j >= 0 && j < next.length && next[j].cls !== it.cls) j += step;
                     if (j < 0 || j >= next.length || isSel(next[j])) continue;
                     next.splice(i, 1);
                     next.splice(j, 0, it);
                  }
               }

               // Elements take plain indices; each diagram sits just above the element
               // before it. The very top (above every element) also clears table nodes.
               const orderedIds = next.filter((i) => !i.diagram).map((i) => i.id);
               const total = orderedIds.length;
               let before = 0;
               let slot = 0;
               const changes: Array<{ id: string; zIndex: number }> = [];
               for (const it of next) {
                  if (!it.diagram) {
                     before++;
                     slot = 0;
                     continue;
                  }
                  if (total === 0 && !isSel(it)) continue;
                  // With no elements to rank against, only the direction tells front from back.
                  const atBottom = total > 0 ? before === 0 : op === 'back' || op === 'backward';
                  const base = atBottom ? -1 : Math.max(before, 1) - 0.5;
                  const z = base + slot * 0.001;
                  slot++;
                  const cur = diagrams.find((d) => d.id === it.id);
                  if (cur && cur.zIndex !== z) changes.push({ id: it.id, zIndex: z });
               }

               // Content elements pass the ERD table nodes at the extremes: to the front
               // (or forward from the top of the under-tables stack) lifts them above the
               // tables; to the back (or backward from the bottom of the above stack) drops them.
               const byId = new Map(elements.map((e) => [e.id, e]));
               const content = next.filter((i) => !i.diagram && i.cls === 'content');
               const above = (it: Item): boolean => !!byId.get(it.id)?.aboveTables;
               content.forEach((it, idx) => {
                  if (!isSel(it)) return;
                  const cur = above(it);
                  let want = cur;
                  if (op === 'front') want = true;
                  else if (op === 'back') want = false;
                  else if (op === 'forward' && !cur) want = !content.slice(idx + 1).some((o) => !isSel(o) && !above(o));
                  else if (op === 'backward' && cur) want = content.slice(0, idx).some((o) => !isSel(o) && above(o));
                  if (want !== cur) void this.updateElement(it.id, { aboveTables: want });
               });

               const currentIds = elements.map((e) => e.id);
               if (orderedIds.some((id, i) => id !== currentIds[i])) {
                  this.reorderElements(orderedIds);
               }
               const projectId = store.projectId();
               for (const c of changes) {
                  mapDiagram(c.id, (d) => ({ ...d, zIndex: c.zIndex }));
                  if (projectId) {
                     void runSave(() =>
                        firstValueFrom(sequenceApi.updateDiagram(projectId, c.id, { zIndex: c.zIndex }))
                     );
                  }
               }
            },
         };
      })
   );
}
