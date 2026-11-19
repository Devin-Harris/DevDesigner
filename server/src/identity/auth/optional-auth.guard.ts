import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  ACCESS_POLICY_KEY,
  PROJECT_TOKEN_OK_KEY,
  type AccessPolicy,
} from '../../collaboration/access/access-policy.types';
import { AuthService } from './auth.service';
import { ApiTokenService } from './api-token.service';
import type { AuthUser } from './auth.types';

interface RequestWithUser extends Request {
  user?: AuthUser | null;
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Populates `request.user` from an `Authorization: Bearer dd_...` API token or,
 * failing that, the session cookie, and leaves it null otherwise. Anonymous
 * callers are allowed through so the app keeps working without an account
 * (owned projects are then protected in the policy layer, not here). A bearer
 * token that is present but unknown/revoked is rejected outright rather than
 * silently treated as anonymous. Read-scoped tokens may only issue safe methods;
 * project-scoped ones only reach routes for their project.
 * Registered globally via APP_GUARD.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly apiTokens: ApiTokenService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const header = request.headers.authorization;
    if (typeof header === 'string' && /^Bearer\s+/i.test(header)) {
      const user = await this.apiTokens.verify(header.replace(/^Bearer\s+/i, '').trim());
      if (!user) {
        throw new UnauthorizedException('Invalid, expired or revoked API token.');
      }
      if (user.viaToken?.scope === 'read' && !READ_METHODS.has(request.method)) {
        throw new ForbiddenException('This API token is read-only.');
      }
      if (user.viaToken?.projectId && !this.projectTokenMayCall(context)) {
        throw new ForbiddenException('This API token is limited to one project.');
      }
      request.user = user;
      return true;
    }
    request.user = this.auth.verifySession(request.headers.cookie);
    return true;
  }

  /**
   * A project-scoped token reaches routes that act on one project (ProjectAccessGuard then
   * checks it is that project), public routes, and caller routes that narrow their own
   * result to the token's project. Account-wide routes (create a project, themes, tokens,
   * admin) stay closed to it.
   */
  private projectTokenMayCall(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const policy = this.reflector.getAllAndOverride<AccessPolicy | undefined>(ACCESS_POLICY_KEY, targets);
    if (policy?.kind === 'project' || policy?.kind === 'public') return true;
    return policy?.kind === 'caller' && this.reflector.getAllAndOverride<boolean>(PROJECT_TOKEN_OK_KEY, targets) === true;
  }
}
