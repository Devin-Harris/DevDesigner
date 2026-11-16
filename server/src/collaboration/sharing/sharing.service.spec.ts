import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { SharingService } from './sharing.service';
import { hashShareToken, isHashedShareToken } from './share-token';
import type { ShareLink } from './share-link.entity';
import type { AccessService } from '../access/access.service';
import type { GraphLoaderService } from '../../projects/common/graph-loader.service';
import type { RealtimePublisher } from '../../platform/realtime/realtime.publisher';

/**
 * Unit tests for the sharing service: token generation, response shaping, and the
 * validity checks on the account-free entry route. Repositories and collaborators
 * are mocked so no database or HTTP is involved.
 */
describe('SharingService', () => {
  let shareLinks: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };
  let access: { assertCanRead: jest.Mock; shareLink: jest.Mock };
  let projects: { graph: jest.Mock };
  let config: { get: jest.Mock };
  let realtime: { accessRevoked: jest.Mock; accessChanged: jest.Mock };
  let service: SharingService;

  beforeEach(() => {
    shareLinks = {
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => ({ id: 'link1', createdAt: new Date('2026-01-01T00:00:00Z'), ...v })),
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    access = {
      assertCanRead: jest.fn().mockResolvedValue('EDIT'),
      // The real AccessService reads the link through its cache; here straight from the repo mock.
      shareLink: jest.fn(async (token: string) => {
        const row = (await shareLinks.findOne({ where: { token } })) as Partial<ShareLink> | null;
        return row
          ? {
              projectId: row.projectId,
              accessLevel: row.accessLevel,
              expiresAt: row.expiresAt ? row.expiresAt.getTime() : null,
              revoked: row.revokedAt != null,
            }
          : null;
      }),
    };
    projects = { graph: jest.fn() };
    config = { get: jest.fn().mockReturnValue('https://app.example.com') };
    realtime = { accessRevoked: jest.fn(), accessChanged: jest.fn() };
    service = new SharingService(
      shareLinks as unknown as Repository<ShareLink>,
      access as unknown as AccessService,
      projects as unknown as GraphLoaderService,
      config as unknown as ConfigService,
      realtime as unknown as RealtimePublisher,
    );
  });

  it('creates a link with a 32-char token and a full share URL', async () => {
    const response = await service.create('p1', { accessLevel: 'EDIT' });
    expect(response.token).toHaveLength(32);
    expect(response.accessLevel).toBe('EDIT');
    expect(response.url).toBe(`https://app.example.com/shared/${response.token}`);
    expect(response.revokedAt).toBeNull();
    // The access cache forgets what it knew about the project's links.
    expect(realtime.accessChanged).toHaveBeenCalledWith('p1');
  });

  it('stores only the hash and a sealed copy of the token', async () => {
    const response = await service.create('p1', { accessLevel: 'VIEW' });
    const stored = shareLinks.create.mock.calls[0][0] as Partial<ShareLink>;
    expect(stored.tokenHash).toBe(hashShareToken(response.token!));
    expect(stored.tokenSealed).not.toContain(response.token);
    // Listing unseals it again for the owner.
    shareLinks.find.mockResolvedValue([{ ...stored, id: 'l1', createdAt: new Date() }]);
    const [listed] = await service.list('p1');
    expect(listed.token).toBe(response.token);
    expect(listed.url).toBe(`https://app.example.com/shared/${response.token}`);
  });

  it('lists a link sealed under another secret without its URL', async () => {
    shareLinks.find.mockResolvedValue([
      { id: 'l1', tokenHash: hashShareToken('x'), tokenSealed: 'v1.bad.bad.bad', accessLevel: 'VIEW', createdAt: new Date(), expiresAt: null, revokedAt: null },
    ]);
    const [listed] = await service.list('p1');
    expect(listed.token).toBeNull();
    expect(listed.url).toBeNull();
  });

  it('hashes plaintext tokens left from before hashing, once', async () => {
    const plain = 'A'.repeat(32);
    shareLinks.find.mockResolvedValue([
      { id: 'old', tokenHash: plain },
      { id: 'new', tokenHash: hashShareToken('b') },
    ]);
    expect(await service.hashPlaintextTokens()).toBe(1);
    expect(shareLinks.update).toHaveBeenCalledTimes(1);
    const [where, patch] = shareLinks.update.mock.calls[0] as [unknown, Partial<ShareLink>];
    expect(where).toEqual({ id: 'old' });
    expect(patch.tokenHash).toBe(hashShareToken(plain));
    expect(isHashedShareToken(patch.tokenHash!)).toBe(true);
    shareLinks.find.mockResolvedValue([{ ...patch, id: 'old', createdAt: new Date() }]);
    const [listed] = await service.list('p1');
    expect(listed.token).toBe(plain);
  });

  it('generates unique tokens across calls', async () => {
    const a = await service.create('p1', { accessLevel: 'VIEW' });
    const b = await service.create('p1', { accessLevel: 'VIEW' });
    expect(a.token).not.toBe(b.token);
  });

  it('resolves a valid token to the project graph', async () => {
    shareLinks.findOne.mockResolvedValue({
      token: 't',
      projectId: 'p1',
      revokedAt: null,
      expiresAt: null,
    });
    projects.graph.mockResolvedValue({ project: {}, schema: {}, accessLevel: 'EDIT' });
    await service.getSharedGraph('t');
    expect(access.assertCanRead).toHaveBeenCalledWith('p1', null, 't');
    expect(projects.graph).toHaveBeenCalledWith('p1', 'EDIT');
  });

  it('rejects a revoked token on the shared entry route', async () => {
    shareLinks.findOne.mockResolvedValue({
      token: 't',
      projectId: 'p1',
      revokedAt: new Date(),
      expiresAt: null,
    });
    await expect(service.getSharedGraph('t')).rejects.toBeInstanceOf(NotFoundException);
    expect(projects.graph).not.toHaveBeenCalled();
  });

  it('rejects an expired token on the shared entry route', async () => {
    shareLinks.findOne.mockResolvedValue({
      token: 't',
      projectId: 'p1',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(service.getSharedGraph('t')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects an unknown token', async () => {
    shareLinks.findOne.mockResolvedValue(null);
    await expect(service.getSharedGraph('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('revoking a link re-checks the project sockets', async () => {
    await service.revoke('p1', 'link1');
    expect(shareLinks.update).toHaveBeenCalledWith(
      { id: 'link1', projectId: 'p1' },
      { revokedAt: expect.any(Date) },
    );
    expect(realtime.accessRevoked).toHaveBeenCalledWith('p1');
  });

  it('revoking an unknown link is a 404 and drops nobody', async () => {
    shareLinks.update.mockResolvedValue({ affected: 0 });
    await expect(service.revoke('p1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
    expect(realtime.accessRevoked).not.toHaveBeenCalled();
  });
});
