import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import type { AuthUser } from './auth.types';

interface RequestWithUser extends Request {
  user?: AuthUser | null;
}

/**
 * Populates `request.user` from the session cookie when a valid JWT is present,
 * and leaves it null otherwise. It never rejects: anonymous callers are allowed
 * through so the app keeps working without an account (owned projects are then
 * protected in the policy layer, not here). Registered globally via APP_GUARD.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    request.user = this.auth.verifySession(request.headers.cookie);
    return true;
  }
}
