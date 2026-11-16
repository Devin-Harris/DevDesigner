import { signalStoreFeature, type, withMethods } from '@ngrx/signals';
import { injectDispatch, on, withReducer } from '@ngrx/signals/events';
import type { SchemaMutation } from '@devdesigner/shared';
import { applyRemoteMutations } from '../helpers/schema-mutation.helper';
import type { ProjectState } from '../models/project-state.model';
import { projectRealtimeEvents } from '../project.events';

/**
 * Realtime changes as events: `applyRemote` / `applyRemoteBatch` (called by the realtime
 * service and `importFile`) dispatch `mutationsReceived`, and the reducer applies the whole
 * batch with ONE state write (none when nothing changed), so derived views recompute once.
 * Remote changes are already persisted server-side: nothing here calls an endpoint.
 *
 * The dispatcher is the platform one while the store is `providedIn: 'root'` (one instance). An
 * editor-scoped store must come with `provideDispatcher()` beside it, or every instance would
 * receive every project's mutations.
 */
export function withProjectEventHandlers() {
   return signalStoreFeature(
      { state: type<ProjectState>() },
      withReducer(
         on(projectRealtimeEvents.mutationsReceived, ({ payload }, state) => applyRemoteMutations(state, payload))
      ),
      withMethods(() => {
         const dispatch = injectDispatch(projectRealtimeEvents);
         return {
            /** Apply a schema change broadcast from another participant (local state only). */
            applyRemote(mutation: SchemaMutation): void {
               dispatch.mutationsReceived([mutation]);
            },
            /** Apply many remote changes (one batch/import/clone request) as ONE state update. */
            applyRemoteBatch(mutations: readonly SchemaMutation[]): void {
               dispatch.mutationsReceived(mutations);
            },
         };
      })
   );
}
