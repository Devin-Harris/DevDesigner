import { ForbiddenException, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Repository } from 'typeorm';
import { AccessService } from './access.service';
import { ACCESS_POLICY_KEY, type AccessPolicy, type RequiredAccess } from './access-policy';
import type { EntityProjectResolver, ProjectEntityKind } from './entity-project-resolver';
import { ProjectAccessGuard } from './project-access.guard';
import type { Project } from '../../projects/projects/project.entity';
import type { ShareLink } from '../sharing/share-link.entity';
import type { ConfigService } from '@nestjs/config';
import { AccessCache } from './access-cache';

/**
 * ProjectAccessGuard with the real AccessService rules (repositories mocked):
 * the project is resolved once (directly or from a child id), the caller's level
 * is checked against the route's requirement, and the result lands on the request.
 */
describe('ProjectAccessGuard', () => {
  const projects = new Map<string, { id: string; ownerId: string | null }>();
  const links = new Map<string, Partial<ShareLink>>();
  /** child id -> project id, as the resolver registry would answer. */
  const children = new Map<string, string>();

  const access = new AccessService(
    { findOne: jest.fn(async ({ where }: { where: { id: string } }) => projects.get(where.id) ?? null) } as unknown as Repository<Project>,
    { findOne: jest.fn(async ({ where }: { where: { token: string } }) => links.get(where.token) ?? null) } as unknown as Repository<ShareLink>,
    {} as EntityProjectResolver,
    new AccessCache({ get: () => 0 } as unknown as ConfigService),
  );
  const resolver = {
    projectIdOf: jest.fn(async (kind: ProjectEntityKind, id: string) => {
      const projectId = children.get(id);
      if (!projectId) throw new NotFoundException(`${kind} ${id} not found.`);
      return projectId;
    }),
  };
  const guard = new ProjectAccessGuard(new Reflector(), access, resolver as unknown as EntityProjectResolver);

  /** A fake route handler carrying the policy metadata, plus its request. */
  function context(
    required: RequiredAccess,
    from: ProjectEntityKind,
    params: Record<string, string>,
    headers: Record<string, string> = {},
    user: { id: string } | null = null,
  ): { ctx: ExecutionContext; req: Record<string, unknown> } {
    const handler = (): void => undefined;
    const param = Object.keys(params)[0];
    Reflect.defineMetadata(ACCESS_POLICY_KEY, { kind: 'project', access: required, from, param } satisfies AccessPolicy, handler);
    const req: Record<string, unknown> = { params, headers, user };
    const ctx = {
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    return { ctx, req };
  }

  beforeEach(() => {
    projects.clear();
    links.clear();
    children.clear();
    resolver.projectIdOf.mockClear();
    projects.set('A', { id: 'A', ownerId: 'alice' });
    projects.set('B', { id: 'B', ownerId: 'bob' });
    projects.set('G', { id: 'G', ownerId: 'guest:browser-guest-0001' });
    children.set('tableA', 'A');
    children.set('tableB', 'B');
    links.set('edit-A', { token: 'edit-A', projectId: 'A', accessLevel: 'EDIT', revokedAt: null, expiresAt: null });
    links.set('view-A', { token: 'view-A', projectId: 'A', accessLevel: 'VIEW', revokedAt: null, expiresAt: null });
    links.set('revoked-A', { token: 'revoked-A', projectId: 'A', accessLevel: 'EDIT', revokedAt: new Date(), expiresAt: null });
    links.set('expired-A', {
      token: 'expired-A',
      projectId: 'A',
      accessLevel: 'EDIT',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });
  });

  it('lets the owner write and records the resolved project on the request', async () => {
    const { ctx, req } = context('write', 'project', { projectId: 'A' }, {}, { id: 'alice' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.projectAccess).toEqual({ projectId: 'A', accessLevel: 'OWNER' });
    expect(resolver.projectIdOf).not.toHaveBeenCalled();
  });

  it('treats a guest id as the owner of its guest projects', async () => {
    const { ctx, req } = context('owner', 'project', { projectId: 'G' }, { 'x-guest-id': 'browser-guest-0001' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.projectAccess).toEqual({ projectId: 'G', accessLevel: 'OWNER' });
  });

  it('resolves a child id to its project once', async () => {
    const { ctx, req } = context('write', 'table', { tableId: 'tableA' }, {}, { id: 'alice' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(resolver.projectIdOf).toHaveBeenCalledTimes(1);
    expect(resolver.projectIdOf).toHaveBeenCalledWith('table', 'tableA');
    expect(req.projectAccess).toEqual({ projectId: 'A', accessLevel: 'OWNER' });
  });

  it('refuses a child id from a project the caller cannot access (cross-project id)', async () => {
    const { ctx, req } = context('write', 'table', { tableId: 'tableB' }, {}, { id: 'alice' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    expect(req.projectAccess).toBeUndefined();
  });

  it("refuses an EDIT link for project A on project B's child", async () => {
    const { ctx } = context('write', 'table', { tableId: 'tableB' }, { 'x-share-token': 'edit-A' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('answers 404 for an unknown child id or project', async () => {
    await expect(
      guard.canActivate(context('write', 'table', { tableId: 'nope' }, {}, { id: 'alice' }).ctx),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      guard.canActivate(context('read', 'project', { projectId: 'nope' }, {}, { id: 'alice' }).ctx),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a stranger with no link', async () => {
    const { ctx } = context('read', 'project', { projectId: 'A' }, {}, { id: 'mallory' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets a VIEW link read but not write', async () => {
    const read = context('read', 'project', { projectId: 'A' }, { 'x-share-token': 'view-A' });
    await expect(guard.canActivate(read.ctx)).resolves.toBe(true);
    expect(read.req.projectAccess).toEqual({ projectId: 'A', accessLevel: 'VIEW' });

    const write = context('write', 'project', { projectId: 'A' }, { 'x-share-token': 'view-A' });
    await expect(guard.canActivate(write.ctx)).rejects.toThrow('This link is read-only.');
    const child = context('write', 'table', { tableId: 'tableA' }, { 'x-share-token': 'view-A' });
    await expect(guard.canActivate(child.ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets an EDIT link write but not do owner actions', async () => {
    const write = context('write', 'project', { projectId: 'A' }, { 'x-share-token': 'edit-A' });
    await expect(guard.canActivate(write.ctx)).resolves.toBe(true);
    const owner = context('owner', 'project', { projectId: 'A' }, { 'x-share-token': 'edit-A' });
    await expect(guard.canActivate(owner.ctx)).rejects.toThrow('Only the project owner');
  });

  it('refuses revoked and expired links', async () => {
    for (const token of ['revoked-A', 'expired-A']) {
      const { ctx } = context('read', 'project', { projectId: 'A' }, { 'x-share-token': token });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('refuses a link for another project', async () => {
    const { ctx } = context('read', 'project', { projectId: 'B' }, { 'x-share-token': 'edit-A' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
