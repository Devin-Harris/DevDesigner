import { Injectable, Logger } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import {
  RT_EVENTS,
  type MutationBatchEvent,
  type MutationEvent,
  type Participant,
  type RealtimeSession,
} from '@devdesigner/shared';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { remoteOrigin } from './remote-client';
import type { SyncRemoteEntity } from './sync.entity';

/**
 * One socket per live server-backed project, to the server's own realtime endpoint
 * (API-token handshake). Changes other people make there are passed to this
 * computer's editors; the server-assigned client id is sent with forwarded edits so
 * the server does not echo our own changes back.
 */
@Injectable()
export class SyncRelay {
  private readonly log = new Logger('SyncRelay');
  private readonly sockets = new Map<string, { socket: Socket; clientId: string | null }>();
  /** Set by SyncService: the server changed the project (refresh the mirror). */
  onRemoteChange: (projectId: string) => void = () => undefined;
  /** Set by SyncService: the socket dropped (the server went away). */
  onDisconnect: (projectId: string) => void = () => undefined;

  constructor(private readonly gateway: RealtimeGateway) {
    // This computer's cursor, selection and laser go to the server too, so the people
    // there see the desktop user like any other collaborator.
    gateway.localPresence = (projectId, event, body) => {
      const entry = this.sockets.get(projectId);
      if (entry?.socket.connected) entry.socket.volatile.emit(event, body);
    };
  }

  clientIdOf(projectId: string): string | null {
    return this.sockets.get(projectId)?.clientId ?? null;
  }

  ensure(projectId: string, remote: SyncRemoteEntity, token: string): void {
    if (this.sockets.has(projectId)) return;
    const { origin, path } = remoteOrigin(remote.url);
    const socket = io(`${origin}/realtime`, {
      path,
      transports: ['websocket'],
      auth: { projectId },
      extraHeaders: { Authorization: `Bearer ${token}` },
      reconnection: false,
      forceNew: true,
    });
    const entry = { socket, clientId: null as string | null };
    this.sockets.set(projectId, entry);
    socket.on(RT_EVENTS.session, (session: RealtimeSession) => (entry.clientId = session.clientId));
    socket.on(RT_EVENTS.mutation, (event: MutationEvent) => {
      this.gateway.relayRemote(projectId, RT_EVENTS.mutation, event);
      this.onRemoteChange(projectId);
    });
    // Presence of the people on the server (minus this relay's own participant).
    socket.on(RT_EVENTS.roster, (list: Participant[]) => {
      if (!Array.isArray(list)) return;
      this.gateway.setRemoteRoster(
        projectId,
        list.filter((p) => p && p.id !== socket.id),
      );
    });
    for (const event of [RT_EVENTS.cursor, RT_EVENTS.selection, RT_EVENTS.laser]) {
      socket.on(event, (payload: { participantId?: unknown }) => {
        if (payload && payload.participantId !== socket.id) {
          this.gateway.relayRemotePresence(projectId, event, payload);
        }
      });
    }
    socket.on(RT_EVENTS.mutations, (event: MutationBatchEvent) => {
      this.gateway.relayRemote(projectId, RT_EVENTS.mutations, event);
      this.onRemoteChange(projectId);
    });
    const drop = (why: string): void => {
      if (this.sockets.get(projectId)?.socket !== socket) return;
      this.sockets.delete(projectId);
      this.gateway.setRemoteRoster(projectId, null);
      this.log.warn(`relay for ${projectId} closed (${why})`);
      this.onDisconnect(projectId);
    };
    socket.on('connect_error', (err) => drop(err.message));
    socket.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect') drop(reason);
    });
  }

  close(projectId: string): void {
    const entry = this.sockets.get(projectId);
    if (!entry) return;
    this.sockets.delete(projectId);
    entry.socket.disconnect();
    this.gateway.setRemoteRoster(projectId, null);
  }

  closeAll(): void {
    for (const id of [...this.sockets.keys()]) this.close(id);
  }
}
