import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  PROJECT_MUTATION_EVENT,
  PROJECT_MUTATIONS_EVENT,
  type MutationBatchEvent,
  type MutationEvent,
  type SchemaMutation,
} from '@devdesigner/shared';

/**
 * Thin façade feature services use to broadcast a persisted schema change to a
 * project's realtime room. Services stay decoupled from the gateway: they emit on
 * the in-process event bus, the gateway subscribes and fans out to sockets. The
 * change has already been authorized and persisted via REST, so this is purely
 * the notification path (server-authoritative sync, see the plan Part 2).
 */
@Injectable()
export class RealtimePublisher {
  constructor(private readonly emitter: EventEmitter2) {}

  emit(projectId: string, originClientId: string | null, mutation: SchemaMutation): void {
    const event: MutationEvent = { projectId, originClientId, mutation };
    this.emitter.emit(PROJECT_MUTATION_EVENT, event);
  }

  /** Broadcast many changes from one request as a single message (in order). */
  emitMany(projectId: string, originClientId: string | null, mutations: SchemaMutation[]): void {
    if (mutations.length === 0) return;
    if (mutations.length === 1) {
      this.emit(projectId, originClientId, mutations[0]);
      return;
    }
    const event: MutationBatchEvent = { projectId, originClientId, mutations };
    this.emitter.emit(PROJECT_MUTATIONS_EVENT, event);
  }
}
