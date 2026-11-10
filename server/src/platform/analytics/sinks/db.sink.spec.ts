import { DataSource } from 'typeorm';
import { buildAnalyticsDataSourceOptions } from '../analytics-data-source';
import type { AnalyticsRow } from '../analytics.types';
import { DB_SINK_BATCH, DbAnalyticsSink } from './db.sink';

function row(i: number, overrides: Partial<AnalyticsRow> = {}): AnalyticsRow {
  return {
    ts: Date.UTC(2026, 10, 10, 12) + i,
    name: 'api.request',
    source: 'web',
    actorType: 'user',
    actorId: `user-${i % 3}`,
    tokenId: null,
    projectId: 'p1',
    route: 'PATCH /api/projects/:projectId/batch',
    status: 200,
    durationMs: 4,
    count: 1,
    props: '{"method":"PATCH","sample":1}',
    mcpTool: null,
    ipHash: 'abcdabcdabcdabcd',
    ua: 'chrome/windows',
    requestId: `r-${i}`,
    ...overrides,
  };
}

describe('DbAnalyticsSink', () => {
  let ds: DataSource;
  let sink: DbAnalyticsSink;

  beforeEach(async () => {
    ds = new DataSource(buildAnalyticsDataSourceOptions(':memory:'));
    await ds.initialize();
    sink = new DbAnalyticsSink(ds);
  });

  afterEach(() => ds.destroy());

  it('creates its schema through its own migrations', async () => {
    const tables = (await ds.query(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)) as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['analytics_actor_day', 'analytics_daily', 'analytics_event', 'analytics_project_snapshot']),
    );
  });

  it('inserts more than one batch of rows and records active actors per day', async () => {
    const n = DB_SINK_BATCH * 2 + 17;
    sink.write([
      ...Array.from({ length: n }, (_, i) => row(i)),
      row(0, { actorType: 'system', actorId: null }),
    ]);
    const [{ c }] = (await ds.query('SELECT COUNT(*) c FROM analytics_event')) as Array<{ c: number }>;
    expect(c).toBe(n + 1);
    const actors = (await ds.query('SELECT actorId FROM analytics_actor_day ORDER BY actorId')) as Array<{ actorId: string }>;
    expect(actors.map((a) => a.actorId)).toEqual(['user-0', 'user-1', 'user-2']);
    const [first] = (await ds.query('SELECT * FROM analytics_event ORDER BY id LIMIT 1')) as Array<Record<string, unknown>>;
    expect(first).toMatchObject({ name: 'api.request', route: 'PATCH /api/projects/:projectId/batch', count: 1 });
  });

  it('purges raw events older than the cutoff', async () => {
    sink.write([row(0, { ts: 1_000 }), row(1, { ts: 5_000 })]);
    expect(sink.purge(2_000)).toBe(1);
    const [{ c }] = (await ds.query('SELECT COUNT(*) c FROM analytics_event')) as Array<{ c: number }>;
    expect(c).toBe(1);
  });
});
