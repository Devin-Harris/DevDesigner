import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { ApiTokenService } from './api-token.service';
import type { AuthUser } from './auth.types';

interface RequestWithUser extends Request {
  user?: AuthUser | null;
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Populates `request.user` from an `Authorization: Bearer dbd_...` API token or,
 * failing that, the session cookie, and leaves it null otherwise. Anonymous
 * callers are allowed through so the app keeps working without an account
 * (owned projects are then protected in the policy layer, not here). A bearer
 * token that is present but unknown/revoked is rejected outright rather than
 * silently treated as anonymous. Read-scoped tokens may only issue safe methods.
 * Registered globally via APP_GUARD.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly apiTokens: ApiTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const header = request.headers.authorization;
    if (typeof header === 'string' && /^Bearer\s+/i.test(header)) {
      const user = await this.apiTokens.verify(header.replace(/^Bearer\s+/i, '').trim());
      if (!user) {
        throw new UnauthorizedException('Invalid or revoked API token.');
      }
      if (user.viaToken?.scope === 'read' && !READ_METHODS.has(request.method)) {
        throw new ForbiddenException('This API token is read-only.');
      }
      request.user = user;
      return true;
    }
    request.user = this.auth.verifySession(request.headers.cookie);
    return true;
  }
}
