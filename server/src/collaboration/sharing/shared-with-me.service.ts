import type { SharedProjectEntry } from '@devdesigner/shared';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Project } from '../../projects/projects/project.entity';
import { ShareLink } from './share-link.entity';
import { SharedProjectVisit } from './shared-project-visit.entity';
import { hashShareToken, ShareTokenSealer } from './share-token';

/**
 * "Shared with me": remembers which share links a signed-in user has opened so the
 * projects dialog can list them until the owner revokes the link (or it expires).
 */
@Injectable()
export class SharedWithMeService {
  private readonly logger = new Logger(SharedWithMeService.name);
  private readonly sealer: ShareTokenSealer;

  constructor(
    @InjectRepository(SharedProjectVisit)
    private readonly visits: Repository<SharedProjectVisit>,
    @InjectRepository(ShareLink)
    private readonly shareLinks: Repository<ShareLink>,
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    config: ConfigService,
  ) {
    this.sealer = new ShareTokenSealer(
      config.get<string>('SHARE_TOKEN_SECRET', '') || config.get<string>('JWT_SECRET', 'change-me-in-production'),
    );
  }

  /**
   * Record that `userId` opened `projectId` through `token` (already validated).
   * The owner opening their own link is not recorded. Never throws: remembering
   * the link must not break opening it.
   */
  async recordVisit(userId: string, projectId: string, token: string): Promise<void> {
    try {
      const project = await this.projects.findOne({ where: { id: projectId }, select: { id: true, ownerId: true } });
      if (!project || project.ownerId === userId) return;
      const link = await this.shareLinks.findOne({ where: { tokenHash: hashShareToken(token) }, select: { id: true } });
      if (!link) return;
      const existing = await this.visits.findOne({ where: { userId, shareLinkId: link.id } });
      if (existing) {
        await this.visits.update({ id: existing.id }, { lastOpenedAt: new Date() });
      } else {
        await this.visits.insert({
          userId,
          shareLinkId: link.id,
          tokenSealed: this.sealer.seal(token),
          lastOpenedAt: new Date(),
        });
      }
    } catch (err) {
      this.logger.warn({ err }, 'Could not record shared project visit');
    }
  }

  /**
   * The user's still-valid shared projects, most recently opened first, one entry
   * per project (the EDIT link wins over VIEW). Visits whose link was revoked or
   * expired are deleted on the way.
   */
  async list(userId: string): Promise<SharedProjectEntry[]> {
    const visits = await this.visits.find({ where: { userId }, order: { lastOpenedAt: 'DESC' } });
    if (visits.length === 0) return [];
    const links = await this.shareLinks.find({ where: { id: In(visits.map((v) => v.shareLinkId)) } });
    const linkById = new Map(links.map((l) => [l.id, l]));
    const projects = await this.projects.find({
      where: { id: In([...new Set(links.map((l) => l.projectId))]) },
      select: { id: true, name: true, ownerId: true, updatedAt: true, archived: true },
    });
    const projectById = new Map(projects.map((p) => [p.id, p]));

    const now = Date.now();
    const stale: string[] = [];
    const byProject = new Map<string, SharedProjectEntry>();
    for (const visit of visits) {
      const link = linkById.get(visit.shareLinkId);
      const project = link ? projectById.get(link.projectId) : undefined;
      const token = this.sealer.open(visit.tokenSealed);
      const dead =
        !link ||
        !project ||
        !token ||
        link.revokedAt !== null ||
        (link.expiresAt !== null && link.expiresAt.getTime() <= now) ||
        project.ownerId === userId;
      if (dead) {
        stale.push(visit.id);
        continue;
      }
      if (project.archived) continue;
      const prior = byProject.get(project.id);
      if (prior && (prior.accessLevel === 'EDIT' || link.accessLevel !== 'EDIT')) continue;
      byProject.set(project.id, {
        linkId: link.id,
        projectId: project.id,
        name: project.name,
        accessLevel: link.accessLevel,
        token,
        updatedAt: project.updatedAt.toISOString(),
        lastOpenedAt: (prior?.lastOpenedAt ?? visit.lastOpenedAt.toISOString()),
      });
    }
    if (stale.length) await this.visits.delete({ id: In(stale) });
    return [...byProject.values()];
  }

  /** Drop every remembered link to `projectId` from the user's list. */
  async forget(userId: string, projectId: string): Promise<void> {
    const links = await this.shareLinks.find({ where: { projectId }, select: { id: true } });
    if (links.length === 0) return;
    await this.visits.delete({ userId, shareLinkId: In(links.map((l) => l.id)) });
  }
}
