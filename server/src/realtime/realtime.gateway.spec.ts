import type { INestApplication } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
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
    expect(atPeer[0].originClientId).toBe('tab-a');
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
});
