import {
  PROJECT_MUTATION_EVENT,
  PROJECT_MUTATIONS_EVENT,
  REALTIME_NAMESPACE,
  RT_EVENTS,
  type AccessLevel,
  type MutationBatchEvent,
  type MutationEvent,
  type Participant,
  type PresenceCursor,
  type PresenceLaser,
  type PresenceSelection,
  type RealtimeHandshakeAuth,
} from '@devdesigner/shared';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { AccessService } from '../access/access.service';
import { guestOwnerId } from '../auth/guest-id';
import { AuthService } from '../auth/auth.service';

/** Colors assigned round-robin to participants so cursors read distinctly. */
const PRESENCE_PALETTE = [
  '#2f6bff',
  '#12b76a',
  '#f5a623',
  '#e5484d',
  '#7c5cff',
  '#ec4899',
  '#0ea5e9',
  '#64748b',
];

interface SocketData {
  projectId: string;
  participant: Participant;
  clientId: string | null;
}

function roomOf(projectId: string): string {
  return `project:${projectId}`;
}

function corsOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN ?? 'http://localhost:4242';
  return raw.split(',').map((o) => o.trim());
}

/**
 * Realtime collaboration gateway (see the plan Part 2). Authorizes every socket
 * with the SAME AccessService the REST layer uses (owner via session cookie,
 * guest via share token), tracks per-project presence, relays cursors and
 * selections, and fans out server-authoritative schema mutations to the room.
 *
 * The gateway never persists or mutates schema data: writes go through REST and
 * are broadcast here after they succeed.
 */
