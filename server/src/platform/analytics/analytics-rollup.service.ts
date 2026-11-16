import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { ANALYTICS_CONNECTION, type AnalyticsConfig } from './analytics.config';
import { ANALYTICS_CONFIG } from './analytics.service';
import { utcDay } from './privacy';

type Row = Record<string, unknown>;

const DAY = 24 * 60 * 60 * 1000;
/** The nightly run starts at 02:10 UTC (audit 04 §4.6). */
const RUN_AT_UTC_MINUTES = 2 * 60 + 10;
/** Projects snapshotted per query batch. */
const SNAPSHOT_BATCH = 200;
/** api.error rows are kept for 30 days (they carry no more than other rows, but pile up fast). */
const ERROR_RETENTION_DAYS = 30;
/** Daily project snapshots are kept 30 days, plus the first of every month forever. */
const SNAPSHOT_RETENTION_DAYS = 30;
/** Guide sandboxes are not real projects. */
const NOT_SANDBOX = `(p.description IS NULL OR p.description NOT IN ('dd-guide-sandbox', 'dbd-guide-sandbox'))`;

/** Outcome of the last nightly run, for the admin dashboard. */
export interface RollupStatus {
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  days: string[];
  snapshots: number;
  purged: number;
}

const num = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Value at quantile q (0-1) of an ascending list; null when empty. */
export function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return Math.round(sorted[index]);
}

/** Milliseconds from `now` until the next 02:10 UTC. */
export function msUntilNextRun(now: number): number {
  const startOfDay = now - (now % DAY);
  let next = startOfDay + RUN_AT_UTC_MINUTES * 60_000;
  if (next <= now) next += DAY;
  return next - now;
}

/**
 * Nightly analytics jobs (audit 04 Phase 4), at 02:10 UTC:
 *  1. upsert `analytics_daily` for yesterday and the day before (idempotent, so late
 *     flushes are absorbed); `analytics_actor_day` is already written on every flush;
 *  2. write `analytics_project_snapshot` for today from read-only app queries, in
 *     batches of 200 projects;
 *  3. purge `api.error` rows after 30 days and snapshots after 30 days (except the
 *     first of each month); raw events past ANALYTICS_RAW_RETENTION_DAYS are purged
 *     by AnalyticsService's daily timer;
 *  4. `PRAGMA incremental_vacuum`.
 * A no-op when analytics is disabled (no analytics connection).
 */
