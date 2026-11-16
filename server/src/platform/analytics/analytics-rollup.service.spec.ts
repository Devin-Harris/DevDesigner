import type { DataSource } from 'typeorm';
import { AnalyticsRollupService, msUntilNextRun, quantile } from './analytics-rollup.service';
import type { AnalyticsConfig } from './analytics.config';
import { AnalyticsService } from './analytics.service';
import type { DbAnalyticsSink } from './sinks/db.sink';
import { AdminHygieneService } from '../../identity/admin/admin-hygiene.service';
import {
  DAY,
  HOUR,
  NOW,
  event,
  insertElement,
  insertImage,
  insertProject,
  insertShareLink,
  openDatabases,
} from '../../identity/admin/testing/admin-fixtures';

const config = { enabled: true, rawRetentionDays: 90 } as AnalyticsConfig;

describe('AnalyticsRollupService (nightly jobs, audit 04 Phase 4)', () => {
  let app: DataSource;
  let analytics: DataSource;
  let sink: DbAnalyticsSink;
  let rollup: AnalyticsRollupService;

  beforeEach(async () => {
    ({ app, analytics, sink } = await openDatabases());
    rollup = new AnalyticsRollupService(config, app, analytics);
  });

  afterEach(async () => {
    await Promise.all([app.destroy(), analytics.destroy()]);
  });

  it('schedules for the next 02:10 UTC', () => {
    expect(msUntilNextRun(Date.UTC(2026, 0, 1, 1, 0))).toBe(70 * 60_000);
    expect(msUntilNextRun(Date.UTC(2026, 0, 1, 3, 0))).toBe((23 * 60 + 10) * 60_000);
  });

  it('computes quantiles', () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(quantile([1, 2, 3, 4, 100], 0.95)).toBe(100);
  });

  it('upserts daily rollups idempotently, with actors, errors and latency percentiles', async () => {
    const yesterday = NOW - DAY;
    sink.write([
      event({ ts: yesterday, durationMs: 10 }),
      event({ ts: yesterday + HOUR, durationMs: 30, actorId: 'user-2' }),
      event({ ts: yesterday + 2 * HOUR, durationMs: 50, status: 500 }),
      event({ ts: yesterday, name: 'project.created', route: null, durationMs: null, count: 3, props: null }),
      event({ ts: NOW, durationMs: 999 }), // today: not part of yesterday
    ]);
    const day = new Date(yesterday).toISOString().slice(0, 10);
    await rollup.rollupDay(day);
    await rollup.rollupDay(day);
    const rows = (await analytics.query('SELECT * FROM analytics_daily WHERE day = ? ORDER BY name', [day])) as Array<
      Record<string, unknown>
    >;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'api.request', events: 3, actors: 2, errors: 1, p50Ms: 30, p95Ms: 50 });
    expect(rows[1]).toMatchObject({ name: 'project.created', dim: '', events: 3, p50Ms: null });
  });

  it('snapshots projects (no sandboxes) and the run reports its status', async () => {
    const p = await insertProject(app, { ownerId: 'guest:abc' });
    await insertProject(app, { ownerId: 'u1', description: 'dd-guide-sandbox' });
    await insertElement(app, p, { type: 'text', text: 'hello' });
    await insertElement(app, p, { type: 'frame', slide: true });
    await insertImage(app, p, { byteSize: 1000 });
    await insertShareLink(app, p);
    const status = await rollup.run(NOW);
    expect(status.lastError).toBeNull();
    expect(status.snapshots).toBe(1);
    const [snap] = (await analytics.query('SELECT * FROM analytics_project_snapshot')) as Array<Record<string, unknown>>;
    expect(snap).toMatchObject({
      projectId: p,
      ownerKind: 'guest',
      elements: 2,
      slides: 1,
      images: 1,
      imageBytes: 1000,
      textBytes: 5,
      shareLinksActive: 1,
    });
    expect(JSON.parse(String(snap['elementsByType']))).toEqual({ text: 1, frame: 1 });
  });

  it('purges old api.error rows and old snapshots except month starts', async () => {
    sink.write([
      event({ name: 'api.error', ts: NOW - 40 * DAY }),
      event({ name: 'api.error', ts: NOW - 5 * DAY }),
      event({ ts: NOW - 40 * DAY }),
    ]);
    for (const day of ['2026-09-01', '2026-09-15', '2026-11-01']) {
      await analytics.query(
        `INSERT INTO analytics_project_snapshot (day, projectId, ownerKind) VALUES (?, 'p', 'user')`,
        [day],
      );
    }
    await rollup.purge(NOW);
    const names = (await analytics.query('SELECT name FROM analytics_event ORDER BY ts')) as Array<{ name: string }>;
    expect(names.map((r) => r.name)).toEqual(['api.request', 'api.error']);
    const days = (await analytics.query('SELECT day FROM analytics_project_snapshot ORDER BY day')) as Array<{
      day: string;
    }>;
    expect(days.map((r) => r.day)).toEqual(['2026-09-01', '2026-11-01']);
  });

  it('erases a deleted account from stored and buffered analytics', async () => {
    const service = new AnalyticsService({ ...config, saltSecret: 'x', maxBufferRows: 100, flushAtRows: 100 } as AnalyticsConfig, [
      sink,
    ]);
    sink.write([event({ actorId: 'gone' }), event({ actorId: 'kept' })]);
    expect(await service.erase({ userId: 'gone' })).toBeGreaterThan(0);
    service.track({ name: 'auth.logout', principal: { userId: 'gone' } });
    expect(service.depth).toBe(0);
    const actors = (await analytics.query('SELECT DISTINCT actorId FROM analytics_event')) as Array<{ actorId: string }>;
    expect(actors.map((r) => r.actorId)).toEqual(['kept']);
    const days = (await analytics.query(`SELECT COUNT(*) AS n FROM analytics_actor_day WHERE actorId = 'gone'`)) as Array<{
      n: number;
    }>;
    expect(days[0].n).toBe(0);
  });

  it('hygiene preview counts candidates without deleting anything', async () => {
    const old = await insertProject(app, { ownerId: 'guest:x', createdAt: NOW - 400 * DAY, lastOpenedAt: NOW - 200 * DAY });
    await insertProject(app, { ownerId: 'guest:y', lastOpenedAt: NOW - DAY });
    await insertImage(app, old, { byteSize: 500 });
    await insertShareLink(app, old, { expiresAt: NOW - 100 * DAY });
    const hygiene = new AdminHygieneService(app, rollup);
    const preview = await hygiene.preview(NOW);
    expect(preview.dormantGuestProjects).toEqual({ count: 1, bytes: 500 });
    expect(preview.orphanImages).toEqual({ count: 1, bytes: 500 });
    expect(preview.staleShareLinks.count).toBe(1);
    const [{ n }] = (await app.query('SELECT COUNT(*) AS n FROM projects')) as Array<{ n: number }>;
    expect(n).toBe(2);
  });
});
