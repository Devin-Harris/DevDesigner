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
jest.mock('socket.io-client', () => ({ io: () => fakeSocket }));

const person = (id: string): Participant => ({ id, name: id, color: '#000000' }) as Participant;

describe('RealtimeService presence gating', () => {
   function connect(): RealtimeService {
      TestBed.configureTestingModule({
         providers: [
            { provide: ProjectStore, useValue: {} },
            { provide: LaserService, useValue: { clear: jest.fn(), pruneRemote: jest.fn() } },
            { provide: ShareSessionService, useValue: { token: signal(null), clientId: 'c', guestId: 'g' } },
         ],
      });
      const rt = TestBed.inject(RealtimeService);
      rt.connect('p1');
      handlers.get('connect')!();
      fakeSocket.emit.mockClear();
      return rt;
   }

   beforeEach(() => handlers.clear());

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
