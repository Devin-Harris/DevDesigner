import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RT_EVENTS, type Participant } from '@devdesigner/shared';
import { ProjectStore } from '../../stores/project.store';
import { LaserService } from './laser.service';
import { RealtimeService } from './realtime.service';
import { ShareSessionService } from './share-session.service';

const handlers = new Map<string, (arg?: unknown) => void>();
const fakeSocket = {
   id: 'me',
   emit: jest.fn(),
   on: jest.fn((event: string, fn: (arg?: unknown) => void) => handlers.set(event, fn)),
   removeAllListeners: jest.fn(),
   disconnect: jest.fn(),
};
const mockIo = jest.fn((_url: string, _opts: { auth: Record<string, unknown> }) => fakeSocket);
jest.mock('socket.io-client', () => ({
   io: (url: string, opts: { auth: Record<string, unknown> }) => mockIo(url, opts),
}));

const person = (id: string): Participant => ({ id, name: id, color: '#000000' }) as Participant;

const store = { applyRemote: jest.fn(), applyRemoteBatch: jest.fn() };
const session = { token: signal(null), guestId: 'g', setClientId: jest.fn() };

function connect(): RealtimeService {
   TestBed.configureTestingModule({
      providers: [
         { provide: ProjectStore, useValue: store },
         { provide: LaserService, useValue: { clear: jest.fn(), pruneRemote: jest.fn() } },
         { provide: ShareSessionService, useValue: session },
      ],
   });
   const rt = TestBed.inject(RealtimeService);
   rt.connect('p1');
   handlers.get('connect')!();
   fakeSocket.emit.mockClear();
   return rt;
}

beforeEach(() => {
   handlers.clear();
   jest.clearAllMocks();
});

describe('RealtimeService presence gating', () => {
   it('sends no cursor, laser or selection while alone in the room', () => {
      const rt = connect();
      handlers.get(RT_EVENTS.roster)!([person('me')]);
      rt.sendCursor(1, 2);
      rt.sendLaser(1, 2);
      rt.sendSelection(['t1'], []);
      expect(rt.hasPeers()).toBe(false);
      expect(fakeSocket.emit).not.toHaveBeenCalled();
   });

   it('sends presence once someone else joins', () => {
      const rt = connect();
      handlers.get(RT_EVENTS.roster)!([person('me'), person('you')]);
      expect(rt.hasPeers()).toBe(true);
      rt.sendCursor(1, 2);
      rt.sendSelection(['t1'], []);
      expect(fakeSocket.emit).toHaveBeenCalledWith(RT_EVENTS.cursor, { x: 1, y: 2 });
      expect(fakeSocket.emit).toHaveBeenCalledWith(RT_EVENTS.selection, {
         tableIds: ['t1'],
         relationshipIds: [],
         columnId: undefined,
      });
   });

   it('always sends the presenting state (followers join late)', () => {
      const rt = connect();
      rt.sendPresenting('f1', 0);
      expect(fakeSocket.emit).toHaveBeenCalledWith(RT_EVENTS.present, { frameId: 'f1', step: 0 });
   });
});

describe('RealtimeService client id (L-1)', () => {
   it('stores the server-assigned id and clears it when the socket goes away', () => {
      const rt = connect();
      handlers.get(RT_EVENTS.session)!({ clientId: 'server-id' });
      expect(session.setClientId).toHaveBeenLastCalledWith('server-id');

      handlers.get('disconnect')!();
      expect(session.setClientId).toHaveBeenLastCalledWith(null);

      handlers.get(RT_EVENTS.session)!({ clientId: 'next-id' });
      rt.disconnect();
      expect(session.setClientId).toHaveBeenLastCalledWith(null);
   });

   it('does not send a client id in the handshake', () => {
      connect();
      expect(mockIo).toHaveBeenCalledTimes(1);
      expect(mockIo.mock.calls[0][1].auth).not.toHaveProperty('clientId');
   });

   it('applies every broadcast mutation (the server already skipped our own)', () => {
      connect();
      const mutation = { kind: 'element.deleted', elementId: 'e1' };
      handlers.get(RT_EVENTS.mutation)!({ projectId: 'p1', originClientId: null, mutation });
      handlers.get(RT_EVENTS.mutations)!({ projectId: 'p1', originClientId: null, mutations: [mutation] });
      expect(store.applyRemote).toHaveBeenCalledWith(mutation);
      expect(store.applyRemoteBatch).toHaveBeenCalledWith([mutation]);
   });
});
