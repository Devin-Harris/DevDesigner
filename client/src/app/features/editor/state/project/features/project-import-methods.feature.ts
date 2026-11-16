import { signalStoreFeature, type, withMethods } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import type { ProjectExportFile } from '@devdesigner/shared';
import type { ProjectInternalsWith } from './project-internals';

/** Merge an exported project file into the open project (import/clone domain). */
export function withProjectImportMethods() {
   return signalStoreFeature(
      type<
         ProjectInternalsWith<
            object,
            {
               setSelection(
                  tableIds: string[],
                  relationshipIds: string[],
                  elementIds?: string[],
                  messageIds?: string[],
                  lifelineIds?: string[],
                  diagramIds?: string[]
               ): void;
            }
         >
      >(),
      withMethods((store) => {
         const { projectsApi } = store._api;
         return {
            /**
             * Merge an exported project file into the open project. The server persists
             * and broadcasts the additions and returns them; they are applied here exactly
             * like a collaborator's changes, then selected so they can be moved as a unit.
             */
            async importFile(file: unknown, anchor: { x: number; y: number }): Promise<number> {
               const projectId = store.projectId();
               if (!projectId) {
                  throw new Error('No project is open.');
               }
               const { mutations } = await firstValueFrom(
                  projectsApi.importInto(projectId, { file: file as ProjectExportFile, anchor })
               );
               const tableIds: string[] = [];
               const elementIds: string[] = [];
               const diagramIds: string[] = [];
               store.applyRemoteBatch(mutations);
               for (const mutation of mutations) {
                  if (mutation.kind === 'table.created') tableIds.push(mutation.table.id);
                  else if (mutation.kind === 'element.created') elementIds.push(mutation.element.id);
                  else if (mutation.kind === 'sequenceDiagram.created') diagramIds.push(mutation.diagram.id);
               }
               store.setSelection(tableIds, [], elementIds, [], [], diagramIds);
               return mutations.length;
            },
         };
      })
   );
}
