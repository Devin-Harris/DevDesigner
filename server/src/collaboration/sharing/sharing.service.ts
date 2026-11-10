import type { AccessLevel, ProjectGraphResponse, ShareLinkResponse } from '@devdesigner/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { nanoid } from 'nanoid';
import { IsNull, Repository } from 'typeorm';
import { AccessService } from '../access/access.service';
import { GraphLoaderService } from '../../projects/common/graph-loader.service';
import { RealtimePublisher } from '../../platform/realtime/realtime.publisher';
import { CreateShareLinkDto } from './dto/create-share-link.dto';
import { ShareLink } from './share-link.entity';

/** Length of the unguessable share token (BUILD_INSTRUCTIONS.md section 4.1). */
const TOKEN_LENGTH = 32;

/**
 * Owner share-link CRUD plus account-free token resolution (BUILD_INSTRUCTIONS.md
 * sections 5 and 6). Link management requires OWNER (the routes declare
 * `@RequiresAccess('owner')`); resolving a token grants the link's level to anyone holding it, no account
 * needed. Tokens are generated with nanoid and are unique per link.
 */
@Injectable()
export class SharingService {
  constructor(
    @InjectRepository(ShareLink)
    private readonly shareLinks: Repository<ShareLink>,
    private readonly access: AccessService,
    private readonly graphs: GraphLoaderService,
    private readonly config: ConfigService,
    private readonly realtime: RealtimePublisher,
  ) {}

  /** Owner creates a link. Returns the token and the full shareable URL. */
  async create(projectId: string, dto: CreateShareLinkDto): Promise<ShareLinkResponse> {
    const link = this.shareLinks.create({
      projectId,
      token: nanoid(TOKEN_LENGTH),
      accessLevel: dto.accessLevel,
      revokedAt: null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    });
    const saved = await this.shareLinks.save(link);
    this.realtime.accessChanged(projectId, saved.token);
    return this.toResponse(saved);
  }

  /** Owner lists a project's active (non-revoked) links. */
  async list(projectId: string): Promise<ShareLinkResponse[]> {
    const links = await this.shareLinks.find({
      where: { projectId, revokedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    return links.map((link) => this.toResponse(link));
  }

  /**
   * Owner revokes a link, invalidating it immediately: REST calls with the token fail
   * from now on, and open sockets that joined with it are dropped.
   */
  async revoke(projectId: string, linkId: string): Promise<void> {
    const link = await this.shareLinks.findOne({
      where: { id: linkId, projectId },
      select: { id: true, token: true },
    });
    if (!link) {
      throw new NotFoundException(`Share link ${linkId} not found.`);
    }
    await this.shareLinks.update({ id: linkId, projectId }, { revokedAt: new Date() });
    this.realtime.accessRevoked(projectId, link.token);
  }

  /** Resolve a token to the shared project graph for the account-free entry route. */
  async getSharedGraph(token: string): Promise<ProjectGraphResponse> {
    const { projectId, accessLevel } = await this.sharedAccess(token);
    return this.graphs.graph(projectId, accessLevel);
  }

  /** The graph of a project already resolved by `sharedAccess`. */
  graphFor(projectId: string, accessLevel: AccessLevel): Promise<ProjectGraphResponse> {
    return this.graphs.graph(projectId, accessLevel);
  }

  /**
   * Resolve a token to its project and the level it grants there, without loading
   * the graph (conditional GET /shared/:token). Throws like getSharedGraph.
   */
  async sharedAccess(token: string): Promise<{ projectId: string; accessLevel: AccessLevel }> {
    const link = await this.access.shareLink(token);
    if (!link || link.revoked) {
      throw new NotFoundException('This share link is no longer valid.');
    }
    if (link.expiresAt !== null && link.expiresAt <= Date.now()) {
      throw new NotFoundException('This share link has expired.');
    }
    const accessLevel = await this.access.assertCanRead(link.projectId, null, token);
    return { projectId: link.projectId, accessLevel };
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
