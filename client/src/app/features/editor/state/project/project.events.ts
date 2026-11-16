import { type } from '@ngrx/signals';
import { eventGroup } from '@ngrx/signals/events';
import type { SchemaMutation } from '@devdesigner/shared';

/**
 * Events the ProjectStore reacts to (§4.4). `mutationsReceived` carries changes another
 * participant (or a server-side import/clone) already persisted; the store folds them in with
 * the pure `applyRemoteMutations` reducer.
 */
export const projectRealtimeEvents = eventGroup({
   source: 'Project Realtime',
   events: {
      mutationsReceived: type<readonly SchemaMutation[]>(),
   },
});
