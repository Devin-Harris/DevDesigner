import { BadRequestException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { AdminKpi } from '@devdesigner/shared';
import type { RealtimeGateway } from '../../platform/realtime/realtime.gateway';
import type { DbAnalyticsSink } from '../../platform/analytics/sinks/db.sink';
import { AdminAnalyticsService } from './admin-analytics.service';
import { explicitWindow } from './admin-window';
import { DAY, HOUR, NOW, event, insertProject, insertUser, openDatabases } from './testing/admin-fixtures';

describe('AdminAnalyticsService', () => {
  let app: DataSource;
  let analytics: DataSource;
  let sink: DbAnalyticsSink;

  const kpi = (kpis: AdminKpi[], key: AdminKpi['key']): AdminKpi | undefined => kpis.find((k) => k.key === key);

  beforeEach(async () => {
    ({ app, analytics, sink } = await openDatabases());
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all([app.destroy(), analytics.destroy()]);
  });

  const service = (gateway?: Partial<RealtimeGateway>): AdminAnalyticsService =>
    new AdminAnalyticsService(app, analytics, gateway as RealtimeGateway | undefined);

  describe('overview', () => {
    it('counts active users and guests per window, with the previous window as delta', async () => {
      sink.write([
        event({ actorId: 'u1' }),
        event({ actorId: 'u2', ts: NOW - 3 * DAY }),
        event({ actorId: 'u1', actorType: 'token', tokenId: 't1', source: 'mcp', mcpTool: 'add_table' }),
        event({ actorType: 'guest', actorId: 'g1' }),
        event({ actorId: 'u3', ts: NOW - 10 * DAY }),
      ]);
      const result = await service().overview('7d', NOW);
      expect(result).toMatchObject({ range: '7d', from: '2026-11-04', to: '2026-11-10', analyticsEnabled: true });
      expect(kpi(result.kpis, 'activeUsers')).toMatchObject({ value: 2, previous: 1 });
      expect(kpi(result.kpis, 'activeGuests')).toMatchObject({ value: 1, previous: 0 });
      expect(kpi(result.kpis, 'mcpCalls')).toMatchObject({ value: 1 });
      expect(kpi(result.kpis, 'mau')).toMatchObject({ value: 3 });
      expect(result.series.activeUsers).toHaveLength(7);
      expect(result.series.activeUsers.at(-1)).toEqual({ day: '2026-11-10', value: 1 });
    });

    it('scales sampled GETs back up for the error rate and takes p95 over recorded durations', async () => {
      sink.write([
        event({ props: '{"method":"GET","sample":0.1}', count: 1, durationMs: 5 }),
        ...Array.from({ length: 9 }, (_, i) => event({ durationMs: 10 + i })),
        event({ status: 500, durationMs: 900 }),
      ]);
      const result = await service().overview('7d', NOW);
      // 10 (scaled GET) + 9 + 1 = 20 requests, 1 server error.
      expect(kpi(result.kpis, 'errorRate')?.value).toBe(5);
      expect(kpi(result.kpis, 'p95Ms')?.value).toBe(900);
      expect(result.series.errors.at(-1)?.value).toBe(1);
    });

    it('takes signups and projects from the app DB, skipping guide sandboxes', async () => {
      const ada = await insertUser(app, { email: 'ada@example.com', createdAt: NOW - DAY });
      await insertUser(app, { email: 'old@example.com', createdAt: NOW - 9 * DAY });
      await insertProject(app, { ownerId: ada, createdAt: NOW - HOUR });
      await insertProject(app, { ownerId: ada, createdAt: NOW - HOUR, description: 'dd-guide-sandbox' });
      const result = await service().overview('7d', NOW);
      expect(kpi(result.kpis, 'signups')).toMatchObject({ value: 1, previous: 1 });
      expect(kpi(result.kpis, 'projectsCreated')).toMatchObject({ value: 1, previous: 0 });
      expect(kpi(result.kpis, 'dbBytes')?.value).toBeGreaterThan(0);
    });

    it('returns null analytics KPIs (but app-DB ones) when analytics is off', async () => {
      await insertUser(app, { email: 'ada@example.com', createdAt: NOW - DAY });
      const result = await new AdminAnalyticsService(app, undefined).overview('30d', NOW);
      expect(result.analyticsEnabled).toBe(false);
      expect(kpi(result.kpis, 'activeUsers')).toMatchObject({ value: null, previous: null });
      expect(kpi(result.kpis, 'signups')?.value).toBe(1);
      expect(result.series.activeUsers.every((p) => p.value === 0)).toBe(true);
    });
  });

  it('filters entity writes by mutation kind in a timeseries', async () => {
    sink.write([
      event({ name: 'entity.write', props: '{"kind":"table.created"}', count: 3 }),
      event({ name: 'entity.write', props: '{"kind":"element.moved","elementType":"text"}', count: 40 }),
    ]);
    const all = await service().timeseries('entity_writes', undefined, '2026-11-09', '2026-11-10');
    const tables = await service().timeseries('entity_writes', 'table.created', '2026-11-09', '2026-11-10');
    expect(all.points).toEqual([
      { day: '2026-11-09', value: 0 },
      { day: '2026-11-10', value: 43 },
    ]);
    expect(tables.points.at(-1)?.value).toBe(3);
  });

  it('groups feature usage by kind, element type and feature event', async () => {
    sink.write([
      event({ name: 'entity.write', props: '{"kind":"element.created","elementType":"code"}', count: 2, actorId: 'u1' }),
      event({ name: 'entity.write', props: '{"kind":"element.created","elementType":"code"}', count: 1, actorId: 'u2' }),
      event({ name: 'export.sql', props: '{"dialect":"postgres"}' }),
      event({ name: 'client.export_image', props: '{"format":"png","scope":"slide"}', source: 'client' }),
      event({ name: 'client.present', props: '{"action":"start"}', source: 'client' }),
    ]);
    const result = await service().features('30d');
    expect(result.writesByKind).toEqual([{ key: 'element.created', count: 3, users: 2 }]);
    expect(result.elementTypes).toEqual([{ key: 'code', count: 3, users: 2 }]);
    expect(result.events.map((e) => e.key)).toEqual(
      expect.arrayContaining(['export.sql', 'client.export_image', 'client.present:start']),
    );
    expect(result.exportFormats).toEqual(
      expect.arrayContaining([
        { key: 'sql:postgres', count: 1 },
        { key: 'png', count: 1 },
      ]),
    );
  });

  it('builds weekly signup cohorts from users and their active days', async () => {
    // NOW is Tuesday 2026-11-10; its week starts Monday 2026-11-09.
    const early = await insertUser(app, { email: 'a@x.io', createdAt: Date.UTC(2026, 10, 3) });
    await insertUser(app, { email: 'b@x.io', createdAt: Date.UTC(2026, 10, 4) });
    sink.write([
      event({ actorId: early, ts: Date.UTC(2026, 10, 3, 9) }),
      event({ actorId: early, ts: Date.UTC(2026, 10, 10, 9) }),
    ]);
    const result = await service().retention(2, NOW);
    expect(result.cohorts).toEqual([
      { week: '2026-11-02', size: 2, active: [1, 1] },
      { week: '2026-11-09', size: 0, active: [0] },
    ]);
  });

  it('reports per-token calls, errors and top MCP tools', async () => {
    const owner = await insertUser(app, { email: 'dev@x.io' });
    await app.query(
      `INSERT INTO api_tokens (id, userId, name, scope, tokenHash, prefix) VALUES ('t1', ?, 'CI', 'write', 'h', 'ddt_1')`,
      [owner],
    );
    const call = { actorType: 'token' as const, actorId: owner, tokenId: 't1', source: 'mcp' as const };
    sink.write([
      event({ ...call, mcpTool: 'add_table', durationMs: 20 }),
      event({ ...call, mcpTool: 'add_table', durationMs: 40 }),
      event({ ...call, mcpTool: 'list_projects', status: 500 }),
    ]);
    const result = await service().apiTokens('7d');
    expect(result.tokens).toEqual([
      expect.objectContaining({
        id: 't1',
        ownerEmail: 'dev@x.io',
        calls: 3,
        errors: 1,
        topTools: [
          { key: 'add_table', count: 2 },
          { key: 'list_projects', count: 1 },
        ],
      }),
    ]);
    expect(result.tools[0]).toEqual({ key: 'add_table', count: 2, errors: 0, p95Ms: 40 });
    expect(result.sources).toEqual([{ key: 'mcp', count: 3 }]);
  });

  it('groups errors by route and status, 5xx first, and lists slow routes', async () => {
    sink.write([
      event({ status: 404, route: 'GET /api/projects/:projectId', requestId: 'r1' }),
      event({ status: 404, route: 'GET /api/projects/:projectId', requestId: 'r2' }),
      event({ status: 500, route: 'POST /api/projects/import', requestId: 'r3' }),
      event({ props: '{"method":"PATCH","sample":1,"slow":true}', durationMs: 2500 }),
      event({ name: 'client.error', props: '{"kind":"chunk_load"}', source: 'client' }),
    ]);
    const result = await service().errors('7d');
    expect(result.groups.map((g) => [g.route, g.status, g.count])).toEqual([
      ['POST /api/projects/import', 500, 1],
      ['GET /api/projects/:projectId', 404, 2],
    ]);
    expect(result).toMatchObject({ requests: 4, serverErrors: 1, clientErrors: 2 });
    expect(result.slow).toEqual([{ route: 'PATCH /api/projects/:projectId/batch', count: 1, p95Ms: 2500, maxMs: 2500 }]);
    expect(result.clientEvents).toEqual([{ key: 'chunk_load', count: 1 }]);
  });

  it('pages raw events newest first with a cursor', async () => {
    sink.write(Array.from({ length: 5 }, (_, i) => event({ ts: NOW - i * HOUR, requestId: `r${i}` })));
    const first = await service().events({ limit: 2 });
    expect(first.items.map((e) => e.requestId)).toEqual(['r4', 'r3']);
    const second = await service().events({ limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((e) => e.requestId)).toEqual(['r2', 'r1']);
    const last = await service().events({ limit: 2, cursor: second.nextCursor! });
    expect(last).toMatchObject({ nextCursor: null });
    expect(last.items[0].props).toEqual({ method: 'PATCH', sample: 1 });
  });

  it('joins live rooms with project names and summarizes sessions', async () => {
    const projectId = await insertProject(app, { ownerId: null, name: 'Roadmap' });
    sink.write([
      event({ name: 'realtime.joined', props: '{"access":"EDIT","roomSize":1}' }),
      event({ name: 'realtime.left', props: '{"sessionMs":60000,"roomSize":0}' }),
      event({ name: 'present.started', props: null }),
    ]);
    const snapshot = jest.fn(() => [{ projectId, participants: 3, editors: 2, viewers: 1, presenters: 1 }]);
    const result = await service({ snapshot }).realtime(NOW);
    expect(result.rooms).toEqual([{ projectId, projectName: 'Roadmap', participants: 3, editors: 2, viewers: 1, presenters: 1 }]);
    expect(result.totals).toEqual({ rooms: 1, participants: 3, presenters: 1 });
    expect(result).toMatchObject({ sessionP50Ms: 60000, presents30d: 1 });
    expect(result.joins).toHaveLength(30);
  });
});

describe('explicitWindow', () => {
  it('defaults to the last N days and rejects reversed, over-long or future windows', () => {
    expect(explicitWindow(undefined, undefined, 7, NOW)).toMatchObject({ from: '2026-11-04', to: '2026-11-10' });
    expect(() => explicitWindow('2026-11-10', '2026-11-01', 7, NOW)).toThrow(BadRequestException);
    expect(() => explicitWindow('2024-01-01', '2026-11-10', 7, NOW)).toThrow(BadRequestException);
    expect(() => explicitWindow('2026-11-01', '2027-01-01', 7, NOW)).toThrow(BadRequestException);
  });
});
