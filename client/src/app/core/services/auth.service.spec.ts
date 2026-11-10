import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import type { CurrentUserResponse } from '@devdesigner/shared';
import { ApiClientService } from './api-client.service';
import { AuthService } from './auth.service';

describe('AuthService session hydration', () => {
   const admin: CurrentUserResponse = { id: 'u1', email: 'a@x.io', displayName: null, isAdmin: true };

   function setup(user: CurrentUserResponse | null) {
      const get = jest.fn(() => of(user));
      TestBed.configureTestingModule({ providers: [{ provide: ApiClientService, useValue: { get } }] });
      return { auth: TestBed.inject(AuthService), get };
   }

   it('whenReady reuses an in-flight loadMe instead of fetching twice', async () => {
      const { auth, get } = setup(admin);
      const first = auth.loadMe();
      await auth.whenReady();
      await first;
      await auth.whenReady();
      expect(get).toHaveBeenCalledTimes(1);
      expect(auth.isAdmin$()).toBe(true);
   });

   it('whenReady starts the hydration when nothing has yet', async () => {
      const { auth, get } = setup({ ...admin, isAdmin: undefined });
      await auth.whenReady();
      expect(get).toHaveBeenCalledWith('/auth/me');
      expect(auth.ready()).toBe(true);
      expect(auth.isAdmin$()).toBe(false);
   });
});
