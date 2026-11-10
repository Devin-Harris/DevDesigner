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

/** ERD relationships: create/clone, field and routing edits, delete. */
export function withProjectRelationshipsMethods() {
   return signalStoreFeature(
      type<ProjectInternals>(),
      withMethods((store) => {
         const { setSchema } = store._schema;
         const { flushTimers, runSave, optimistic, commitPatch, stage } = store._queue;
         const { relationshipsApi } = store._api;

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
               const created = await runSave(() =>
                  firstValueFrom(
                     relationshipsApi.create(projectId, {
                        sourceColumnId,
                        targetColumnId,
                        type,
                        ...routing,
                     })
                  )
               );
               setSchema((s) => ({ ...s, relationships: [...s.relationships, created] }));
               patchState(store, { selectedRelationshipIds: [created.id], selectedTableIds: [] });
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
                     r.id === id ? ({ ...r, ...patch } as RelationshipModel) : r
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
               flushTimers(`wp:${id}`, `patch:rel:${id}`);
               await optimistic(
                  `rel:${id}`,
                  () => {
                     setSchema((s) => ({
                        ...s,
                        relationships: s.relationships.filter((r: RelationshipModel) => r.id !== id),
                     }));
                     patchState(store, {
                        selectedRelationshipIds: store.selectedRelationshipIds().filter((rid) => rid !== id),
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
