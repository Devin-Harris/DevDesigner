import { createHash, randomBytes } from 'crypto';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ApiTokenResponse, CreatedApiTokenResponse } from '@devdesigner/shared';
import { ApiToken } from './api-token.entity';
import type { AuthUser } from './auth.types';
import { CreateApiTokenDto } from './dto/create-api-token.dto';
import { track } from '../../platform/analytics/track';
import { TouchThrottle } from '../../platform/analytics/touch-throttle';

/** Every API token starts with this, so leaked ones are easy to spot and scan for. */
export const API_TOKEN_PREFIX = 'dd_';
/** Tokens issued before the rename; still accepted (the hash covers the whole token). */
export const LEGACY_API_TOKEN_PREFIXES = ['dbd_'] as const;

const RATE_WINDOW_MS = 60_000;
const LAST_USED_WRITE_INTERVAL_MS = 60_000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Create, list, revoke and verify per-user API tokens, plus a small in-memory
 * per-token rate limiter (requests per minute, API_TOKEN_RATE_LIMIT, default
 * 600). Verification returns the same AuthUser shape as a cookie session, so
 * every route's access checks apply to the token's owner exactly as they would
 * in the UI.
 */
@Injectable()
export class ApiTokenService {
  private readonly hits = new Map<string, number[]>();
  private readonly lastTouched = new TouchThrottle(LAST_USED_WRITE_INTERVAL_MS);
  private readonly limit: number;

  constructor(
    @InjectRepository(ApiToken)
    private readonly tokens: Repository<ApiToken>,
    config: ConfigService,
    @Optional() private readonly events?: EventEmitter2,
  ) {
    // Validated and defaulted by platform/config (600 when unset).
    this.limit = config.get<number>('API_TOKEN_RATE_LIMIT', 600);
  }

  async create(userId: string, dto: CreateApiTokenDto): Promise<CreatedApiTokenResponse> {
    const projectId = dto.projectId ?? null;
    if (projectId) {
      const owned = (await this.tokens.manager.query(
        'SELECT 1 FROM "projects" WHERE "id" = ? AND "ownerId" = ? LIMIT 1',
        [projectId, userId],
      )) as unknown[];
      if (!owned.length) {
        throw new BadRequestException('A token can only be limited to a project you own.');
      }
    }
    const expiresAt = dto.expiresInDays ? new Date(Date.now() + dto.expiresInDays * 86_400_000) : null;
    const secret = API_TOKEN_PREFIX + randomBytes(32).toString('base64url');
    const saved = await this.tokens.save(
      this.tokens.create({
        userId,
        name: dto.name.trim(),
        scope: dto.scope ?? 'write',
        tokenHash: hashToken(secret),
        prefix: secret.slice(0, 8),
        lastUsedAt: null,
        revokedAt: null,
        expiresAt,
        projectId,
      }),
    );
    track(this.events, 'token.created', { scope: saved.scope });
    return { ...toResponse(saved), token: secret };
  }

  async list(userId: string): Promise<ApiTokenResponse[]> {
    const rows = await this.tokens.find({ where: { userId }, order: { createdAt: 'DESC' } });
    return rows.map(toResponse);
  }

  async revoke(userId: string, id: string): Promise<void> {
    const row = await this.tokens.findOne({ where: { id, userId } });
    if (!row) {
      throw new NotFoundException('API token not found.');
    }
    if (!row.revokedAt) {
      row.revokedAt = new Date();
      await this.tokens.save(row);
      track(this.events, 'token.revoked');
    }
  }

  /** Resolve a raw token to its owner, or null when unknown, revoked or expired. Enforces the rate limit. */
  async verify(raw: string): Promise<AuthUser | null> {
    if (![API_TOKEN_PREFIX, ...LEGACY_API_TOKEN_PREFIXES].some((p) => raw.startsWith(p))) {
      return null;
    }
    const row = await this.tokens.findOne({ where: { tokenHash: hashToken(raw) } });
    if (!row || row.revokedAt || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) {
      return null;
    }
    this.checkRate(row.id);
    this.touch(row);
    return {
      id: row.userId,
      email: null,
      viaToken: { id: row.id, scope: row.scope, projectId: row.projectId ?? null },
    };
  }

  private checkRate(tokenId: string): void {
    const now = Date.now();
    const recent = (this.hits.get(tokenId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= this.limit) {
      this.hits.set(tokenId, recent);
      throw new HttpException(
        'API token rate limit exceeded; retry shortly.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(now);
    this.hits.set(tokenId, recent);
  }

  /** Record last use at most once a minute per token (best effort, never blocks a request). */
  private touch(row: ApiToken): void {
    const now = Date.now();
    if (!this.lastTouched.take(row.id, now)) {
      return;
    }
    void this.tokens.update({ id: row.id }, { lastUsedAt: new Date(now) }).catch(() => undefined);
    track(this.events, 'token.used', { scope: row.scope }, { principal: { userId: row.userId, tokenId: row.id } });
  }
}

function toResponse(row: ApiToken): ApiTokenResponse {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    prefix: row.prefix,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
    projectId: row.projectId ?? null,
  };
}
