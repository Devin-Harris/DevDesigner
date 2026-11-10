import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ACCESS_POLICY_KEY, type AccessPolicy } from './access-policy';
import { ProjectAccessGuard } from './project-access.guard';

/**
 * Every route must declare its authorization (security S2.4). This spec loads every
 * controller under src/, lists its routes and compares each one's policy with the
 * table below, so a new route without `@RequiresAccess` / `@Public` / `@CallerScoped`
 * / `@AdminRoute` fails here, and so does a silently loosened one.
 *
 * Notation: `write:table(tableId)` = write access to the project that the table in
 * :tableId belongs to; `owner:project(projectId)` = owner of :projectId.
 */
const EXPECTED: Record<string, string> = {
  // auth
  'POST /auth/register': 'public',
  'POST /auth/login': 'public',
  'POST /auth/logout': 'public',
  'GET /auth/me': 'public',
  'GET /auth/api-tokens': 'caller',
  'POST /auth/api-tokens': 'caller',
  'DELETE /auth/api-tokens/:tokenId': 'caller',
  // health, admin
  'GET /health': 'public',
  'GET /health/ready': 'public',
  'GET /admin/ping': 'admin',
  // projects
  'GET /projects': 'caller',
  'POST /projects': 'caller',
  'GET /projects/guest-count': 'caller',
  'POST /projects/claim-guest': 'caller',
  'POST /projects/import': 'caller',
  'POST /projects/:projectId/import-content': 'write:project(projectId)',
  'GET /projects/:projectId/export-file': 'read:project(projectId)',
  'GET /projects/:projectId': 'read:project(projectId)',
  'PATCH /projects/:projectId': 'owner:project(projectId)',
  'PATCH /projects/:projectId/viewport': 'write:project(projectId)',
  'PATCH /projects/:projectId/home': 'write:project(projectId)',
  'PUT /projects/:projectId/themes': 'write:project(projectId)',
  'POST /projects/:projectId/duplicate': 'owner:project(projectId)',
  'DELETE /projects/:projectId': 'owner:project(projectId)',
  'GET /projects/:projectId/export': 'read:project(projectId)',
  // tables / columns / indexes / relationships
  'POST /projects/:projectId/tables': 'write:project(projectId)',
  'PATCH /tables/:tableId': 'write:table(tableId)',
  'PATCH /tables/:tableId/position': 'write:table(tableId)',
  'DELETE /tables/:tableId': 'write:table(tableId)',
  'POST /tables/:tableId/columns': 'write:table(tableId)',
  'PATCH /tables/:tableId/columns/reorder': 'write:table(tableId)',
  'PATCH /columns/:columnId': 'write:column(columnId)',
  'DELETE /columns/:columnId': 'write:column(columnId)',
  'POST /tables/:tableId/indexes': 'write:table(tableId)',
  'PATCH /tables/:tableId/indexes/reorder': 'write:table(tableId)',
  'PATCH /indexes/:indexId': 'write:index(indexId)',
  'DELETE /indexes/:indexId': 'write:index(indexId)',
  'POST /projects/:projectId/relationships': 'write:project(projectId)',
  'PATCH /relationships/:relationshipId': 'write:relationship(relationshipId)',
  'DELETE /relationships/:relationshipId': 'write:relationship(relationshipId)',
  // canvas
  'POST /projects/:projectId/elements': 'write:project(projectId)',
  'PATCH /projects/:projectId/elements/reorder': 'write:project(projectId)',
  'PATCH /elements/:elementId': 'write:element(elementId)',
  'PATCH /elements/:elementId/position': 'write:element(elementId)',
  'DELETE /elements/:elementId': 'write:element(elementId)',
  'POST /projects/:projectId/images': 'write:project(projectId)',
  'GET /images/:imageId': 'read:image(imageId)',
  // sequence (children are additionally scoped `where { id, projectId }` in the service)
  'POST /projects/:projectId/sequence-diagrams': 'write:project(projectId)',
  'PATCH /projects/:projectId/sequence-diagrams/:diagramId': 'write:project(projectId)',
  'DELETE /projects/:projectId/sequence-diagrams/:diagramId': 'write:project(projectId)',
  'POST /projects/:projectId/lifelines': 'write:project(projectId)',
  'PATCH /projects/:projectId/lifelines/:lifelineId': 'write:project(projectId)',
  'PATCH /projects/:projectId/lifelines/:lifelineId/position': 'write:project(projectId)',
  'DELETE /projects/:projectId/lifelines/:lifelineId': 'write:project(projectId)',
  'POST /projects/:projectId/messages': 'write:project(projectId)',
  'PATCH /projects/:projectId/messages/:messageId': 'write:project(projectId)',
  'PATCH /projects/:projectId/messages/:messageId/position': 'write:project(projectId)',
  'DELETE /projects/:projectId/messages/:messageId': 'write:project(projectId)',
  // batch
  'PATCH /projects/:projectId/batch': 'write:project(projectId)',
  'POST /projects/:projectId/clone': 'write:project(projectId)',
  // sharing
  'POST /projects/:projectId/share': 'owner:project(projectId)',
  'GET /projects/:projectId/share': 'owner:project(projectId)',
  'DELETE /projects/:projectId/share/:linkId': 'owner:project(projectId)',
  'GET /shared/:token': 'public',
  // user themes
  'GET /me/themes': 'caller',
  'POST /me/themes': 'caller',
  'DELETE /me/themes/:id': 'caller',
};

