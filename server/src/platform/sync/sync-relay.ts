import { Injectable, Logger } from '@nestjs/common';
import { io, type Socket } from 'socket.io-client';
import {
  RT_EVENTS,
  type MutationBatchEvent,
  type MutationEvent,
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

  constructor(private readonly gateway: RealtimeGateway) {}

  clientIdOf(projectId: string): string | null {
    return this.sockets.get(projectId)?.clientId ?? null;
  }

  ensure(projectId: string, remote: SyncRemoteEntity): void {
    if (this.sockets.has(projectId)) return;
    const { origin, path } = remoteOrigin(remote.url);
    const socket = io(`${origin}/realtime`, {
      path,
      transports: ['websocket'],
      auth: { projectId },
      extraHeaders: { Authorization: `Bearer ${remote.token}` },
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
    socket.on(RT_EVENTS.mutations, (event: MutationBatchEvent) => {
      this.gateway.relayRemote(projectId, RT_EVENTS.mutations, event);
      this.onRemoteChange(projectId);
    });
    const drop = (why: string): void => {
      if (this.sockets.get(projectId)?.socket !== socket) return;
      this.sockets.delete(projectId);
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
  }

  closeAll(): void {
    for (const id of [...this.sockets.keys()]) this.close(id);
  }
}
