import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { AccessService, bindingRefs } from './access.service';
import type { EntityProjectResolver } from './entity-project-resolver';
import type { Project } from '../projects/project.entity';
import type { ShareLink } from '../sharing/share-link.entity';

/**
 * Unit tests for the access-resolution layer (BUILD_INSTRUCTIONS.md sections 6/7).
 * Repositories are mocked so the rules are tested in isolation with no database.
 */
describe('AccessService', () => {
  let projects: { findOne: jest.Mock };
  let shareLinks: { findOne: jest.Mock };
  let service: AccessService;
  const resolver = {
    idsOutsideProject: jest.fn(async (_kind: string, ids: string[]) => ids.filter((id) => id.startsWith('other-'))),
    labelOf: (kind: string) => kind,
  };

  beforeEach(() => {
    projects = { findOne: jest.fn() };
    shareLinks = { findOne: jest.fn() };
    service = new AccessService(
      projects as unknown as Repository<Project>,
      shareLinks as unknown as Repository<ShareLink>,
      resolver as unknown as EntityProjectResolver,
    );
  });

  it('throws 404 when the project does not exist', async () => {
    projects.findOne.mockResolvedValue(null);
    await expect(service.resolveProjectAccess('p1', null)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('readProject returns the full row with the level from a single read', async () => {
    const row = { id: 'p1', ownerId: 'u1', name: 'P', themesJson: null };
    projects.findOne.mockResolvedValue(row);
    await expect(service.readProject('p1', 'u1')).resolves.toEqual({
      project: row,
      accessLevel: 'OWNER',
    });
    expect(projects.findOne).toHaveBeenCalledTimes(1);
    expect(projects.findOne).toHaveBeenCalledWith({ where: { id: 'p1' } });
  });

  it('readProject applies the same rules (403 for a stranger)', async () => {
    projects.findOne.mockResolvedValue({ id: 'p1', ownerId: 'u1' });
    await expect(service.readProject('p1', 'u2')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('grants nothing on an ownerless (quarantined) project, links included (security M-1)', async () => {
    projects.findOne.mockResolvedValue({ id: 'p1', ownerId: null });
    shareLinks.findOne.mockResolvedValue({
      token: 't',
      projectId: 'p1',
      accessLevel: 'EDIT',
      revokedAt: null,
      expiresAt: null,
    });
    await expect(service.resolveProjectAccess('p1', null)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.resolveProjectAccess('p1', 'u1', 't')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('grants OWNER to the project owner', async () => {
    projects.findOne.mockResolvedValue({ id: 'p1', ownerId: 'u1' });
    await expect(service.resolveProjectAccess('p1', 'u1')).resolves.toBe('OWNER');
  });

  it('rejects a non-owner with no token', async () => {
    projects.findOne.mockResolvedValue({ id: 'p1', ownerId: 'u1' });
    await expect(service.resolveProjectAccess('p1', 'u2')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('grants the token level for a valid share token', async () => {
    projects.findOne.mockResolvedValue({ id: 'p1', ownerId: 'u1' });
    shareLinks.findOne.mockResolvedValue({
      token: 't',
      projectId: 'p1',
      accessLevel: 'EDIT',
      revokedAt: null,
      expiresAt: null,
    });
    await expect(service.resolveProjectAccess('p1', null, 't')).resolves.toBe('EDIT');
  });

  it('rejects a revoked token', async () => {
    projects.findOne.mockResolvedValue({ id: 'p1', ownerId: 'u1' });
    shareLinks.findOne.mockResolvedValue({
      token: 't',
      projectId: 'p1',
      accessLevel: 'VIEW',
      revokedAt: new Date(),
      expiresAt: null,
    });
    await expect(service.resolveProjectAccess('p1', null, 't')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects an expired token', async () => {
    projects.findOne.mockResolvedValue({ id: 'p1', ownerId: 'u1' });
    shareLinks.findOne.mockResolvedValue({
      token: 't',
      projectId: 'p1',
      accessLevel: 'VIEW',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(service.resolveProjectAccess('p1', null, 't')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects a token issued for a different project', async () => {
    projects.findOne.mockResolvedValue({ id: 'p1', ownerId: 'u1' });
    shareLinks.findOne.mockResolvedValue({
      token: 't',
      projectId: 'other',
      accessLevel: 'EDIT',
      revokedAt: null,
      expiresAt: null,
    });
    await expect(service.resolveProjectAccess('p1', null, 't')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  describe('assertCanWrite', () => {
    it('rejects a VIEW token with 403', async () => {
      projects.findOne.mockResolvedValue({ id: 'p1', ownerId: 'u1' });
      shareLinks.findOne.mockResolvedValue({
        token: 't',
        projectId: 'p1',
        accessLevel: 'VIEW',
        revokedAt: null,
        expiresAt: null,
      });
      await expect(service.assertCanWrite('p1', null, 't')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('allows an EDIT token', async () => {
      projects.findOne.mockResolvedValue({ id: 'p1', ownerId: 'u1' });
      shareLinks.findOne.mockResolvedValue({
        token: 't',
        projectId: 'p1',
        accessLevel: 'EDIT',
        revokedAt: null,
        expiresAt: null,
      });
      await expect(service.assertCanWrite('p1', null, 't')).resolves.toBe('EDIT');
    });
  });

  describe('assertOwner', () => {
    it('rejects an EDIT token holder', async () => {
      projects.findOne.mockResolvedValue({ id: 'p1', ownerId: 'u1' });
      shareLinks.findOne.mockResolvedValue({
        token: 't',
        projectId: 'p1',
        accessLevel: 'EDIT',
        revokedAt: null,
        expiresAt: null,
      });
      await expect(service.assertOwner('p1', null, 't')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('assertIdsInProject (security L-7)', () => {
    it('passes when every id is in the project and ignores empty refs', async () => {
      await expect(service.assertIdsInProject('lifeline', ['a', null, undefined, ''], 'p1')).resolves.toBeUndefined();
      await expect(service.assertIdsInProject('lifeline', [null], 'p1')).resolves.toBeUndefined();
      expect(resolver.idsOutsideProject).toHaveBeenCalledTimes(1);
    });

    it('refuses ids of another project with 400', async () => {
      await expect(service.assertIdsInProject('column', ['a', 'other-1'], 'p1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('checks arrow bindings by their target kind', async () => {
      await expect(
        service.assertRefsInProject(bindingRefs({ targetKind: 'table', targetId: 'other-t' }), 'p1'),
      ).rejects.toThrow('table other-t is not part of this project.');
      expect(resolver.idsOutsideProject).toHaveBeenLastCalledWith('table', ['other-t'], 'p1');
    });
  });
});
