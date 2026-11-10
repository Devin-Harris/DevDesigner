import { inject } from '@angular/core';
import type { CanActivateFn, CanMatchFn } from '@angular/router';
import { AuthService } from '../auth/auth.service';

/**
 * Admin-only routes (`canMatch` and `canActivate`). Waits for the session hydration so a
 * deep link to /admin works on first load. UI gate only; the server's AdminGuard is the wall.
 */
export const adminGuard: CanMatchFn & CanActivateFn = async () => {
   const auth = inject(AuthService);
   await auth.whenReady();
   return auth.isAdmin$();
};
