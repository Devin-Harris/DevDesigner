import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
   ActivatedRouteSnapshot,
   CanActivateFn,
   CanMatchFn,
   Route,
   RouterStateSnapshot,
   UrlSegment,
} from '@angular/router';
import type { CurrentUserResponse } from '@devdesigner/shared';
import { AuthService } from '../services/auth.service';
import { adminGuard } from './admin.guard';

function setup(user: CurrentUserResponse | null, ready = true) {
   const currentUser = signal<CurrentUserResponse | null>(ready ? user : null);
   const whenReady = jest.fn(async () => {
      currentUser.set(user);
   });
   const auth = {
      whenReady,
      isAdmin$: () => currentUser()?.isAdmin === true,
   } as unknown as AuthService;
   TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: auth }] });
   return { whenReady };
}

type MatchSnapshot = Parameters<CanMatchFn>[2];

const canMatch = () =>
   TestBed.runInInjectionContext(() =>
      (adminGuard as CanMatchFn)({} as Route, [] as UrlSegment[], {} as MatchSnapshot)
   ) as Promise<boolean>;
const canActivate = () =>
   TestBed.runInInjectionContext(() =>
      (adminGuard as CanActivateFn)({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
   ) as Promise<boolean>;

describe('adminGuard', () => {
   const base = { id: 'u1', email: 'a@x.io', displayName: null };

   it('matches for an admin', async () => {
      setup({ ...base, isAdmin: true });
      await expect(canMatch()).resolves.toBe(true);
      await expect(canActivate()).resolves.toBe(true);
   });

   it('does not match for a signed-in non-admin', async () => {
      setup(base);
      await expect(canMatch()).resolves.toBe(false);
   });

   it('does not match for an anonymous visitor', async () => {
      setup(null);
      await expect(canMatch()).resolves.toBe(false);
   });

   it('waits for the session hydration before deciding (deep link on first load)', async () => {
      const { whenReady } = setup({ ...base, isAdmin: true }, false);
      await expect(canMatch()).resolves.toBe(true);
      expect(whenReady).toHaveBeenCalled();
   });
});
