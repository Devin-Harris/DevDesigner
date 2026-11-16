import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { AdminCount, AdminFileSize, AdminStorageResponse } from '@devdesigner/shared';
import { ANALYTICS_CONNECTION } from '../../platform/analytics/analytics.config';
import { IMAGE_BYTES, NOT_SANDBOX, PROJECT_AGGREGATE_SQL, type ProjectAggregateRow, num, ownerKindOf } from './admin-sql';
import { DAY_MS, sqlDatetime } from './admin-window';

type Row = Record<string, unknown>;

/** App tables counted on the storage page (fixed list: never interpolated from input). */
const COUNTED_TABLES = [
  'users',
  'projects',
  'tables',
  'columns',
  'indexes',
  'relationships',
  'elements',
  'sequence_diagrams',
  'lifelines',
  'sequence_messages',
  'project_images',
  'share_links',
  'api_tokens',
  'user_themes',
] as const;

/** The whole report is recomputed at most this often (the queries scan every table). */
export const STORAGE_CACHE_MS = 5 * 60_000;

/**
 * What the app database holds (audit 04 §5): row counts, on-disk bytes, media,
 * largest projects, active vs dormant projects, auth methods, share links and
 * tokens. Read-only on the app connection; guide sandboxes are excluded from the
 * project-level numbers. Cached for {@link STORAGE_CACHE_MS}; the Phase 4 nightly
 * snapshot will replace the live per-project scan.
 */
@Injectable()
export class AdminStorageService {
  private cached: { at: number; value: AdminStorageResponse } | null = null;

  constructor(
    @InjectDataSource() private readonly app: DataSource,
    @Optional() @InjectDataSource(ANALYTICS_CONNECTION) private readonly analytics?: DataSource,
  ) {}

  async report(now = Date.now()): Promise<AdminStorageResponse> {
    if (this.cached && now - this.cached.at < STORAGE_CACHE_MS) return this.cached.value;
    const value = await this.compute(now);
    this.cached = { at: now, value };
    return value;
  }

