import { Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { AdminHygienePreviewResponse } from '@devdesigner/shared';
import { AnalyticsRollupService } from '../../platform/analytics/analytics-rollup.service';
import { IMAGE_BYTES, NOT_SANDBOX, num } from './admin-sql';
import { DAY_MS, sqlDatetime } from './admin-window';

type Row = Record<string, unknown>;

/** Guest projects untouched this long are cleanup candidates. */
export const DORMANT_GUEST_DAYS = 180;
/** Revoked / expired share links older than this are cleanup candidates. */
export const STALE_SHARE_DAYS = 90;

/**
 * App-data hygiene, dry run only (audit 04 §4.6): how much each optional cleanup
 * would remove. Nothing is deleted here; actual deletes stay manual / opt-in.
 * Read-only on the app connection.
 */
@Injectable()
export class AdminHygieneService {
  constructor(
    @InjectDataSource() private readonly app: DataSource,
    @Optional() private readonly rollup?: AnalyticsRollupService,
  ) {}

  async preview(now = Date.now()): Promise<AdminHygienePreviewResponse> {
    const q = async (sql: string, params: unknown[] = []): Promise<Row> =>
      ((await this.app.query(sql, params)) as Row[])[0] ?? {};
    const before = (days: number): string => sqlDatetime(now - days * DAY_MS);

    const guests = await q(
      `SELECT COUNT(*) AS n, COALESCE(SUM(img.bytes), 0) AS bytes FROM projects p
       LEFT JOIN (SELECT i.projectId, SUM(${IMAGE_BYTES}) AS bytes FROM project_images i GROUP BY i.projectId) img
         ON img.projectId = p.id
       WHERE p.ownerId LIKE 'guest:%' AND ${NOT_SANDBOX} AND COALESCE(p.lastOpenedAt, p.updatedAt) < ?`,
      [before(DORMANT_GUEST_DAYS)],
    );
    const orphans = await q(
      `SELECT COUNT(*) AS n, COALESCE(SUM(${IMAGE_BYTES}), 0) AS bytes FROM project_images i
       WHERE NOT EXISTS (SELECT 1 FROM elements e WHERE e.fileId = i.id)`,
    );
    const stale = await q(
      `SELECT COUNT(*) AS n FROM share_links
       WHERE (revokedAt IS NOT NULL AND revokedAt < ?) OR (expiresAt IS NOT NULL AND expiresAt < ?)`,
      [before(STALE_SHARE_DAYS), before(STALE_SHARE_DAYS)],
    );
    const status = this.rollup?.status;
    return {
      generatedAt: new Date(now).toISOString(),
      dormantGuestProjects: { count: num(guests['n']), bytes: num(guests['bytes']) },
      orphanImages: { count: num(orphans['n']), bytes: num(orphans['bytes']) },
      staleShareLinks: { count: num(stale['n']), bytes: 0 },
      rollup: {
        lastRunAt: status?.lastRunAt ?? null,
        lastDurationMs: status?.lastDurationMs ?? null,
        lastError: status?.lastError ?? null,
        snapshots: status?.snapshots ?? 0,
        purged: status?.purged ?? 0,
      },
    };
  }
}
