import { patchState, signalStoreFeature, type, withMethods } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import {
   type CreateRelationshipDto,
   type PointModel,
   type RelationshipModel,
   type RelationshipType,
   type UpdateRelationshipDto,
} from '@devdesigner/shared';
import type { ProjectInternals } from './project-internals';

/** ERD relationships: create/clone, field and routing edits, delete (undoable; re-created under their own ids). */
export function withProjectRelationshipsMethods() {
   return signalStoreFeature(
      type<ProjectInternals>(),
      withMethods((store) => {
         const { setSchema } = store._schema;
         const { flushTimers, runSave, optimistic, createOptimistic, commitPatch, stage } = store._queue;
         const { relationshipsApi } = store._api;
         const { push: pushHistory, rid } = store._history;

         const findRel = (id: string): RelationshipModel | undefined =>
            store.schema()?.relationships.find((r) => r.id === id);
         const hasColumn = (cid: string): boolean => store.tables().some((t) => t.columns.some((c) => c.id === cid));

         /** Re-create a deleted relationship under its own id (when both ends still exist). */
         async function restoreRelationship(rel: RelationshipModel): Promise<void> {
            const projectId = store.projectId();
            const id = rid(rel.id);
            const sourceColumnId = rid(rel.sourceColumnId);
            const targetColumnId = rid(rel.targetColumnId);
            if (!projectId || findRel(id) || !hasColumn(sourceColumnId) || !hasColumn(targetColumnId)) return;
            let rc = await runSave(() =>
               firstValueFrom(
                  relationshipsApi.create(projectId, {
                     id,
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

         return {
            async addRelationship(
               sourceColumnId: string,
               targetColumnId: string,
               type: RelationshipType = 'ONE_TO_MANY',
               routing: Pick<CreateRelationshipDto, 'sourceSide' | 'targetSide' | 'autoRoute'> = {}
            ): Promise<void> {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               // Optimistic (P3.2): the line shows at once under a client id.
               const dto: CreateRelationshipDto = {
                  id: crypto.randomUUID(),
                  sourceColumnId,
                  targetColumnId,
                  type,
                  ...routing,
               };
               const id = dto.id!;
               const mapRels = (fn: (list: RelationshipModel[]) => RelationshipModel[]): void =>
                  setSchema((s) => ({ ...s, relationships: fn(s.relationships) }));
               createOptimistic({
                  id,
                  queueKey: `rel:${id}`,
                  section: 'relationships',
                  insert: () => mapRels((list) => [...list, { ...dto, id } satisfies RelationshipModel]),
                  remove: () => {
                     mapRels((list) => list.filter((r) => r.id !== id));
                     patchState(store, {
                        selectedRelationshipIds: store.selectedRelationshipIds().filter((x) => x !== id),
                     });
                  },
                  persist: () => firstValueFrom(relationshipsApi.create(projectId, dto)),
                  reconcile: (saved) => mapRels((list) => list.map((r) => (r.id === id ? saved : r))),
                  what: 'add the relationship',
               });
               patchState(store, { selectedRelationshipIds: [id], selectedTableIds: [] });
               let snap = { ...dto, id } satisfies RelationshipModel;
               pushHistory({
                  undo: async () => {
                     snap = structuredClone(findRel(rid(id)) ?? snap);
                     await this.deleteRelationshipRaw(rid(id));
                  },
                  redo: () => restoreRelationship(snap),
               });
            },

            /**
             * Clone relationships onto cloned tables. `columnMap` maps original column
             * ids to their copies; only relationships with both endpoints mapped are
             * cloned. Returns the new relationship ids.
             */
            async duplicateRelationships(
               sources: RelationshipModel[],
               columnMap: Map<string, string>
            ): Promise<string[]> {
               const projectId = store.projectId();
               if (!projectId) {
                  return [];
               }
               const ids: string[] = [];
               for (const rel of sources) {
                  const sourceColumnId = columnMap.get(rel.sourceColumnId);
                  const targetColumnId = columnMap.get(rel.targetColumnId);
                  if (!sourceColumnId || !targetColumnId) {
                     continue;
                  }
                  let created = await runSave(() =>
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
                     created = await runSave(() => firstValueFrom(relationshipsApi.update(created.id, { waypoints })));
                  }
                  setSchema((s) => ({ ...s, relationships: [...s.relationships, created] }));
                  ids.push(created.id);
               }
               return ids;
            },

            async updateRelationship(id: string, patch: UpdateRelationshipDto): Promise<void> {
               const current = findRel(id);
               await this.updateRelationshipRaw(id, patch);
               if (current) {
                  const prev: Record<string, unknown> = {};
                  for (const k of Object.keys(patch)) prev[k] = (current as unknown as Record<string, unknown>)[k] ?? null;
                  pushHistory({
                     undo: () => this.updateRelationshipRaw(rid(id), prev as UpdateRelationshipDto),
                     redo: () => this.updateRelationshipRaw(rid(id), patch),
                  });
               }
            },

            /** Apply a relationship edit without recording it (undo/redo use this). */
            async updateRelationshipRaw(id: string, patch: UpdateRelationshipDto): Promise<void> {
               if (patch.sourceColumnId !== undefined || patch.targetColumnId !== undefined) {
                  commitPatch(
                     `patch:rel:${id}`,
                     `rel:${id}`,
                     id,
                     patch,
                     (p) => firstValueFrom(relationshipsApi.update(id, p)),
                     'save the relationship'
                  );
               } else {
                  stage('relationships', id, patch);
               }
               setSchema((s) => ({
                  ...s,
                  relationships: s.relationships.map((r: RelationshipModel) =>
                     r.id === id ? ({ ...r, ...patch } satisfies RelationshipModel) : r
                  ),
               }));
            },

            /** Optimistic local routing; the waypoints PATCH is debounced per relationship. */
            setWaypoints(id: string, waypoints: PointModel[]): void {
               stage('relationships', id, { waypoints });
               setSchema((s) => ({
                  ...s,
                  relationships: s.relationships.map((r: RelationshipModel) => (r.id === id ? { ...r, waypoints } : r)),
               }));
            },

            async deleteRelationship(id: string): Promise<void> {
               const snap = findRel(id);
               await this.deleteRelationshipRaw(id);
               if (!snap || findRel(id)) return; // rolled back
               const kept = structuredClone(snap);
               pushHistory({
                  undo: () => restoreRelationship(kept),
                  redo: () => this.deleteRelationshipRaw(rid(id)),
               });
            },

            /** Delete without recording it (undo/redo use this). */
            async deleteRelationshipRaw(id: string): Promise<void> {
               flushTimers(`wp:${id}`, `patch:rel:${id}`);
               await optimistic(
                  `rel:${id}`,
                  () => {
                     setSchema((s) => ({
                        ...s,
                        relationships: s.relationships.filter((r: RelationshipModel) => r.id !== id),
                     }));
                     patchState(store, {
                        selectedRelationshipIds: store.selectedRelationshipIds().filter((x) => x !== id),
                     });
                  },
                  () => firstValueFrom(relationshipsApi.remove(id)),
                  'delete the relationship'
               );
            },
         };
      })
   );
}
