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
  type RealtimeSession,
} from '@devdesigner/shared';
import {
  ForbiddenException,
  Logger,
  NotFoundException,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
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
import { AccessService } from '../../collaboration/access/access.service';
import { guestOwnerId } from '../../identity/auth/guest-id';
import { AuthService } from '../../identity/auth/auth.service';
import { ACCESS_REVOKED_EVENT, type AccessRevokedEvent } from './access-events';
import { track } from '../analytics/track';
import {
  DEFLATE_THRESHOLD_BYTES,
  MAX_SOCKETS_PER_IP,
  MAX_SOCKETS_PER_PROJECT,
  MAX_SOCKET_MESSAGE_BYTES,
  REAUTHORIZE_INTERVAL_MS,
  RelayLimiter,
  allowRealtimeRequest,
  allowedOrigins,
  configureAllowedOrigins,
  clientIp,
  parseCursor,
  parseLaser,
  parsePresent,
  parseSelection,
} from './realtime-limits';
import {
  mintRealtimeClientId,
  realtimeClient,
  realtimePrincipal,
  registerRealtimeClient,
  unregisterRealtimeClient,
} from './realtime-clients';

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
  /** Set first, so a socket refused mid-handshake still releases its IP slot. */
  ip: string;
  projectId: string;
  participant: Participant;
  /** Server-assigned id (L-1); writes carrying it as X-Client-Id skip this socket. */
  clientId: string;
  /** What the socket authenticated with, kept to re-check access later (M-2). */
  token: string | null;
  guestId: string | null;
  limiter: RelayLimiter;
  /** Analytics only: the signed-in account (null for share-link / guest sockets). */
  userId: string | null;
  /** Analytics only: when the socket joined and when it started presenting (epoch ms). */
  joinedAt: number;
  presentingSince: number | null;
}

function roomOf(projectId: string): string {
  return `project:${projectId}`;
}

/**
 * Every socket also joins a room named after its server-assigned client id, so a
 * broadcast can skip the tab that made the change (it already applied it
 * optimistically).
 */
function clientRoomOf(clientId: string): string {
  return `client:${clientId}`;
}

/**
 * Realtime collaboration gateway (see the plan Part 2). Authorizes every socket
 * with the SAME AccessService the REST layer uses (owner via session cookie,
 * guest via share token), tracks per-project presence, relays cursors and
 * selections, and fans out server-authoritative schema mutations to the room.
 *
 * Hardening (security M-2, M-3, L-1, L-6): handshakes from foreign origins are
 * refused, sockets per IP and per project are capped, relay payloads are checked
 * and rate limited per socket, and access is re-checked when a link is revoked,
 * a project is deleted or changes owner, and every few minutes.
 *
 * The gateway never persists or mutates schema data: writes go through REST and
 * are broadcast here after they succeed.
 */
