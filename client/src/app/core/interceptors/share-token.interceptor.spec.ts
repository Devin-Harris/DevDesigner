import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ShareSessionService } from '../services/share-session.service';
import { shareTokenInterceptor } from './share-token.interceptor';

describe('shareTokenInterceptor', () => {
   let http: HttpClient;
   let backend: HttpTestingController;
   let session: ShareSessionService;

   beforeEach(() => {
      TestBed.configureTestingModule({
         providers: [provideHttpClient(withInterceptors([shareTokenInterceptor])), provideHttpClientTesting()],
      });
      http = TestBed.inject(HttpClient);
      backend = TestBed.inject(HttpTestingController);
      session = TestBed.inject(ShareSessionService);
   });

   afterEach(() => backend.verify());

   function headersOf(): { clientId: string | null; guestId: string | null; token: string | null } {
      http.post('/api/x', {}).subscribe();
      const req = backend.expectOne('/api/x');
      req.flush({});
      const h = req.request.headers;
      return {
         clientId: h.get('X-Client-Id'),
         guestId: h.get('X-Guest-Id'),
         token: h.get('X-Share-Token'),
      };
   }

   it('sends no client id before the realtime socket has one', () => {
      const h = headersOf();
      expect(h.clientId).toBeNull();
      expect(h.guestId).toBe(session.guestId);
      expect(h.token).toBeNull();
   });

   it('sends the server-assigned client id and the share token once known', () => {
      session.setClientId('server-id');
      session.setToken('link');
      expect(headersOf()).toEqual({ clientId: 'server-id', guestId: session.guestId, token: 'link' });

      session.setClientId(null);
      expect(headersOf().clientId).toBeNull();
   });
});