@Injectable()
export class AnalyticsRollupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsRollupService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  readonly status: RollupStatus = {
    lastRunAt: null,
    lastDurationMs: null,
    lastError: null,
    days: [],
    snapshots: 0,
    purged: 0,
  };

  constructor(
    @Inject(ANALYTICS_CONFIG) private readonly config: AnalyticsConfig,
    @InjectDataSource() private readonly app: DataSource,
    @Optional() @InjectDataSource(ANALYTICS_CONNECTION) private readonly analytics?: DataSource,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled || !this.analytics) return;
    this.schedule();
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      void this.run().finally(() => this.schedule());
    }, msUntilNextRun(Date.now()));
    this.timer.unref?.();
  }

  /** Run every nightly step now (also used by tests). Never throws. */
  async run(now = Date.now()): Promise<RollupStatus> {
    if (!this.analytics || this.running) return this.status;
    this.running = true;
    const started = Date.now();
    try {
      const today = utcDay(now);
      const days = [utcDay(now - DAY), utcDay(now - 2 * DAY)];
      for (const day of days) await this.rollupDay(day);
      const snapshots = await this.snapshotProjects(today);
      const purged = await this.purge(now);
      await this.analytics.query('PRAGMA incremental_vacuum');
      Object.assign(this.status, { days, snapshots, purged, lastError: null });
    } catch (err) {
      this.status.lastError = err instanceof Error ? err.message : String(err);
      this.logger.warn({ err }, 'Analytics rollup failed');
    } finally {
      this.status.lastRunAt = new Date(now).toISOString();
      this.status.lastDurationMs = Date.now() - started;
      this.running = false;
    }
    return this.status;
  }

  /** Upsert one UTC day of `analytics_daily` from the raw events (dim = route template or ''). */
  async rollupDay(day: string): Promise<number> {
    const db = this.analytics!;
    const from = Date.parse(`${day}T00:00:00Z`);
    const to = from + DAY;
    const groups = (await db.query(
      `SELECT name, COALESCE(route, '') AS dim, source, SUM(count) AS events,
         COUNT(DISTINCT actorId) AS actors, SUM(CASE WHEN status >= 500 THEN count ELSE 0 END) AS errors
       FROM analytics_event WHERE ts >= ? AND ts < ? GROUP BY name, dim, source`,
      [from, to],
    )) as Row[];
    const durations = (await db.query(
      `SELECT name, COALESCE(route, '') AS dim, source, durationMs FROM analytics_event
       WHERE ts >= ? AND ts < ? AND durationMs IS NOT NULL ORDER BY durationMs`,
      [from, to],
    )) as Row[];
    const byKey = new Map<string, number[]>();
    for (const r of durations) {
      const key = `${String(r['name'])}\u0001${String(r['dim'])}\u0001${String(r['source'])}`;
      let list = byKey.get(key);
      if (!list) byKey.set(key, (list = []));
      list.push(num(r['durationMs']));
    }
    await db.transaction(async (tx) => {
      for (const g of groups) {
        const key = `${String(g['name'])}\u0001${String(g['dim'])}\u0001${String(g['source'])}`;
        const list = byKey.get(key) ?? [];
        await tx.query(
          `INSERT INTO analytics_daily (day, name, dim, source, events, actors, errors, p50Ms, p95Ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (day, name, dim, source) DO UPDATE SET events = excluded.events, actors = excluded.actors,
             errors = excluded.errors, p50Ms = excluded.p50Ms, p95Ms = excluded.p95Ms`,
          [
            day,
            g['name'],
            String(g['dim']).slice(0, 96),
            g['source'],
            num(g['events']),
            num(g['actors']),
            num(g['errors']),
            quantile(list, 0.5),
            quantile(list, 0.95),
          ],
        );
      }
    });
    return groups.length;
  }

  /** Per-project storage snapshot for `day` (counts and sizes only, never content). */
  async snapshotProjects(day: string): Promise<number> {
    const app = this.app;
    const nowSql = new Date().toISOString().replace('T', ' ').slice(0, 19);
    let written = 0;
    let after = '';
    for (;;) {
      const projects = (await app.query(
        `SELECT p.id, p.ownerId, p.lastOpenedAt FROM projects p WHERE p.id > ? AND ${NOT_SANDBOX} ORDER BY p.id LIMIT ?`,
        [after, SNAPSHOT_BATCH],
      )) as Row[];
      if (projects.length === 0) break;
      after = String(projects[projects.length - 1]['id']);
      const ids = projects.map((p) => String(p['id']));
      const marks = ids.map(() => '?').join(', ');
      const per = async (sql: string, params: unknown[] = []): Promise<Map<string, Row>> => {
        const rows = (await app.query(sql, [...ids, ...params])) as Row[];
        return new Map(rows.map((r) => [String(r['projectId']), r]));
      };
      const tables = await per(`SELECT projectId, COUNT(*) AS n FROM tables WHERE projectId IN (${marks}) GROUP BY projectId`);
      const columns = await per(
        `SELECT t.projectId AS projectId, COUNT(*) AS n FROM columns c JOIN tables t ON t.id = c.tableId
         WHERE t.projectId IN (${marks}) GROUP BY t.projectId`,
      );
      const relationships = await per(
        `SELECT projectId, COUNT(*) AS n FROM relationships WHERE projectId IN (${marks}) GROUP BY projectId`,
      );
      const elements = await per(
        `SELECT projectId, COUNT(*) AS n, SUM(type = 'frame' AND slideJson IS NOT NULL) AS slides,
           SUM(LENGTH(COALESCE(text, '')) + LENGTH(COALESCE(runsJson, ''))) AS textBytes
         FROM elements WHERE projectId IN (${marks}) GROUP BY projectId`,
      );
      const byTypeRows = (await app.query(
        `SELECT projectId, type, COUNT(*) AS n FROM elements WHERE projectId IN (${marks}) GROUP BY projectId, type`,
        ids,
      )) as Row[];
      const sequence = await per(
        `SELECT projectId, SUM(n) AS n FROM (
           SELECT projectId, COUNT(*) AS n FROM lifelines WHERE projectId IN (${marks}) GROUP BY projectId
           UNION ALL
           SELECT projectId, COUNT(*) AS n FROM sequence_messages WHERE projectId IN (${marks}) GROUP BY projectId
         ) GROUP BY projectId`,
        ids,
      );
      const images = await per(
        `SELECT i.projectId AS projectId, COUNT(*) AS n, SUM(COALESCE(i.byteSize, LENGTH(i.data), 0)) AS bytes
         FROM project_images i WHERE i.projectId IN (${marks}) GROUP BY i.projectId`,
      );
      const shares = await per(
        `SELECT projectId, COUNT(*) AS n FROM share_links WHERE projectId IN (${marks})
           AND revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > ?) GROUP BY projectId`,
        [nowSql],
      );
      const byType = new Map<string, Record<string, number>>();
      for (const r of byTypeRows) {
        const key = String(r['projectId']);
        const entry = byType.get(key) ?? {};
        entry[String(r['type'])] = num(r['n']);
        byType.set(key, entry);
      }

      await this.analytics!.transaction(async (tx) => {
        for (const p of projects) {
          const id = String(p['id']);
          const ownerId = p['ownerId'] == null ? null : String(p['ownerId']);
          const textBytes = num(elements.get(id)?.['textBytes']);
          const imageBytes = num(images.get(id)?.['bytes']);
          const lastOpened = p['lastOpenedAt'] ? Date.parse(`${String(p['lastOpenedAt']).replace(' ', 'T')}Z`) : NaN;
          await tx.query(
            `INSERT OR REPLACE INTO analytics_project_snapshot (day, projectId, ownerKind, tables, columns, relationships,
               elements, elementsByType, sequenceItems, slides, images, imageBytes, textBytes, approxBytes, lastOpenedAt,
               shareLinksActive) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              day,
              id,
              !ownerId ? 'anon' : ownerId.startsWith('guest:') ? 'guest' : 'user',
              num(tables.get(id)?.['n']),
              num(columns.get(id)?.['n']),
              num(relationships.get(id)?.['n']),
              num(elements.get(id)?.['n']),
              JSON.stringify(byType.get(id) ?? {}),
              num(sequence.get(id)?.['n']),
              num(elements.get(id)?.['slides']),
              num(images.get(id)?.['n']),
              imageBytes,
              textBytes,
              textBytes + imageBytes,
              Number.isFinite(lastOpened) ? lastOpened : null,
              num(shares.get(id)?.['n']),
            ],
          );
          written++;
        }
      });
      if (projects.length < SNAPSHOT_BATCH) break;
    }
    return written;
  }

  /** Shorter-lived purges than the raw-event retention: api.error rows and old snapshots. */
  async purge(now: number): Promise<number> {
    const db = this.analytics!;
    let removed = 0;
    if (this.config.rawRetentionDays > 0) {
      const errors = (await db.query(`DELETE FROM analytics_event WHERE name = 'api.error' AND ts < ?`, [
        now - ERROR_RETENTION_DAYS * DAY,
      ])) as unknown;
      removed += affected(errors);
    }
    const snapshots = (await db.query(
      `DELETE FROM analytics_project_snapshot WHERE day < ? AND substr(day, 9, 2) <> '01'`,
      [utcDay(now - SNAPSHOT_RETENTION_DAYS * DAY)],
    )) as unknown;
    removed += affected(snapshots);
    return removed;
  }
}

/** Rows changed by a better-sqlite3 DELETE through TypeORM (an array [rows, changes] or a run result). */
function affected(result: unknown): number {
  if (Array.isArray(result) && typeof result[1] === 'number') return result[1];
  if (result && typeof result === 'object' && 'changes' in result) return num((result as { changes: unknown }).changes);
  return 0;
}