type Ctor = new (...args: never[]) => unknown;

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return controllerFiles(full);
    return name.endsWith('.controller.ts') ? [full] : [];
  });
}

function joinPath(...parts: string[]): string {
  return (
    '/' +
    parts
      .flatMap((p) => p.split('/'))
      .filter(Boolean)
      .join('/')
  );
}

function describePolicy(policy: AccessPolicy | undefined): string {
  if (!policy) return 'MISSING';
  if (policy.kind !== 'project') return policy.kind;
  return `${policy.access}:${policy.from}(${policy.param})`;
}

interface Route {
  key: string;
  policy: string;
  guarded: boolean;
  file: string;
}

function collectRoutes(): Route[] {
  const root = join(__dirname, '..');
  const routes: Route[] = [];
  for (const file of controllerFiles(root)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(file) as Record<string, unknown>;
    for (const exported of Object.values(mod)) {
      if (typeof exported !== 'function') continue;
      const ctor = exported as Ctor;
      const base = Reflect.getMetadata(PATH_METADATA, ctor) as string | undefined;
      if (base === undefined) continue; // not a controller
      const classPolicy = Reflect.getMetadata(ACCESS_POLICY_KEY, ctor) as AccessPolicy | undefined;
      for (const name of Object.getOwnPropertyNames(ctor.prototype)) {
        if (name === 'constructor') continue;
        const handler = (ctor.prototype as Record<string, unknown>)[name] as object;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        if (path === undefined) continue; // helper, not a route
        const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
        const policy = (Reflect.getMetadata(ACCESS_POLICY_KEY, handler) as AccessPolicy | undefined) ?? classPolicy;
        const guards = [
          ...((Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[]) ?? []),
          ...((Reflect.getMetadata(GUARDS_METADATA, ctor) as unknown[]) ?? []),
        ];
        routes.push({
          key: `${method} ${joinPath(base, path)}`,
          policy: describePolicy(policy),
          guarded: guards.includes(ProjectAccessGuard),
          file: relative(root, file),
        });
      }
    }
  }
  return routes;
}

describe('route access policies', () => {
  const routes = collectRoutes();

  it('finds the controllers', () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it('every route declares a policy', () => {
    const missing = routes.filter((r) => r.policy === 'MISSING').map((r) => `${r.key} (${r.file})`);
    expect(missing).toEqual([]);
  });

  it('every route matches the reviewed route -> access table', () => {
    const actual = Object.fromEntries(routes.map((r) => [r.key, r.policy]));
    expect(actual).toEqual(EXPECTED);
  });

  it('every project route is actually guarded by ProjectAccessGuard', () => {
    const unguarded = routes.filter((r) => r.policy.includes(':') && !r.guarded).map((r) => r.key);
    expect(unguarded).toEqual([]);
  });
});
