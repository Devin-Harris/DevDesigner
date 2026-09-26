import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { AccessService } from './access.service';
import type { Project } from '../projects/project.entity';
import type { ShareLink } from '../sharing/share-link.entity';
import type { TableEntity } from '../tables/table.entity';
import type { ColumnEntity } from '../columns/column.entity';
import type { RelationshipEntity } from '../relationships/relationship.entity';

/**
 * Unit tests for the access-resolution layer (BUILD_INSTRUCTIONS.md sections 6/7).
 * Repositories are mocked so the rules are tested in isolation with no database.
 */
describe('AccessService', () => {
  let projects: { findOne: jest.Mock };
  let shareLinks: { findOne: jest.Mock };
  let service: AccessService;

  beforeEach(() => {
    projects = { findOne: jest.fn() };
    shareLinks = { findOne: jest.fn() };
    service = new AccessService(
      projects as unknown as Repository<Project>,
      {} as unknown as Repository<TableEntity>,
      {} as unknown as Repository<ColumnEntity>,
      {} as unknown as Repository<RelationshipEntity>,
      shareLinks as unknown as Repository<ShareLink>,
    );
  });

  it('throws 404 when the project does not exist', async () => {
    projects.findOne.mockResolvedValue(null);
    await expect(service.resolveProjectAccess('p1', null)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('grants OWNER on an ownerless (anonymous-open) project', async () => {
    projects.findOne.mockResolvedValue({ id: 'p1', ownerId: null });
    await expect(service.resolveProjectAccess('p1', null)).resolves.toBe('OWNER');
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
});
