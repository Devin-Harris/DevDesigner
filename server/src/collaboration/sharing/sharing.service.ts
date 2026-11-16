import type { AccessLevel, ProjectGraphResponse, ShareLinkResponse } from '@devdesigner/shared';
import { Injectable, Logger, NotFoundException, type OnModuleInit, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { nanoid } from 'nanoid';
import { IsNull, Repository } from 'typeorm';
import { AccessService } from '../access/access.service';
import { GraphLoaderService } from '../../projects/common/graph-loader.service';
import { RealtimePublisher } from '../../platform/realtime/realtime.publisher';
import { CreateShareLinkDto } from './dto/create-share-link.dto';
import { ShareLink } from './share-link.entity';
import { hashShareToken, isHashedShareToken, ShareTokenSealer } from './share-token';
import { track } from '../../platform/analytics/track';

/** Length of the unguessable share token (BUILD_INSTRUCTIONS.md section 4.1). */
const TOKEN_LENGTH = 32;

/**
 * Owner share-link CRUD plus account-free token resolution (BUILD_INSTRUCTIONS.md
 * sections 5 and 6). Link management requires OWNER (the routes declare
 * `@RequiresAccess('owner')`); resolving a token grants the link's level to anyone holding it, no account
 * needed. Tokens are generated with nanoid and are unique per link.
 */
@Injectable()
export class SharingService implements OnModuleInit {
  private readonly logger = new Logger(SharingService.name);
  private readonly sealer: ShareTokenSealer;

  constructor(
    @InjectRepository(ShareLink)
    private readonly shareLinks: Repository<ShareLink>,
    private readonly access: AccessService,
    private readonly graphs: GraphLoaderService,
    private readonly config: ConfigService,
    private readonly realtime: RealtimePublisher,
    @Optional() private readonly events?: EventEmitter2,
  ) {
    this.sealer = new ShareTokenSealer(
      this.config.get<string>('SHARE_TOKEN_SECRET', '') ||
        this.config.get<string>('JWT_SECRET', 'change-me-in-production'),
    );
  }

  /** Convert links stored before hashing (plaintext token) before the app takes traffic. */
  async onModuleInit(): Promise<void> {
    try {
      const converted = await this.hashPlaintextTokens();
      if (converted > 0) this.logger.log(`Hashed ${converted} plaintext share token(s)`);
    } catch (err) {
      // Lookups still fall back to plaintext rows, so links keep working regardless.
      this.logger.warn({ err }, 'Share token hashing failed; will retry on next boot');
    }
  }

  /** Hash every share_links row still holding a plaintext token; returns how many changed. */
  async hashPlaintextTokens(): Promise<number> {
    const rows = await this.shareLinks.find({ select: { id: true, tokenHash: true } });
    let converted = 0;
    for (const row of rows) {
      if (isHashedShareToken(row.tokenHash)) continue;
      await this.shareLinks.update(
        { id: row.id },
        { tokenHash: hashShareToken(row.tokenHash), tokenSealed: this.sealer.seal(row.tokenHash) },
      );
      converted++;
    }
    return converted;
  }

  /** Owner creates a link. Returns the token and the full shareable URL. */
  async create(projectId: string, dto: CreateShareLinkDto): Promise<ShareLinkResponse> {
    const token = nanoid(TOKEN_LENGTH);
    const link = this.shareLinks.create({
      projectId,
      tokenHash: hashShareToken(token),
      tokenSealed: this.sealer.seal(token),
      accessLevel: dto.accessLevel,
      revokedAt: null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    });
    const saved = await this.shareLinks.save(link);
    this.realtime.accessChanged(projectId);
    track(this.events, 'share.created', { access: saved.accessLevel, hasExpiry: saved.expiresAt !== null }, { projectId });
    return this.toResponse(saved, token);
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
    const result = await this.shareLinks.update({ id: linkId, projectId }, { revokedAt: new Date() });
    if (!result.affected) {
      throw new NotFoundException(`Share link ${linkId} not found.`);
    }
    // Only the hash is known here: every socket of the project is re-checked.
    this.realtime.accessRevoked(projectId);
    track(this.events, 'share.revoked', {}, { projectId });
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
    // Counted once per link and client per hour by the analytics listener (also share_links.useCount).
    track(this.events, 'share.opened', { access: accessLevel }, { projectId: link.projectId, principal: { shareToken: token } });
    return { projectId: link.projectId, accessLevel };
  }

  private toResponse(link: ShareLink, token = this.displayToken(link)): ShareLinkResponse {
    return {
      id: link.id,
      token,
      url: token ? `${this.baseUrl()}/shared/${token}` : null,
      accessLevel: link.accessLevel as ShareLinkResponse['accessLevel'],
      createdAt: link.createdAt.toISOString(),
      expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
      revokedAt: link.revokedAt ? link.revokedAt.toISOString() : null,
    };
  }

  /** The token for the owner: unsealed, or as stored on a row not yet converted (next boot). */
  private displayToken(link: ShareLink): string | null {
    return isHashedShareToken(link.tokenHash) ? this.sealer.open(link.tokenSealed) : link.tokenHash;
  }

  /** Client origin used to build shareable URLs (falls back to the dev client). */
  private baseUrl(): string {
    return this.config.get<string>('PUBLIC_APP_URL', 'http://localhost:4242').replace(/\/$/, '');
  }
}
