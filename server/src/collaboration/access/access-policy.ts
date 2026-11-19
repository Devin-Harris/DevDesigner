import {
  applyDecorators,
  createParamDecorator,
  SetMetadata,
  UseGuards,
  type ExecutionContext,
} from '@nestjs/common';
import type { ProjectEntityKind } from './entity-project-resolver';
import {
  ACCESS_POLICY_KEY,
  PROJECT_TOKEN_OK_KEY,
  type AccessPolicy,
  type RequestWithProjectAccess,
  type RequiredAccess,
  type ResolvedProjectAccess,
} from './access-policy.types';
import { ProjectAccessGuard } from './project-access.guard';

export * from './access-policy.types';

/**
 * Declarative authorization (security S2.4 / cleanliness C4.3).
 *
 * Every controller handler declares exactly one policy, checked by a spec
 * (access-policy.spec.ts) so a new route cannot ship without one:
 *  - `@RequiresAccess(level, { from, param })`: the route acts on one project.
 *    ProjectAccessGuard resolves that project ONCE (directly from a :projectId,
 *    or from a child id through the entity -> project registry), checks the
 *    caller's level and leaves `{ projectId, accessLevel }` on the request
 *    (read it with `@ProjectAccess()`). Services trust it and do no auth.
 *  - `@Public()`: no caller needed (health, login, the share-token entry point,
 *    which authorizes by the token itself).
 *  - `@CallerScoped()`: the route only touches the caller's own data (their
 *    project list, guest claim, API tokens, theme library); the service scopes
 *    every query by the caller's owner id.
 *  - `@AdminRoute()`: behind AdminGuard (the admin API), never project data.
 */

/** Default route parameter holding the id for each source. */
const DEFAULT_PARAM: Record<ProjectEntityKind, string> = {
  project: 'projectId',
  table: 'tableId',
  column: 'columnId',
  index: 'indexId',
  relationship: 'relationshipId',
  element: 'elementId',
  image: 'imageId',
  diagram: 'diagramId',
  lifeline: 'lifelineId',
  message: 'messageId',
};

/**
 * Require `access` on the project that `param` (an id of kind `from`) belongs to.
 * `read`: any level; `write`: EDIT or OWNER (a VIEW link gets 403); `owner`: OWNER only.
 */
export function RequiresAccess(
  access: RequiredAccess,
  options: { from?: ProjectEntityKind; param?: string } = {},
): MethodDecorator & ClassDecorator {
  const from = options.from ?? 'project';
  const policy: AccessPolicy = { kind: 'project', access, from, param: options.param ?? DEFAULT_PARAM[from] };
  return applyDecorators(SetMetadata(ACCESS_POLICY_KEY, policy), UseGuards(ProjectAccessGuard));
}

/** The route needs no caller at all. */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ACCESS_POLICY_KEY, { kind: 'public' } satisfies AccessPolicy);

/** The route only reads or writes the caller's own data, scoped by their owner id. */
export const CallerScoped = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ACCESS_POLICY_KEY, { kind: 'caller' } satisfies AccessPolicy);

/**
 * A `@CallerScoped` route that a project-scoped API token may call, because the handler
 * narrows what it returns to the token's project (e.g. the project list).
 */
export const ProjectTokenOk = (): MethodDecorator & ClassDecorator => SetMetadata(PROJECT_TOKEN_OK_KEY, true);

/** The route sits behind AdminGuard (declare it next to `@UseGuards(AdminGuard)`). */
export const AdminRoute = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ACCESS_POLICY_KEY, { kind: 'admin' } satisfies AccessPolicy);

/** Inject what ProjectAccessGuard resolved (only on `@RequiresAccess` routes). */
export const ProjectAccess = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ResolvedProjectAccess => {
    const resolved = ctx.switchToHttp().getRequest<RequestWithProjectAccess>().projectAccess;
    if (!resolved) {
      // A programming error: the handler is missing @RequiresAccess.
      throw new Error('@ProjectAccess() used on a route without @RequiresAccess.');
    }
    return resolved;
  },
);
