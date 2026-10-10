import type { ProjectGraphResponse, ShareLinkResponse } from '@dbdesigner/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { nanoid } from 'nanoid';
import { IsNull, Repository } from 'typeorm';
import { AccessService } from '../access/access.service';
import { ProjectsService } from '../projects/projects.service';
import { CreateShareLinkDto } from './dto/create-share-link.dto';
import { ShareLink } from './share-link.entity';

/** Length of the unguessable share token (BUILD_INSTRUCTIONS.md section 4.1). */
const TOKEN_LENGTH = 32;

/**
 * Owner share-link CRUD plus account-free token resolution (BUILD_INSTRUCTIONS.md
 * sections 5 and 6). Link management requires OWNER (enforced via AccessService);
 * resolving a token grants the link's level to anyone holding it, no account
 * needed. Tokens are generated with nanoid and are unique per link.
 */
@Injectable()
export class SharingService {
  constructor(
    @InjectRepository(ShareLink)
    private readonly shareLinks: Repository<ShareLink>,
    private readonly access: AccessService,
    private readonly projects: ProjectsService,
    private readonly config: ConfigService,
  ) {}

  /** Owner creates a link. Returns the token and the full shareable URL. */
  async create(
    projectId: string,
    dto: CreateShareLinkDto,
    userId: string | null,
  ): Promise<ShareLinkResponse> {
    await this.access.assertOwner(projectId, userId);
    const link = this.shareLinks.create({
      projectId,
      token: nanoid(TOKEN_LENGTH),
      accessLevel: dto.accessLevel,
      revokedAt: null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    });
    const saved = await this.shareLinks.save(link);
    return this.toResponse(saved);
  }

  /** Owner lists a project's active (non-revoked) links. */
  async list(projectId: string, userId: string | null): Promise<ShareLinkResponse[]> {
    await this.access.assertOwner(projectId, userId);
    const links = await this.shareLinks.find({
      where: { projectId, revokedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    return links.map((link) => this.toResponse(link));
  }

  /** Owner revokes a link, invalidating it immediately. */
  async revoke(projectId: string, linkId: string, userId: string | null): Promise<void> {
    await this.access.assertOwner(projectId, userId);
    const result = await this.shareLinks.update(
      { id: linkId, projectId },
      { revokedAt: new Date() },
    );
    if (!result.affected) {
      throw new NotFoundException(`Share link ${linkId} not found.`);
    }
  }

  /** Resolve a token to the shared project graph for the account-free entry route. */
  async getSharedGraph(token: string): Promise<ProjectGraphResponse> {
    const link = await this.resolveValidLink(token);
    // getGraph re-authorizes with the token and reports the effective level.
    return this.projects.getGraph(link.projectId, null, token);
  }

  private async resolveValidLink(token: string): Promise<ShareLink> {
    const link = await this.shareLinks.findOne({ where: { token } });
    if (!link || link.revokedAt !== null) {
      throw new NotFoundException('This share link is no longer valid.');
    }
    if (link.expiresAt !== null && link.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundException('This share link has expired.');
    }
    return link;
  }

  private toResponse(link: ShareLink): ShareLinkResponse {
    return {
      id: link.id,
      token: link.token,
      url: `${this.baseUrl()}/shared/${link.token}`,
      accessLevel: link.accessLevel as ShareLinkResponse['accessLevel'],
      createdAt: link.createdAt.toISOString(),
      expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
      revokedAt: link.revokedAt ? link.revokedAt.toISOString() : null,
    };
  }

  /** Client origin used to build shareable URLs (falls back to the dev client). */
  private baseUrl(): string {
    return this.config.get<string>('PUBLIC_APP_URL', 'http://localhost:4242').replace(/\/$/, '');
  }
}
