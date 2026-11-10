import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { callerOf } from '../platform/http/caller';
import { AccessService } from './access.service';
import {
  ACCESS_POLICY_KEY,
  type AccessPolicy,
  type RequestWithProjectAccess,
} from './access-policy.types';
import { EntityProjectResolver } from './entity-project-resolver';

/**
 * Enforces `@RequiresAccess`. Runs after the global OptionalAuthGuard (it is a
 * route-level guard), so `request.user` is already resolved. It finds the project
 * once (the :projectId itself, or the project a child id belongs to: 404 when the
 * row does not exist), resolves the caller's level with AccessService (owner,
 * guest owner or share link; 403 otherwise), checks the required level and
 * stores `{ projectId, accessLevel }` on the request for the handler.
 */
@Injectable()
export class ProjectAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
    private readonly resolver: EntityProjectResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.getAllAndOverride<AccessPolicy | undefined>(ACCESS_POLICY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!policy || policy.kind !== 'project') {
      // Only @RequiresAccess installs this guard; anything else is a wiring mistake.
      throw new Error('ProjectAccessGuard needs a @RequiresAccess policy.');
    }
    const request = context.switchToHttp().getRequest<RequestWithProjectAccess>();
    const id = request.params?.[policy.param];
    if (typeof id !== 'string' || id === '') {
      throw new NotFoundException('Not found.');
    }
    const projectId = policy.from === 'project' ? id : await this.resolver.projectIdOf(policy.from, id);
    const caller = callerOf(request);
    const accessLevel = await this.access.resolveProjectAccess(projectId, caller.ownerId, caller.shareToken);
    this.access.requireLevel(accessLevel, policy.access);
    request.projectAccess = { projectId, accessLevel };
    return true;
  }
}
