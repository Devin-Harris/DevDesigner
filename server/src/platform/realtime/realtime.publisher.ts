import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  PROJECT_MUTATION_EVENT,
  PROJECT_MUTATIONS_EVENT,
  type MutationBatchEvent,
  type MutationEvent,
  type RealtimeMutation,
  type SchemaMutation,
} from '@devdesigner/shared';
import { bumpProjectRevision } from '../http/project-revision';
import { originClientId as originClientId_ } from '../http/request-context';
import {
  ACCESS_CHANGED_EVENT,
  ACCESS_REVOKED_EVENT,
  type AccessChangedEvent,
  type AccessRevokedEvent,
} from './access-events';

/**
 * Thin façade feature services use to broadcast a persisted schema change to a
 * project's realtime room. Services stay decoupled from the gateway: they emit on
 * the in-process event bus, the gateway subscribes and fans out to sockets. The
 * change has already been authorized and persisted via REST, so this is purely
 * the notification path (server-authoritative sync, see the plan Part 2).
 *
 * It is also the single hook for the per-project graph revision: every persisted
 * change flows through here, so each emit bumps that project's ETag revision.
 */
@Injectable()
export class RealtimePublisher {
  constructor(private readonly emitter: EventEmitter2) {}

  /**
   * Broadcast one persisted change. The origin tab defaults to the current request's
   * trusted X-Client-Id (RequestContext), so its own echo is skipped.
   */
  emit(
    projectId: string,
    mutation: RealtimeMutation,
    originClientId: string | null = originClientId_(),
  ): void {
    bumpProjectRevision(projectId);
    // Patch kinds only travel when REALTIME_PATCH_MUTATIONS is on (see SchemaPatchMutation).
    const event: MutationEvent = {
      projectId,
      originClientId,
      mutation: mutation as SchemaMutation,
    };
    this.emitter.emit(PROJECT_MUTATION_EVENT, event);
  }

  /** Broadcast many changes from one request as a single message (in order). */
  emitMany(
    projectId: string,
    mutations: RealtimeMutation[],
    originClientId: string | null = originClientId_(),
  ): void {
    if (mutations.length === 0) {
      // Nothing to tell peers, but the caller did write: keep cached graphs honest.
      bumpProjectRevision(projectId);
      return;
    }
    if (mutations.length === 1) {
      this.emit(projectId, mutations[0], originClientId);
      return;
    }
    bumpProjectRevision(projectId);
    const event: MutationBatchEvent = {
      projectId,
      originClientId,
      mutations: mutations as SchemaMutation[],
    };
    this.emitter.emit(PROJECT_MUTATIONS_EVENT, event);
  }

  /**
   * Access to a project may have been taken away (link revoked, project deleted,
   * ownership moved): the gateway re-checks the open sockets and drops the ones
   * that lost it. With a token, only sockets that joined with that link are checked.
   */
  accessRevoked(projectId: string, token?: string): void {
    const event: AccessRevokedEvent = token ? { projectId, token } : { projectId };
    this.emitter.emit(ACCESS_REVOKED_EVENT, event);
  }

  /** Access data changed but nobody lost access (link created, project updated): caches drop it. */
  accessChanged(projectId: string, token?: string): void {
    const event: AccessChangedEvent = token ? { projectId, token } : { projectId };
    this.emitter.emit(ACCESS_CHANGED_EVENT, event);
  }
}
