import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AccessLevel } from '@devdesigner/shared';
import { Project } from '../projects/project.entity';
import { ShareLink } from '../sharing/share-link.entity';
import type { RequiredAccess } from './access-policy.types';

/**
 * Access-resolution and policy layer. Routes declare what they need with
 * `@RequiresAccess` and ProjectAccessGuard calls `resolveProjectAccess` +
 * `requireLevel` once per request; child ids are mapped to their project by
 * EntityProjectResolver. The realtime gateway uses the same resolver for sockets.
 *
 * Ownership rules (current phase):
 *  - A project with no owner (ownerId null) is anonymous and open to everyone.
 *    This preserves the account-free workflow the app shipped with.
 *  - A project with an owner is private: only that owner has access.
 *  - A valid, non-revoked, non-expired share token for the project grants the
 *    link's level (EDIT or VIEW) to any caller, account or not (section 6).
 *  - Otherwise: 403.
 */
@Injectable()
export class AccessService {
  constructor(
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    @InjectRepository(ShareLink)
    private readonly shareLinks: Repository<ShareLink>,
  ) {}

  /** Resolve the caller's effective access to a project, or throw 403/404. */
  async resolveProjectAccess(
    projectId: string,
    userId: string | null,
    shareToken: string | null = null,
  ): Promise<AccessLevel> {
    const project = await this.projects.findOne({
      where: { id: projectId },
      select: { id: true, ownerId: true },
    });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found.`);
    }
    return this.levelFor(project, userId, shareToken);
  }

  /**
   * Like resolveProjectAccess, but reads the whole project row and returns it with
   * the level, so a graph load authorizes and reads the project in one query.
   */
  async readProject(
    projectId: string,
    userId: string | null,
    shareToken: string | null = null,
  ): Promise<{ project: Project; accessLevel: AccessLevel }> {
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found.`);
    }
    return { project, accessLevel: await this.levelFor(project, userId, shareToken) };
  }

  private async levelFor(
    project: Pick<Project, 'id' | 'ownerId'>,
    userId: string | null,
    shareToken: string | null,
  ): Promise<AccessLevel> {
    if (project.ownerId === null) {
      return 'OWNER'; // anonymous, open project
    }
    if (userId && project.ownerId === userId) {
      return 'OWNER';
    }
    if (shareToken) {
      const level = await this.resolveShareToken(project.id, shareToken);
      if (level) {
        return level;
      }
    }
    throw new ForbiddenException('You do not have access to this project.');
  }

  /**
   * Resolve a share token to the level it grants for a project, or null when the
   * token is unknown, for a different project, revoked, or expired.
   */
  async resolveShareToken(
    projectId: string,
    token: string,
  ): Promise<'EDIT' | 'VIEW' | null> {
    const link = await this.shareLinks.findOne({ where: { token } });
    if (!link || link.projectId !== projectId || link.revokedAt !== null) {
      return null;
    }
    if (link.expiresAt !== null && link.expiresAt.getTime() <= Date.now()) {
      return null;
    }
    return link.accessLevel;
  }

  /** Assert the caller may read the project (any resolvable level). */
  async assertCanRead(
    projectId: string,
    userId: string | null,
    shareToken: string | null = null,
  ): Promise<AccessLevel> {
    return this.resolveProjectAccess(projectId, userId, shareToken);
  }

  /** Assert the caller may write to the project (EDIT or OWNER). */
  async assertCanWrite(
    projectId: string,
    userId: string | null,
    shareToken: string | null = null,
  ): Promise<AccessLevel> {
    const level = await this.resolveProjectAccess(projectId, userId, shareToken);
    this.requireLevel(level, 'write');
    return level;
  }

  /** Assert the caller owns the project (rename, duplicate, delete, sharing). */
  async assertOwner(
    projectId: string,
    userId: string | null,
    shareToken: string | null = null,
  ): Promise<void> {
    const level = await this.resolveProjectAccess(projectId, userId, shareToken);
    this.requireLevel(level, 'owner');
  }

  /**
   * Throw 403 unless `level` satisfies `required`: read = any level, write = EDIT
   * or OWNER (a VIEW link is read-only), owner = OWNER only.
   */
  requireLevel(level: AccessLevel, required: RequiredAccess): void {
    if (required === 'write' && level === 'VIEW') {
      throw new ForbiddenException('This link is read-only.');
    }
    if (required === 'owner' && level !== 'OWNER') {
      throw new ForbiddenException('Only the project owner can perform this action.');
    }
  }
}