  private async compute(now: number): Promise<AdminStorageResponse> {
    const q = (sql: string, params: unknown[] = []): Promise<Row[]> => this.app.query(sql, params) as Promise<Row[]>;
    const nowSql = sqlDatetime(now);
    const counts = (rows: Row[], key = 'k', value = 'n'): AdminCount[] =>
      rows.map((r) => ({ key: String(r[key] ?? 'unknown'), count: num(r[value]) }));

    const rows = await q(COUNTED_TABLES.map((t) => `SELECT '${t}' AS k, COUNT(*) AS n FROM "${t}"`).join(' UNION ALL '));
    const [pageCount] = await q('PRAGMA page_count');
    const [pageSize] = await q('PRAGMA page_size');
    const [freelist] = await q('PRAGMA freelist_count');
    const images = await q(
      `SELECT i.mimeType AS mimeType, COUNT(*) AS n, SUM(${IMAGE_BYTES}) AS bytes, COUNT(DISTINCT i.sha256) AS uniq
       FROM project_images i GROUP BY i.mimeType ORDER BY bytes DESC`,
    );
    const [orphans] = await q(
      `SELECT COUNT(*) AS n, COALESCE(SUM(${IMAGE_BYTES}), 0) AS bytes FROM project_images i
       WHERE NOT EXISTS (SELECT 1 FROM elements e WHERE e.fileId = i.id)`,
    );
    const elementsByType = await q(
      `SELECT type AS k, COUNT(*) AS n, SUM(LENGTH(COALESCE(text, ''))) AS textBytes FROM elements GROUP BY type ORDER BY n DESC`,
    );
    const [slides] = await q(`SELECT COUNT(*) AS n FROM elements WHERE type = 'frame' AND slideJson IS NOT NULL`);
    const largest = (await q(
      `${PROJECT_AGGREGATE_SQL} WHERE ${NOT_SANDBOX} ORDER BY COALESCE(img.bytes, 0) + COALESCE(e.textBytes, 0) DESC LIMIT 25`,
      [nowSql],
    )) as unknown as ProjectAggregateRow[];
    const days = (n: number): string => sqlDatetime(now - n * DAY_MS);
    const activity = await q(
      `SELECT CASE
         WHEN COALESCE(p.lastOpenedAt, p.updatedAt) >= ? THEN 'active_7d'
         WHEN COALESCE(p.lastOpenedAt, p.updatedAt) >= ? THEN 'active_30d'
         WHEN COALESCE(p.lastOpenedAt, p.updatedAt) >= ? THEN 'idle'
         ELSE 'dormant' END AS k, COUNT(*) AS n
       FROM projects p WHERE ${NOT_SANDBOX} GROUP BY k`,
      [days(7), days(30), days(180)],
    );
    const [approx] = await q(`SELECT COUNT(*) AS n FROM projects p WHERE ${NOT_SANDBOX} AND p.lastOpenedAt IS NULL`);
    const auth = await q(
      `SELECT CASE WHEN provider IS NOT NULL THEN provider WHEN passwordHash IS NOT NULL THEN 'password' ELSE 'unknown' END AS k,
         COUNT(*) AS n FROM users GROUP BY k ORDER BY n DESC`,
    );
    const [guests] = await q(
      `SELECT COUNT(DISTINCT p.ownerId) AS owners, COUNT(*) AS n FROM projects p WHERE p.ownerId LIKE 'guest:%' AND ${NOT_SANDBOX}`,
    );
    const [ownerless] = await q(`SELECT COUNT(*) AS n FROM projects p WHERE p.ownerId IS NULL`);
    const shares = await q(
      `SELECT accessLevel AS k, COUNT(*) AS n FROM share_links
       WHERE revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > ?) GROUP BY accessLevel`,
      [nowSql],
    );
    const tokens = await q(
      `SELECT scope, COUNT(*) AS total, SUM(revokedAt IS NULL) AS active, SUM(lastUsedAt >= ?) AS used7d
       FROM api_tokens GROUP BY scope`,
      [days(7)],
    );
    const perUser = await q(
      `SELECT bucket AS k, COUNT(*) AS n FROM (
         SELECT p.ownerId, CASE WHEN COUNT(*) = 1 THEN '1' WHEN COUNT(*) <= 5 THEN '2-5'
           WHEN COUNT(*) <= 20 THEN '6-20' ELSE '21+' END AS bucket
         FROM projects p WHERE p.ownerId IS NOT NULL AND p.ownerId NOT LIKE 'guest:%' AND ${NOT_SANDBOX}
         GROUP BY p.ownerId)
       GROUP BY bucket`,
    );

    return {
      generatedAt: new Date(now).toISOString(),
      rows: counts(rows),
      tableBytes: await this.tableBytes(),
      database: {
        pageCount: num(pageCount?.['page_count']),
        pageSize: num(pageSize?.['page_size']),
        freelistCount: num(freelist?.['freelist_count']),
        file: await fileSize(this.app.options.database),
      },
      analyticsDatabase: this.analytics?.isInitialized ? await fileSize(this.analytics.options.database) : null,
      images: images.map((r) => ({
        mimeType: String(r['mimeType']),
        count: num(r['n']),
        bytes: num(r['bytes']),
        unique: num(r['uniq']),
      })),
      orphanImages: { count: num(orphans?.['n']), bytes: num(orphans?.['bytes']) },
      elementsByType: elementsByType.map((r) => ({ key: String(r['k']), count: num(r['n']), textBytes: num(r['textBytes']) })),
      slides: num(slides?.['n']),
      largestProjects: largest.map((p) => ({
        id: p.id,
        name: p.name,
        ownerKind: ownerKindOf(p.ownerId),
        tables: num(p.tables),
        elements: num(p.elements),
        textBytes: num(p.textBytes),
        imageBytes: num(p.imageBytes),
      })),
      projectActivity: ['active_7d', 'active_30d', 'idle', 'dormant'].map((key) => ({
        key,
        count: num(activity.find((r) => r['k'] === key)?.['n']),
      })),
      projectActivityApprox: num(approx?.['n']) > 0,
      authMethods: counts(auth),
      guests: { owners: num(guests?.['owners']), projects: num(guests?.['n']) },
      ownerlessProjects: num(ownerless?.['n']),
      activeShareLinks: counts(shares),
      apiTokens: tokens.map((r) => ({
        scope: String(r['scope']),
        total: num(r['total']),
        active: num(r['active']),
        used7d: num(r['used7d']),
      })),
      projectsPerUser: ['1', '2-5', '6-20', '21+'].map((key) => ({
        key,
        count: num(perUser.find((r) => r['k'] === key)?.['n']),
      })),
    };
  }

  /** dbstat bytes per table/index; null when this SQLite build has no DBSTAT. */
  private async tableBytes(): Promise<AdminStorageResponse['tableBytes']> {
    try {
      const rows = (await this.app.query(
        'SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY bytes DESC LIMIT 40',
      )) as Row[];
      return rows.map((r) => ({ name: String(r['name']), bytes: num(r['bytes']) }));
    } catch {
      return null;
    }
  }
}

/** Size of a SQLite file and its -wal (basename only: no server paths in responses). */
async function fileSize(database: unknown): Promise<AdminFileSize | null> {
  if (typeof database !== 'string' || database === '' || database === ':memory:') return null;
  const size = (path: string): Promise<number> => stat(path).then((s) => s.size, () => 0);
  return { path: basename(database), bytes: await size(database), walBytes: await size(`${database}-wal`) };
}
