import type { SyncStatus } from '@devdesigner/shared';

/** What to do with a server-backed project when its server answers. */
export type ReconnectStep = 'none' | 'pull' | 'push' | 'conflict' | 'wait';

/**
 * - In conflict: wait for the user's choice. (`paused` follows the same rules when synced by hand.)
 * - No local edits since the mirror was written: take the server's version if it moved.
 * - Local edits (made offline) and the server unchanged: send them.
 * - Both changed: conflict.
 */
export function decideReconnect(state: {
  status: SyncStatus;
  localChanged: boolean;
  remoteChanged: boolean;
}): ReconnectStep {
  if (state.status === 'conflict') return 'wait';
  if (!state.localChanged) return state.remoteChanged ? 'pull' : 'none';
  return state.remoteChanged ? 'conflict' : 'push';
}