@WebSocketGateway({
  namespace: REALTIME_NAMESPACE,
  cors: { origin: corsOrigins(), credentials: true },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private readonly server!: Namespace;

  /** projectId -> (socketId -> participant). */
  private readonly rooms = new Map<string, Map<string, Participant>>();
  /** Monotonic per-project counters for stable guest names and color rotation. */
  private readonly guestCounters = new Map<string, number>();
  private readonly colorCounters = new Map<string, number>();

  constructor(
    private readonly access: AccessService,
    private readonly auth: AuthService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const auth = (client.handshake.auth ?? {}) as Partial<RealtimeHandshakeAuth>;
    const projectId = typeof auth.projectId === 'string' ? auth.projectId : null;
    const token = typeof auth.token === 'string' ? auth.token : null;
    const clientId = typeof auth.clientId === 'string' ? auth.clientId : null;
    const guestId = guestOwnerId(auth.guestId);
    if (!projectId) {
      client.disconnect(true);
      return;
    }

    const user = this.auth.verifySession(client.handshake.headers.cookie);
    let accessLevel: AccessLevel;
    try {
      accessLevel = await this.access.resolveProjectAccess(projectId, user?.id ?? guestId, token);
    } catch {
      // No access: refuse the socket rather than leaking presence.
      client.disconnect(true);
      return;
    }

    const participant = await this.buildParticipant(client.id, projectId, user, accessLevel);
    client.data = { projectId, participant, clientId } satisfies SocketData;
    await client.join(roomOf(projectId));
    this.getRoom(projectId).set(client.id, participant);
    this.broadcastRoster(projectId);
  }

  handleDisconnect(client: Socket): void {
    const data = client.data as SocketData | undefined;
    if (!data?.projectId) {
      return;
    }
    const room = this.rooms.get(data.projectId);
    if (room) {
      room.delete(client.id);
      if (room.size === 0) {
        this.rooms.delete(data.projectId);
      }
    }
    this.broadcastRoster(data.projectId);
  }

  @SubscribeMessage(RT_EVENTS.cursor)
  onCursor(@ConnectedSocket() client: Socket, @MessageBody() body: { x: number; y: number }): void {
    const data = client.data as SocketData | undefined;
    if (!data?.participant || typeof body?.x !== 'number' || typeof body?.y !== 'number') {
      return;
    }
    const payload: PresenceCursor = { participantId: data.participant.id, x: body.x, y: body.y };
    client.to(roomOf(data.projectId)).emit(RT_EVENTS.cursor, payload);
  }

  /** Relay a laser-pointer sample to the room. Ephemeral: never stored or persisted. */
  @SubscribeMessage(RT_EVENTS.laser)
  onLaser(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { x: number; y: number; end?: boolean },
  ): void {
    const data = client.data as SocketData | undefined;
    if (!data?.participant || !Number.isFinite(body?.x) || !Number.isFinite(body?.y)) {
      return;
    }
    const payload: PresenceLaser = {
      participantId: data.participant.id,
      x: body.x,
      y: body.y,
      end: body.end === true ? true : undefined,
    };
    client.to(roomOf(data.projectId)).emit(RT_EVENTS.laser, payload);
  }

  /**
   * A participant started, advanced or stopped presenting. The state rides on
   * their roster entry so late joiners see it too; ephemeral, never persisted.
   */
  @SubscribeMessage(RT_EVENTS.present)
  onPresent(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { frameId: string | null; step?: number },
  ): void {
    const data = client.data as SocketData | undefined;
    if (!data?.participant) {
      return;
    }
    const frameId = typeof body?.frameId === 'string' ? body.frameId.slice(0, 100) : null;
    const step = Number.isInteger(body?.step) ? Math.max(0, Math.min(50, body.step as number)) : 0;
    data.participant.presenting = frameId ? { frameId, step } : null;
    this.broadcastRoster(data.projectId);
  }

  @SubscribeMessage(RT_EVENTS.selection)
  onSelection(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { tableIds: string[]; relationshipIds: string[]; columnId?: string },
  ): void {
    const data = client.data as SocketData | undefined;
    if (!data?.participant) {
      return;
    }
    const payload: PresenceSelection = {
      participantId: data.participant.id,
      tableIds: Array.isArray(body?.tableIds) ? body.tableIds : [],
      relationshipIds: Array.isArray(body?.relationshipIds) ? body.relationshipIds : [],
      columnId: body?.columnId,
    };
    client.to(roomOf(data.projectId)).emit(RT_EVENTS.selection, payload);
  }

  /** Fan a persisted schema change out to everyone in the project room. */
  @OnEvent(PROJECT_MUTATION_EVENT)
  handleMutation(event: MutationEvent): void {
    this.server.to(roomOf(event.projectId)).emit(RT_EVENTS.mutation, event);
  }

  /** Fan many changes from one request out as one message. */
  @OnEvent(PROJECT_MUTATIONS_EVENT)
  handleMutations(event: MutationBatchEvent): void {
    this.server.to(roomOf(event.projectId)).emit(RT_EVENTS.mutations, event);
  }

  private async buildParticipant(
    socketId: string,
    projectId: string,
    user: { id: string; email: string | null } | null,
    accessLevel: AccessLevel,
  ): Promise<Participant> {
    const color = this.nextColor(projectId);
    if (user) {
      const profile = await this.auth.me(user.id);
      const name = profile?.displayName?.trim() || profile?.email || user.email || 'User';
      return { id: socketId, name, color, accessLevel, isOwner: accessLevel === 'OWNER' };
    }
    const guestNumber = this.nextGuestNumber(projectId);
    return {
      id: socketId,
      name: `Guest ${guestNumber}`,
      color,
      accessLevel,
      isOwner: false,
    };
  }

  private getRoom(projectId: string): Map<string, Participant> {
    let room = this.rooms.get(projectId);
    if (!room) {
      room = new Map();
      this.rooms.set(projectId, room);
    }
    return room;
  }

  private broadcastRoster(projectId: string): void {
    const participants = [...this.getRoom(projectId).values()];
    this.server.to(roomOf(projectId)).emit(RT_EVENTS.roster, participants);
  }

  private nextGuestNumber(projectId: string): number {
    const next = (this.guestCounters.get(projectId) ?? 0) + 1;
    this.guestCounters.set(projectId, next);
    return next;
  }

  private nextColor(projectId: string): string {
    const index = this.colorCounters.get(projectId) ?? 0;
    this.colorCounters.set(projectId, index + 1);
    return PRESENCE_PALETTE[index % PRESENCE_PALETTE.length];
  }
}
