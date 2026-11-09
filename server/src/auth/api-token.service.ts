import { createHash, randomBytes } from 'crypto';
import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ApiTokenResponse, CreatedApiTokenResponse } from '@devdesigner/shared';
import { ApiToken } from './api-token.entity';
import type { AuthUser } from './auth.types';
import { CreateApiTokenDto } from './dto/create-api-token.dto';

/** Every API token starts with this, so leaked ones are easy to spot and scan for. */
export const API_TOKEN_PREFIX = 'dd_';

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
  private readonly lastTouched = new Map<string, number>();
  private readonly limit = Number(process.env.API_TOKEN_RATE_LIMIT ?? 600);

  constructor(
    @InjectRepository(ApiToken)
    private readonly tokens: Repository<ApiToken>,
  ) {}

  async create(userId: string, dto: CreateApiTokenDto): Promise<CreatedApiTokenResponse> {
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
      }),
    );
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
    }
  }

  /** Resolve a raw token to its owner, or null when unknown/revoked. Enforces the rate limit. */
  async verify(raw: string): Promise<AuthUser | null> {
    if (!raw.startsWith(API_TOKEN_PREFIX)) {
      return null;
    }
    const row = await this.tokens.findOne({ where: { tokenHash: hashToken(raw) } });
    if (!row || row.revokedAt) {
      return null;
    }
    this.checkRate(row.id);
    this.touch(row);
    return { id: row.userId, email: null, viaToken: { id: row.id, scope: row.scope } };
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
    if (now - (this.lastTouched.get(row.id) ?? 0) < LAST_USED_WRITE_INTERVAL_MS) {
      return;
    }
    this.lastTouched.set(row.id, now);
    void this.tokens.update({ id: row.id }, { lastUsedAt: new Date(now) }).catch(() => undefined);
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
  };
}