@WebSocketGateway({
  namespace: REALTIME_NAMESPACE,
  // Evaluated per request against the origins set from ConfigService (CORS_ORIGIN).
  cors: {
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) =>
      cb(null, !origin || allowedOrigins().includes(origin)),
    credentials: true,
  },
  // CORS headers do not apply to websocket upgrades: check Origin on the handshake.
  allowRequest: allowRealtimeRequest,
  maxHttpBufferSize: MAX_SOCKET_MESSAGE_BYTES,
  perMessageDeflate: { threshold: DEFLATE_THRESHOLD_BYTES },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private readonly server!: Namespace;

  /** projectId -> (socketId -> participant). */
  private readonly rooms = new Map<string, Map<string, Participant>>();
  /** Monotonic per-project counters for stable guest names and color rotation. */
  private readonly guestCounters = new Map<string, number>();
  private readonly colorCounters = new Map<string, number>();
  /** Open sockets per client IP. */
  private readonly perIp = new Map<string, number>();
  private reauthorizeTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly access: AccessService,
    private readonly auth: AuthService,
    config: ConfigService,
    @Optional() private readonly events?: EventEmitter2,
  ) {
    configureAllowedOrigins(config.get<string>('CORS_ORIGIN'));
  }

  onModuleInit(): void {
    this.reauthorizeTimer = setInterval(() => void this.reauthorizeAll(), REAUTHORIZE_INTERVAL_MS);
    this.reauthorizeTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.reauthorizeTimer) clearInterval(this.reauthorizeTimer);
  }

  async handleConnection(client: Socket): Promise<void> {
    const ip = clientIp(client.handshake.headers, client.handshake.address);
    client.data = { ip } satisfies Partial<SocketData>;
    const fromIp = (this.perIp.get(ip) ?? 0) + 1;
    this.perIp.set(ip, fromIp);
    if (fromIp > MAX_SOCKETS_PER_IP) {
      this.logger.warn(`Refusing socket: ${fromIp} open from one address`);
      client.disconnect(true);
      return;
    }

    const auth = (client.handshake.auth ?? {}) as Partial<RealtimeHandshakeAuth>;
    const projectId = typeof auth.projectId === 'string' ? auth.projectId : null;
    const token = typeof auth.token === 'string' ? auth.token : null;
    const guestId = guestOwnerId(auth.guestId);
    if (!projectId) {
      client.disconnect(true);
      return;
    }
    if ((this.rooms.get(projectId)?.size ?? 0) >= MAX_SOCKETS_PER_PROJECT) {
      this.logger.warn('Refusing socket: project room is full');
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
    if (!client.connected) {
      return; // left while we were checking; handleDisconnect already ran
    }
    // The client id is minted here, never taken from the handshake (L-1).
    const clientId = mintRealtimeClientId();
    const data: SocketData = {
      ip,
      projectId,
      participant,
      clientId,
      token,
      guestId,
      limiter: new RelayLimiter(),
      userId: user?.id ?? null,
      joinedAt: Date.now(),
      presentingSince: null,
    };
    client.data = data;
    registerRealtimeClient(clientId, {
      principal: realtimePrincipal(user?.id, guestId, token),
      projectId,
    });
    await client.join([roomOf(projectId), clientRoomOf(clientId)]);
    const session: RealtimeSession = { clientId };
    client.emit(RT_EVENTS.session, session);
    const room = this.getRoom(projectId);
    room.set(client.id, participant);
    this.broadcastRoster(projectId);
    // Internal bus only: no DB work and nothing sent to peers.
    track(this.events, 'realtime.joined', { access: accessLevel, roomSize: room.size }, {
      projectId,
      principal: principalOf(user?.id, guestId, token),
      source: 'web',
    });
  }

  handleDisconnect(client: Socket): void {
    const data = client.data as Partial<SocketData> | undefined;
    if (data?.ip) {
      const left = (this.perIp.get(data.ip) ?? 1) - 1;
      if (left > 0) this.perIp.set(data.ip, left);
      else this.perIp.delete(data.ip);
    }
    data?.limiter?.dispose();
    if (data?.clientId) unregisterRealtimeClient(data.clientId);
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
    if (data.joinedAt !== undefined) {
      const now = Date.now();
      const extra = {
        projectId: data.projectId,
        principal: principalOf(data.userId, data.guestId ?? null, data.token ?? null),
        source: 'web' as const,
      };
      if (data.presentingSince) track(this.events, 'present.ended', { durationMs: now - data.presentingSince }, extra);
      track(this.events, 'realtime.left', { sessionMs: now - data.joinedAt, roomSize: room?.size ?? 0 }, extra);
    }
  }

  @SubscribeMessage(RT_EVENTS.cursor)
  onCursor(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): void {
    const data = this.joined(client);
    const cursor = parseCursor(body);
    if (!data || !cursor) {
      return;
    }
    const payload: PresenceCursor = { participantId: data.participant.id, ...cursor };
    data.limiter.relay(
      'cursor',
      () => client.to(roomOf(data.projectId)).emit(RT_EVENTS.cursor, payload),
      false,
    );
  }

  /** Relay a laser-pointer sample to the room. Ephemeral: never stored or persisted. */
  @SubscribeMessage(RT_EVENTS.laser)
  onLaser(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): void {
    const data = this.joined(client);
    const sample = parseLaser(body);
    if (!data || !sample) {
      return;
    }
    const payload: PresenceLaser = {
      participantId: data.participant.id,
      x: sample.x,
      y: sample.y,
      end: sample.end ? true : undefined,
    };
    // A release must arrive (it ends the trail); plain samples may be dropped.
    data.limiter.relay(
      'laser',
      () => client.to(roomOf(data.projectId)).emit(RT_EVENTS.laser, payload),
      sample.end,
    );
  }

  /**
   * A participant started, advanced or stopped presenting. The state rides on
   * their roster entry so late joiners see it too; ephemeral, never persisted.
   */
  @SubscribeMessage(RT_EVENTS.present)
  onPresent(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): void {
    const data = this.joined(client);
    const present = parsePresent(body);
    if (!data || !present) {
      return;
    }
    this.trackPresent(data, !!present.frameId);
    // The roster carries the latest state, so an over-budget update is coalesced.
    data.limiter.relay(
      'present',
      () => {
        data.participant.presenting = present.frameId
          ? { frameId: present.frameId, step: present.step }
          : null;
        this.broadcastRoster(data.projectId);
      },
      true,
    );
  }

  @SubscribeMessage(RT_EVENTS.selection)
  onSelection(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): void {
    const data = this.joined(client);
    const selection = parseSelection(body);
    if (!data || !selection) {
      return;
    }
    const payload: PresenceSelection = { participantId: data.participant.id, ...selection };
    // Peers must end on the latest selection, so an over-budget update is coalesced.
    data.limiter.relay(
      'selection',
      () => client.to(roomOf(data.projectId)).emit(RT_EVENTS.selection, payload),
      true,
    );
  }

  /** Fan a persisted schema change out to the project room, minus the tab that made it. */
  @OnEvent(PROJECT_MUTATION_EVENT)
  handleMutation(event: MutationEvent): void {
    const { to, event: out } = this.peersOf(event);
    to.emit(RT_EVENTS.mutation, out);
  }

  /** Fan many changes from one request out as one message. */
  @OnEvent(PROJECT_MUTATIONS_EVENT)
  handleMutations(event: MutationBatchEvent): void {
    const { to, event: out } = this.peersOf(event);
    to.emit(RT_EVENTS.mutations, out);
  }

  /** Re-check the sockets a revocation may affect and drop the ones that lost access. */
  @OnEvent(ACCESS_REVOKED_EVENT)
  async handleAccessRevoked(event: AccessRevokedEvent): Promise<void> {
    const sockets = this.socketsIn(event.projectId).filter(
      (s) => !event.token || (s.data as SocketData).token === event.token,
    );
    await Promise.all(sockets.map((s) => this.reauthorize(s)));
  }

  /** Periodic re-check of every open socket (expired links and sessions, M-2). */
  async reauthorizeAll(): Promise<void> {
    for (const projectId of [...this.rooms.keys()]) {
      for (const socket of this.socketsIn(projectId)) {
        await this.reauthorize(socket);
      }
    }
  }

  /**
   * The project room without the origin tab's socket. The origin id was already
   * checked against the writer's principal (ClientId decorator); here it must
   * also belong to a live socket in this project, else everyone gets the change.
   * The id is always blanked so peers never learn each other's ids (L-1).
   */
  private peersOf<E extends MutationEvent | MutationBatchEvent>(event: E) {
    const room = this.server.to(roomOf(event.projectId));
    const origin = event.originClientId;
    const live = origin ? realtimeClient(origin) : undefined;
    const to =
      origin && live?.projectId === event.projectId ? room.except(clientRoomOf(origin)) : room;
    return { to, event: { ...event, originClientId: null } };
  }

  /** Re-resolve one socket's access: drop it if gone, update its roster level if changed. */
  private async reauthorize(socket: Socket): Promise<void> {
    const data = socket.data as SocketData | undefined;
    if (!data?.participant) return;
    // The handshake cookie is verified again, so an expired session no longer counts.
    const user = this.auth.verifySession(socket.handshake.headers.cookie);
    let level: AccessLevel;
    try {
      // Fresh: a re-check after a revocation must never see a cached grant.
      level = await this.access.resolveProjectAccess(data.projectId, user?.id ?? data.guestId, data.token, {
        fresh: true,
      });
    } catch (err) {
      if (err instanceof ForbiddenException || err instanceof NotFoundException) {
        socket.disconnect(true);
      } else {
        this.logger.warn(`Access re-check failed: ${(err as Error).message}`);
      }
      return;
    }
    if (level !== data.participant.accessLevel) {
      data.participant.accessLevel = level;
      data.participant.isOwner = level === 'OWNER';
      this.broadcastRoster(data.projectId);
    }
  }

  /** present.started / present.ended on state changes (not per slide step). */
  private trackPresent(data: SocketData, presenting: boolean): void {
    const extra = {
      projectId: data.projectId,
      principal: principalOf(data.userId, data.guestId, data.token),
      source: 'web' as const,
    };
    if (presenting && data.presentingSince === null) {
      data.presentingSince = Date.now();
      track(this.events, 'present.started', {}, extra);
    } else if (!presenting && data.presentingSince !== null) {
      track(this.events, 'present.ended', { durationMs: Date.now() - data.presentingSince }, extra);
      data.presentingSince = null;
    }
  }

  /** The socket's data once it has fully joined a project, else null. */
  private joined(client: Socket): SocketData | null {
    const data = client.data as SocketData | undefined;
    return data?.participant ? data : null;
  }

  private socketsIn(projectId: string): Socket[] {
    const ids = this.rooms.get(projectId);
    if (!ids) return [];
    return [...ids.keys()].map((id) => this.server.sockets.get(id)).filter((s): s is Socket => !!s);
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
      // Never fall back to the email: the roster goes to every guest in the room.
      const name =
        profile?.displayName?.trim() || (accessLevel === 'OWNER' ? 'Owner' : 'Collaborator');
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
    // Read without creating: the last socket leaving must not leave an empty room behind.
    const participants = [...(this.rooms.get(projectId)?.values() ?? [])];
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

/** Raw socket identity for analytics (hashed by the AnalyticsService, never stored as-is). */
function principalOf(
  userId: string | null | undefined,
  guestOwner: string | null,
  token: string | null,
): { userId: string | null; guestId: string | null; shareToken: string | null } {
  return {
    userId: userId ?? null,
    guestId: guestOwner ? guestOwner.slice('guest:'.length) : null,
    shareToken: token,
  };
}
