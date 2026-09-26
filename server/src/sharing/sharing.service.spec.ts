import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { SharingService } from './sharing.service';
import type { ShareLink } from './share-link.entity';
import type { AccessService } from '../access/access.service';
import type { ProjectsService } from '../projects/projects.service';

/**
 * Unit tests for the sharing service: token generation, response shaping, and the
 * validity checks on the account-free entry route. Repositories and collaborators
 * are mocked so no database or HTTP is involved.
 */
describe('SharingService', () => {
  let shareLinks: { create: jest.Mock; save: jest.Mock; find: jest.Mock; findOne: jest.Mock };
  let access: { assertOwner: jest.Mock };
  let projects: { getGraph: jest.Mock };
  let config: { get: jest.Mock };
  let service: SharingService;

  beforeEach(() => {
    shareLinks = {
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => ({ id: 'link1', createdAt: new Date('2026-01-01T00:00:00Z'), ...v })),
      find: jest.fn(),
      findOne: jest.fn(),
    };
    access = { assertOwner: jest.fn().mockResolvedValue(undefined) };
    projects = { getGraph: jest.fn() };
    config = { get: jest.fn().mockReturnValue('https://app.example.com') };
    service = new SharingService(
      shareLinks as unknown as Repository<ShareLink>,
      access as unknown as AccessService,
      projects as unknown as ProjectsService,
      config as unknown as ConfigService,
    );
  });

  it('creates a link with a 32-char token and a full share URL', async () => {
    const response = await service.create('p1', { accessLevel: 'EDIT' }, 'owner');
    expect(access.assertOwner).toHaveBeenCalledWith('p1', 'owner');
    expect(response.token).toHaveLength(32);
    expect(response.accessLevel).toBe('EDIT');
    expect(response.url).toBe(`https://app.example.com/shared/${response.token}`);
    expect(response.revokedAt).toBeNull();
  });

  it('generates unique tokens across calls', async () => {
    const a = await service.create('p1', { accessLevel: 'VIEW' }, 'owner');
    const b = await service.create('p1', { accessLevel: 'VIEW' }, 'owner');
    expect(a.token).not.toBe(b.token);
  });

  it('resolves a valid token to the project graph', async () => {
    shareLinks.findOne.mockResolvedValue({
      token: 't',
      projectId: 'p1',
      revokedAt: null,
      expiresAt: null,
    });
    projects.getGraph.mockResolvedValue({ project: {}, schema: {}, accessLevel: 'EDIT' });
    await service.getSharedGraph('t');
    expect(projects.getGraph).toHaveBeenCalledWith('p1', null, 't');
  });

  it('rejects a revoked token on the shared entry route', async () => {
    shareLinks.findOne.mockResolvedValue({
      token: 't',
      projectId: 'p1',
      revokedAt: new Date(),
      expiresAt: null,
    });
    await expect(service.getSharedGraph('t')).rejects.toBeInstanceOf(NotFoundException);
    expect(projects.getGraph).not.toHaveBeenCalled();
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
});
