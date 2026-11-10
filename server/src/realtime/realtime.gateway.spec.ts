import type { INestApplication } from '@nestjs/common';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import { REALTIME_NAMESPACE, RT_EVENTS, type MutationEvent } from '@devdesigner/shared';
import type { AddressInfo } from 'node:net';
// socket.io-client is a client-workspace dependency hoisted to the root node_modules.
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { AccessService } from '../access/access.service';
import { AuthService } from '../auth/auth.service';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimePublisher } from './realtime.publisher';

/**
 * End-to-end gateway tests over a real socket.io server on an ephemeral port.
 * Access and auth are mocked; everything socket-side (rooms, relays, broadcasts)
 * is the real thing.
 */
describe('RealtimeGateway', () => {
  let app: INestApplication;
  let url: string;
  let publisher: RealtimePublisher;
  const access = { resolveProjectAccess: jest.fn() };
  const auth = { verifySession: jest.fn(() => null), me: jest.fn() };
  const open: ClientSocket[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        RealtimeGateway,
        RealtimePublisher,
        { provide: AccessService, useValue: access },
        { provide: AuthService, useValue: auth },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.useWebSocketAdapter(new IoAdapter(app));
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${port}${REALTIME_NAMESPACE}`;
    publisher = app.get(RealtimePublisher);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    access.resolveProjectAccess.mockReset().mockResolvedValue('EDIT');
  });

  afterEach(() => {
    while (open.length) open.pop()?.disconnect();
  });

  /** Connect and wait until the roster arrives (the socket is in its room by then). */
  function connect(
    auth: Record<string, unknown>,
    opts: { origin?: string } = {},
  ): Promise<ClientSocket> {
    const socket = io(url, {
      transports: ['websocket'],
      auth,
      forceNew: true,
      reconnection: false,
      extraHeaders: { origin: opts.origin ?? 'http://localhost:4242' },
    });
    open.push(socket);
    return new Promise((resolve, reject) => {
      socket.once(RT_EVENTS.roster, () => resolve(socket));
      socket.once('connect_error', reject);
      socket.once('disconnect', () => reject(new Error('disconnected')));
    });
  }

  function collect<T>(socket: ClientSocket, event: string): T[] {
    const seen: T[] = [];
    socket.on(event, (payload: T) => seen.push(payload));
    return seen;
  }

  const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));

  it('does not echo a mutation to the tab that made it', async () => {
    const origin = await connect({ projectId: 'p1', clientId: 'tab-a' });
    const peer = await connect({ projectId: 'p1', clientId: 'tab-b' });
    const atOrigin = collect<MutationEvent>(origin, RT_EVENTS.mutation);
    const atPeer = collect<MutationEvent>(peer, RT_EVENTS.mutation);

    publisher.emit('p1', 'tab-a', { kind: 'element.deleted', elementId: 'e1' });
    await settle();

    expect(atOrigin).toHaveLength(0);
    expect(atPeer).toHaveLength(1);
    // Peers never learn each other's client ids (L-1).
    expect(atPeer[0].originClientId).toBeNull();
  });

  it('broadcasts to everyone when the change has no origin tab (MCP, server)', async () => {
    const a = await connect({ projectId: 'p1', clientId: 'tab-a' });
    const seen = collect(a, RT_EVENTS.mutations);
    publisher.emitMany('p1', null, [
      { kind: 'element.deleted', elementId: 'e1' },
      { kind: 'element.deleted', elementId: 'e2' },
    ]);
    await settle();
    expect(seen).toHaveLength(1);
  });

  it('refuses a socket without access', async () => {
    access.resolveProjectAccess.mockRejectedValue(new ForbiddenException());
    await expect(connect({ projectId: 'p1', clientId: 'tab-x' })).rejects.toThrow();
  });

  describe('origin check', () => {
    it('refuses a handshake from a foreign origin', async () => {
      await expect(
        connect({ projectId: 'p1' }, { origin: 'https://evil.example.com' }),
      ).rejects.toThrow();
    });

    it('refuses a handshake with no origin (nothing outside the browser uses sockets)', async () => {
      await expect(connect({ projectId: 'p1' }, { origin: '' })).rejects.toThrow();
    });
  });

  describe('access revocation (M-2)', () => {
    function disconnected(socket: ClientSocket): Promise<void> {
      return new Promise((resolve) =>
        socket.connected ? socket.once('disconnect', () => resolve()) : resolve(),
      );
    }

    it('drops only the sockets that joined with a revoked token', async () => {
      const revoked = await connect({ projectId: 'p1', clientId: 'a', token: 'link-a' });
      const kept = await connect({ projectId: 'p1', clientId: 'b', token: 'link-b' });
      access.resolveProjectAccess.mockImplementation(async (_p: string, _u: unknown, t: string) => {
        if (t === 'link-a') throw new ForbiddenException();
        return 'EDIT';
      });
      const gone = disconnected(revoked);
      publisher.accessRevoked('p1', 'link-a');
      await gone;
      await settle();
      expect(revoked.connected).toBe(false);
      expect(kept.connected).toBe(true);
    });

    it('drops everyone when the project is deleted', async () => {
      const a = await connect({ projectId: 'p2', clientId: 'a' });
      const b = await connect({ projectId: 'p2', clientId: 'b' });
      const other = await connect({ projectId: 'p3', clientId: 'c' });
      access.resolveProjectAccess.mockImplementation(async (p: string) => {
        if (p === 'p2') throw new NotFoundException();
        return 'EDIT';
      });
      const gone = Promise.all([disconnected(a), disconnected(b)]);
      publisher.accessRevoked('p2');
      await gone;
      expect(other.connected).toBe(true);
    });

    it('keeps the socket when the re-check fails for another reason', async () => {
      const a = await connect({ projectId: 'p1', clientId: 'a', token: 't' });
      access.resolveProjectAccess.mockRejectedValue(new Error('database is locked'));
      publisher.accessRevoked('p1', 't');
      await settle();
      expect(a.connected).toBe(true);
    });
  });

  describe('relay validation and rate limits (M-3)', () => {
    it('drops malformed payloads', async () => {
      const sender = await connect({ projectId: 'p1', clientId: 'a' });
      const peer = await connect({ projectId: 'p1', clientId: 'b' });
      const selections = collect(peer, RT_EVENTS.selection);
      const cursors = collect(peer, RT_EVENTS.cursor);
      sender.emit(RT_EVENTS.selection, { tableIds: [{ evil: true }], relationshipIds: [] });
      sender.emit(RT_EVENTS.selection, { tableIds: Array(501).fill('t'), relationshipIds: [] });
      sender.emit(RT_EVENTS.selection, { tableIds: ['x'.repeat(65)], relationshipIds: [] });
      sender.emit(RT_EVENTS.cursor, { x: 'NaN', y: 1 });
      sender.emit(RT_EVENTS.cursor, { x: Infinity, y: 1 });
      await settle();
      expect(selections).toHaveLength(0);
      expect(cursors).toHaveLength(0);
    });

    it('caps a cursor flood at the burst size', async () => {
      const sender = await connect({ projectId: 'p1', clientId: 'a' });
      const peer = await connect({ projectId: 'p1', clientId: 'b' });
      const cursors = collect(peer, RT_EVENTS.cursor);
      for (let i = 0; i < 500; i++) sender.emit(RT_EVENTS.cursor, { x: i, y: i });
      await settle(200);
      expect(cursors.length).toBeGreaterThan(0);
      expect(cursors.length).toBeLessThanOrEqual(70); // burst 60 + refill during the test
    });

    it('coalesces a selection burst and still delivers the latest one', async () => {
      const sender = await connect({ projectId: 'p1', clientId: 'a' });
      const peer = await connect({ projectId: 'p1', clientId: 'b' });
      const selections = collect<{ tableIds: string[] }>(peer, RT_EVENTS.selection);
      for (let i = 0; i < 50; i++) {
        sender.emit(RT_EVENTS.selection, { tableIds: [`t${i}`], relationshipIds: [] });
      }
      await settle(500);
      expect(selections.length).toBeLessThan(20);
      expect(selections[selections.length - 1].tableIds).toEqual(['t49']);
    });

    it('refuses messages over the size limit', async () => {
      const sender = await connect({ projectId: 'p1', clientId: 'a' });
      const gone = new Promise<void>((resolve) => sender.once('disconnect', () => resolve()));
      sender.emit(RT_EVENTS.selection, { tableIds: ['x'.repeat(70_000)], relationshipIds: [] });
      await gone;
      expect(sender.connected).toBe(false);
    });
  });
});
