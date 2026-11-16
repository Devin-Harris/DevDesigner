import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Repository } from 'typeorm';
import { AccessCache, TtlLru } from './access-cache';
import { AccessService } from './access.service';
import type { EntityProjectResolver } from './entity-project-resolver';
import type { Project } from '../../projects/projects/project.entity';
import type { ShareLink } from '../sharing/share-link.entity';
import { ACCESS_CHANGED_EVENT, ACCESS_REVOKED_EVENT } from '../../platform/realtime/access-events';
import { PROJECT_MUTATION_EVENT, PROJECT_MUTATIONS_EVENT } from '@devdesigner/shared';
import { hashShareToken } from '../sharing/share-token';

describe('TtlLru', () => {
  it('expires entries and evicts the least recently used', () => {
    let now = 0;
    const lru = new TtlLru<string, number>(2, 100, () => now);
    lru.set('a', 1);
    lru.set('b', 2);
    expect(lru.get('a')).toBe(1); // a is now the most recent
    lru.set('c', 3);
    expect(lru.get('b')).toBeUndefined();
    expect(lru.get('a')).toBe(1);
    now = 101;
    expect(lru.get('a')).toBeUndefined();
  });

  it('stores nothing when the ttl is 0 (cache off)', () => {
    const lru = new TtlLru<string, number>(10, 0);
    lru.set('a', 1);
    expect(lru.get('a')).toBeUndefined();
  });
});

describe('AccessService with the access cache', () => {
  const projects = new Map<string, { id: string; ownerId: string | null }>();
  const links = new Map<string, Partial<ShareLink>>();
  const projectRepo = {
    findOne: jest.fn(async ({ where }: { where: { id: string } }) => projects.get(where.id) ?? null),
  };
  const linkRepo = {
    findOne: jest.fn(async ({ where }: { where: { tokenHash: string } }) => links.get(where.tokenHash) ?? null),
  };
  let cache: AccessCache;
  let access: AccessService;

  beforeEach(() => {
    projects.clear();
    links.clear();
    projectRepo.findOne.mockClear();
    linkRepo.findOne.mockClear();
    projects.set('p1', { id: 'p1', ownerId: 'u1' });
    links.set(hashShareToken('tok'), { tokenHash: hashShareToken('tok'), projectId: 'p1', accessLevel: 'EDIT', revokedAt: null, expiresAt: null });
    cache = new AccessCache({ get: (_k: string, d: unknown) => d } as unknown as ConfigService);
    access = new AccessService(
      projectRepo as unknown as Repository<Project>,
      linkRepo as unknown as Repository<ShareLink>,
      {} as EntityProjectResolver,
      cache,
    );
  });

  it('reads the project owner and the share link once, then serves them from memory', async () => {
    expect(await access.resolveProjectAccess('p1', 'u1')).toBe('OWNER');
    expect(await access.resolveProjectAccess('p1', null, 'tok')).toBe('EDIT');
    expect(await access.resolveProjectAccess('p1', null, 'tok')).toBe('EDIT');
    expect(projectRepo.findOne).toHaveBeenCalledTimes(1);
    expect(linkRepo.findOne).toHaveBeenCalledTimes(1);
  });

  it('a revoked link stops working at once (access.revoked)', async () => {
    expect(await access.resolveProjectAccess('p1', null, 'tok')).toBe('EDIT');
    links.set(hashShareToken('tok'), { ...links.get(hashShareToken('tok')), revokedAt: new Date() });
    cache.onAccessRevoked({ projectId: 'p1', token: 'tok' });
    await expect(access.resolveProjectAccess('p1', null, 'tok')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ownership moves and deletes take effect at once (access.revoked without a token)', async () => {
    expect(await access.resolveProjectAccess('p1', 'u1')).toBe('OWNER');
    projects.set('p1', { id: 'p1', ownerId: 'u2' });
    cache.onAccessRevoked({ projectId: 'p1' });
    await expect(access.resolveProjectAccess('p1', 'u1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(await access.resolveProjectAccess('p1', 'u2')).toBe('OWNER');
  });

  it('a link created after an unknown-token lookup is picked up (access.changed)', async () => {
    await expect(access.resolveProjectAccess('p1', null, 'new')).rejects.toBeInstanceOf(ForbiddenException);
    links.set(hashShareToken('new'), { tokenHash: hashShareToken('new'), projectId: 'p1', accessLevel: 'VIEW', revokedAt: null, expiresAt: null });
    cache.onAccessChanged({ projectId: 'p1', token: 'new' });
    expect(await access.resolveProjectAccess('p1', null, 'new')).toBe('VIEW');
  });

  it('judges expiry against the current time even for a cached link', async () => {
    links.set(hashShareToken('soon'), {
      tokenHash: hashShareToken('soon'),
      projectId: 'p1',
      accessLevel: 'VIEW',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 50),
    });
    expect(await access.resolveProjectAccess('p1', null, 'soon')).toBe('VIEW');
    await new Promise((r) => setTimeout(r, 60));
    await expect(access.resolveProjectAccess('p1', null, 'soon')).rejects.toBeInstanceOf(ForbiddenException);
    expect(linkRepo.findOne).toHaveBeenCalledTimes(1);
  });

  it('fresh lookups bypass the cache (realtime re-checks)', async () => {
    expect(await access.resolveProjectAccess('p1', null, 'tok')).toBe('EDIT');
    links.set(hashShareToken('tok'), { ...links.get(hashShareToken('tok')), revokedAt: new Date() });
    // No invalidation event yet: the cached grant still answers...
    expect(await access.resolveProjectAccess('p1', null, 'tok')).toBe('EDIT');
    // ...but a fresh re-check does not.
    await expect(access.resolveProjectAccess('p1', null, 'tok', { fresh: true })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('evicts deleted children, and every child of a project when a table or diagram goes', () => {
    cache.children.set(cache.childKey('element', 'e1'), 'p1');
    cache.children.set(cache.childKey('column', 'c1'), 'p1');
    cache.children.set(cache.childKey('column', 'c2'), 'p2');
    cache.onMutation({ projectId: 'p1', originClientId: null, mutation: { kind: 'element.deleted', elementId: 'e1' } });
    expect(cache.children.get(cache.childKey('element', 'e1'))).toBeUndefined();
    expect(cache.children.get(cache.childKey('column', 'c1'))).toBe('p1');
    cache.onMutations({
      projectId: 'p1',
      originClientId: null,
      mutations: [{ kind: 'table.deleted', tableId: 't1' }],
    });
    expect(cache.children.get(cache.childKey('column', 'c1'))).toBeUndefined();
    expect(cache.children.get(cache.childKey('column', 'c2'))).toBe('p2');
  });

  it('invalidates before any other listener of the same event', () => {
    const reflector = new Reflector();
    const events = [
      ['onAccessRevoked', ACCESS_REVOKED_EVENT],
      ['onAccessChanged', ACCESS_CHANGED_EVENT],
      ['onMutation', PROJECT_MUTATION_EVENT],
      ['onMutations', PROJECT_MUTATIONS_EVENT],
    ] as const;
    for (const [method, event] of events) {
      const meta = reflector.get('EVENT_LISTENER_METADATA', AccessCache.prototype[method]) as Array<{
        event: string;
        options: { prependListener?: boolean };
      }>;
      expect(meta).toEqual([expect.objectContaining({ event, options: expect.objectContaining({ prependListener: true }) })]);
    }
  });
});
