import { patchState, signalStoreFeature, type, withMethods } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { type SchemaModel, type ViewportModel, type SlideTheme } from '@devdesigner/shared';
import type { ProjectState } from '../models/project-state.model';
import { isSandboxId } from '../../../../../core/sandbox/sandbox-backend.service';
import { readSavedViewport, saveViewport } from '../viewport-storage';
import { DEFAULT_VIEWPORT } from './project-state.feature';
import type { ProjectInternals } from './project-internals';

/** How long pan/zoom must settle before it is written to this browser's storage. */
const VIEWPORT_SAVE_MS = 1000;

/** The view slots for a freshly loaded project: this browser's last view of it, else the server's. */
function viewSlotsOf(projectId: string, schema: SchemaModel): Pick<ProjectState, 'viewport' | 'home' | 'customThemes'> {
   return {
      viewport: (!isSandboxId(projectId) && readSavedViewport(projectId)) || schema.viewport || DEFAULT_VIEWPORT,
      home: schema.home ?? null,
      customThemes: schema.themes ?? [],
   };
}

function messageOf(err: unknown): string {
   if (err && typeof err === 'object' && 'message' in err) {
      return String((err as { message: unknown }).message);
   }
   return 'Something went wrong.';
}

/** Load (owner or share link), the shared home view and theme library, and the personal viewport. */
export function withProjectLoadMethods() {
   return signalStoreFeature(
      type<ProjectInternals>(),
      withMethods((store) => {
         const { debounce, runSave } = store._queue;
         const { projectsApi, shareLinksApi, shareSession } = store._api;

         /** The last pan/zoom not yet written to this browser's storage. */
         let pendingViewport: { projectId: string; viewport: ViewportModel } | null = null;
         function flushViewport(): void {
            if (!pendingViewport) return;
            saveViewport(pendingViewport.projectId, pendingViewport.viewport);
            pendingViewport = null;
         }
         // Leaving the page mid-debounce still keeps the view.
         globalThis.addEventListener?.('pagehide', flushViewport);

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
                     ...viewSlotsOf(projectId, graph.schema),
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
                     ...viewSlotsOf(graph.project.id, graph.schema),
                     accessMode: graph.accessLevel,
                     loading: false,
                  });
               } catch (err) {
                  patchState(store, { loading: false, error: messageOf(err), schema: null });
               }
            },

            /** Replace the project's custom theme library (shared with collaborators). */
            async setCustomThemes(themes: SlideTheme[]): Promise<void> {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               patchState(store, { customThemes: themes });
               await runSave(() => firstValueFrom(projectsApi.updateThemes(projectId, { themes })));
            },

            /** Save (or clear, with null) the shared home view that reset-view returns to. */
            async setHome(home: ViewportModel | null): Promise<void> {
               const projectId = store.projectId();
               if (!projectId) {
                  return;
               }
               patchState(store, { home });
               await runSave(() => firstValueFrom(projectsApi.updateHome(projectId, { home })));
            },

            /**
             * Pan/zoom. Personal view state: remembered in this browser per project (debounced),
             * never sent to the server. Guide sandboxes keep it in their local stand-in backend.
             */
            setViewport(x: number, y: number, zoom: number): void {
               const viewport = { x, y, zoom };
               patchState(store, { viewport });
               const projectId = store.projectId();
               if (!projectId || !store.schema()) {
                  return;
               }
               if (isSandboxId(projectId)) {
                  debounce('viewport', () => {
                     void runSave(() =>
                        firstValueFrom(projectsApi.updateViewport(projectId, { viewportX: x, viewportY: y, zoom }))
                     );
                  });
                  return;
               }
               pendingViewport = { projectId, viewport };
               debounce('viewport', flushViewport, VIEWPORT_SAVE_MS);
            },
         };
      })
   );
}
