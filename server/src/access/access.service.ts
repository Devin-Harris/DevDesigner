import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AccessLevel } from '@devdesigner/shared';
import { Project } from '../projects/project.entity';
import { ShareLink } from '../sharing/share-link.entity';
import type { RequiredAccess } from './access-policy.types';
import { EntityProjectResolver, type ProjectEntityKind } from './entity-project-resolver';

/** Ids a write refers to, by kind (null/undefined/'' entries are ignored). */
export type ProjectRefs = Partial<Record<ProjectEntityKind, ReadonlyArray<string | null | undefined>>>;

/** The ids arrow bindings point at, as refs (`element`, `table` or `message`). */
export function bindingRefs(
  ...bindings: Array<{ targetKind: string; targetId: string } | null | undefined>
): ProjectRefs {
  const refs: Record<string, string[]> = {};
  for (const b of bindings) {
    if (!b || !['element', 'table', 'message'].includes(b.targetKind)) continue;
    (refs[b.targetKind] ??= []).push(b.targetId);
  }
  return refs as ProjectRefs;
}

/** Merge several ref sets. */
export function mergeRefs(...sets: ProjectRefs[]): ProjectRefs {
  const out: Record<string, Array<string | null | undefined>> = {};
  for (const set of sets) {
    for (const [kind, ids] of Object.entries(set)) (out[kind] ??= []).push(...(ids ?? []));
  }
  return out as ProjectRefs;
}

/**
 * Access-resolution and policy layer. Routes declare what they need with
 * `@RequiresAccess` and ProjectAccessGuard calls `resolveProjectAccess` +
 * `requireLevel` once per request; child ids are mapped to their project by
 * EntityProjectResolver. The realtime gateway uses the same resolver for sockets.
 *
 * Ownership rules:
 *  - The owner (account id, or `guest:<id>` for a guest's browser) has OWNER.
 *  - A project with no owner (ownerId null, legacy rows quarantined by migration
 *    1794100000000) grants nothing to anyone, share links included (security M-1).
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
    private readonly resolver: EntityProjectResolver,
  ) {}

  /**
   * Refuse (400) a write whose references (slide owner, arrow bindings, message
   * endpoints, index columns, ...) point at rows that are missing or belong to
   * another project (security L-7 / S2.3). One query per kind present.
   */
  async assertIdsInProject(
    kind: ProjectEntityKind,
    ids: ReadonlyArray<string | null | undefined>,
    projectId: string,
  ): Promise<void> {
    const wanted = ids.filter((id): id is string => typeof id === 'string' && id !== '');
    if (wanted.length === 0) return;
    const outside = await this.resolver.idsOutsideProject(kind, wanted, projectId);
    if (outside.length) {
      const shown = outside.slice(0, 5).join(', ') + (outside.length > 5 ? ', ...' : '');
      throw new BadRequestException(`${this.resolver.labelOf(kind)} ${shown} is not part of this project.`);
    }
  }

  /** assertIdsInProject for every kind in `refs`. */
  async assertRefsInProject(refs: ProjectRefs, projectId: string): Promise<void> {
    for (const [kind, ids] of Object.entries(refs) as Array<[ProjectEntityKind, Array<string | null | undefined>]>) {
      await this.assertIdsInProject(kind, ids ?? [], projectId);
    }
  }

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
      // Ownerless (legacy) projects are quarantined: nobody, not even a link, gets in.
      throw new ForbiddenException('You do not have access to this project.');
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
