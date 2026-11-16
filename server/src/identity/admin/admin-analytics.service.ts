import { Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type {
  AdminApiTokensResponse,
  AdminCohort,
  AdminCount,
  AdminErrorsResponse,
  AdminEventRow,
  AdminEventsResponse,
  AdminFeaturesResponse,
  AdminFeatureUsage,
  AdminKpi,
  AdminMetric,
  AdminOverviewResponse,
  AdminRange,
  AdminRealtimeResponse,
  AdminRetentionResponse,
  AdminSeriesPoint,
  AdminTimeseriesResponse,
  AdminWindow,
  RealtimeRoomSnapshot,
} from '@devdesigner/shared';
import { ANALYTICS_CONNECTION } from '../../platform/analytics/analytics.config';
import { RealtimeGateway } from '../../platform/realtime/realtime.gateway';
import { EST_REQUESTS, NOT_SANDBOX, TS_DAY, USER_ACTORS, num } from './admin-sql';
import {
  DAY_MS,
  type DayWindow,
  dayStartMs,
  denseSeries,
  explicitWindow,
  isoOrNull,
  percentile,
  rangeWindow,
  sqlDatetime,
  utcDayOf,
  weekStartDay,
  windowOf,
} from './admin-window';

type Row = Record<string, unknown>;

/** Feature events listed on the usage page (beyond entity writes). */
const FEATURE_EVENTS = [
  'present.started',
  'client.present',
  'project.exported',
  'export.sql',
  'client.export_image',
  'project.imported',
  'project.duplicated',
  'share.created',
  'share.opened',
  'image.uploaded',
  'realtime.joined',
  'client.laser',
  'client.guide_tab',
  'token.created',
] as const;

const EXPORT_EVENTS = `('project.exported', 'export.sql', 'client.export_image')`;
/** Rows read at most when computing percentiles in memory. */
const PERCENTILE_SAMPLE = 50_000;

/** Metric -> analytics WHERE clause (and the value expression) for the timeseries endpoint. */
const EVENT_METRICS: Partial<Record<AdminMetric, { where: string; value?: string; dimProp?: string }>> = {
  entity_writes: { where: `name = 'entity.write'`, dimProp: '$.kind' },
  requests: { where: `name = 'api.request'`, value: EST_REQUESTS },
  mcp_calls: { where: `name = 'api.request' AND source = 'mcp'`, dimProp: 'mcpTool' },
  errors: { where: `name = 'api.request' AND status >= 500` },
  share_opens: { where: `name = 'share.opened'` },
  realtime_joins: { where: `name = 'realtime.joined'` },
  presents: {
    where: `(name = 'present.started' OR (name = 'client.present' AND json_extract(props, '$.action') = 'start'))`,
  },
  exports: { where: `name IN ${EXPORT_EVENTS}` },
};

/**
 * Read-only queries for the admin dashboard over analytics.sqlite (raw events +
 * analytics_actor_day) and, for signups/projects, the app database. Until the Phase 4
 * rollup fills analytics_daily, everything is computed from raw events, which are
 * kept ANALYTICS_RAW_RETENTION_DAYS (90) days. With analytics off the analytics
 * DataSource does not exist: analytics-backed numbers come back empty and the
 * responses say `analyticsEnabled: false`.
 */
@Injectable()
export class AdminAnalyticsService {
  constructor(
    @InjectDataSource() private readonly app: DataSource,
    @Optional() @InjectDataSource(ANALYTICS_CONNECTION) private readonly analytics?: DataSource,
    @Optional() private readonly gateway?: RealtimeGateway,
  ) {}

  get analyticsEnabled(): boolean {
    return !!this.analytics?.isInitialized;
  }

  // ------------------------------------------------------------ overview

  async overview(range: AdminRange, now = Date.now()): Promise<AdminOverviewResponse> {
    const w = rangeWindow(range, now);
    const prev = windowOf(utcDayOf(w.prevStartMs), utcDayOf(w.prevEndMs - DAY_MS));
    const today = dayStartMs(w.to);
    const last = (days: number, offsetDays = 0): [string, string] => [
      utcDayOf(today - (days - 1 + offsetDays) * DAY_MS),
      utcDayOf(today - offsetDays * DAY_MS),
    ];

    const [usersNow, usersPrev, guestsNow, guestsPrev] = await Promise.all([
      this.distinctActors(w.from, w.to, USER_ACTORS),
      this.distinctActors(prev.from, prev.to, USER_ACTORS),
      this.distinctActors(w.from, w.to, `('guest')`),
      this.distinctActors(prev.from, prev.to, `('guest')`),
    ]);
    const [wau, wauPrev, mau, mauPrev] = await Promise.all([
      this.distinctActors(...last(7), USER_ACTORS),
      this.distinctActors(...last(7, 7), USER_ACTORS),
      this.distinctActors(...last(30), USER_ACTORS),
      this.distinctActors(...last(30, 30), USER_ACTORS),
    ]);
    const [dailyUsers, dailyUsersPrev, dailyGuests] = await Promise.all([
      this.dailyActors(w, USER_ACTORS),
      this.dailyActors(prev, USER_ACTORS),
      this.dailyActors(w, `('guest')`),
    ]);
    const [signups, signupsPrev, created, createdPrev] = await Promise.all([
      this.dailyAppCount('users', 'u', '1 = 1', w),
      this.dailyAppCount('users', 'u', '1 = 1', prev),
      this.dailyAppCount('projects', 'p', NOT_SANDBOX, w),
      this.dailyAppCount('projects', 'p', NOT_SANDBOX, prev),
    ]);
    const [requests, requestsPrev, errors, errorsPrev] = await Promise.all([
      this.dailyEvents(w, `name = 'api.request'`, EST_REQUESTS),
      this.dailyEvents(prev, `name = 'api.request'`, EST_REQUESTS),
      this.dailyEvents(w, `name = 'api.request' AND status >= 500`),
      this.dailyEvents(prev, `name = 'api.request' AND status >= 500`),
    ]);
    const span = (x: DayWindow): [number, number] => [x.startMs, x.endMs];
    const [conversions, conversionsPrev, activeProjects, activeProjectsPrev, mcp, mcpPrev, p95, p95Prev] =
      await Promise.all([
        this.scalar(`SELECT COUNT(*) AS n FROM analytics_event WHERE name = 'guest.claimed' AND ts >= ? AND ts < ?`, span(w)),
        this.scalar(`SELECT COUNT(*) AS n FROM analytics_event WHERE name = 'guest.claimed' AND ts >= ? AND ts < ?`, span(prev)),
        this.scalar(this.activeProjectsSql(), span(w)),
        this.scalar(this.activeProjectsSql(), span(prev)),
        this.scalar(this.mcpCallsSql(), span(w)),
        this.scalar(this.mcpCallsSql(), span(prev)),
        this.percentileOf(`name = 'api.request' AND durationMs IS NOT NULL`, span(w), 'durationMs', 0.95),
        this.percentileOf(`name = 'api.request' AND durationMs IS NOT NULL`, span(prev), 'durationMs', 0.95),
      ]);

    const sum = (s: AdminSeriesPoint[]): number => s.reduce((acc, p) => acc + p.value, 0);
    const avg = (s: AdminSeriesPoint[]): number => (s.length ? Math.round((sum(s) / s.length) * 10) / 10 : 0);
    const rate = (e: AdminSeriesPoint[], r: AdminSeriesPoint[]): number | null =>
      sum(r) > 0 ? Math.round((sum(e) / sum(r)) * 10_000) / 100 : null;
    // Signups, projects created and DB size come from the app DB; the rest need analytics.
    const appBacked = new Set<AdminKpi['key']>(['signups', 'projectsCreated', 'dbBytes']);
    const kpi = (key: AdminKpi['key'], value: number | null, previous: number | null, unit: AdminKpi['unit'] = 'count'): AdminKpi =>
      this.analyticsEnabled || appBacked.has(key) ? { key, value, previous, unit } : { key, value: null, previous: null, unit };

    return {
      ...this.windowOf(range, w),
      kpis: [
        kpi('activeUsers', usersNow, usersPrev),
        kpi('activeGuests', guestsNow, guestsPrev),
        kpi('dau', avg(dailyUsers), avg(dailyUsersPrev)),
        kpi('wau', wau, wauPrev),
        kpi('mau', mau, mauPrev),
        kpi('signups', sum(signups), sum(signupsPrev)),
        kpi('guestConversions', conversions, conversionsPrev),
        kpi('projectsCreated', sum(created), sum(createdPrev)),
        kpi('activeProjects', activeProjects, activeProjectsPrev),
        kpi('mcpCalls', mcp, mcpPrev),
        kpi('errorRate', rate(errors, requests), rate(errorsPrev, requestsPrev), 'percent'),
        kpi('p95Ms', p95, p95Prev, 'ms'),
        kpi('dbBytes', await this.appDbBytes(), null, 'bytes'),
      ],
      series: {
        activeUsers: dailyUsers,
        activeGuests: dailyGuests,
        signups,
        projectsCreated: created,
        requests: requests.map((p) => ({ day: p.day, value: Math.round(p.value) })),
        errors,
      },
    };
  }

  // ------------------------------------------------------------ timeseries

  async timeseries(metric: AdminMetric, dim: string | undefined, from?: string, to?: string): Promise<AdminTimeseriesResponse> {
    const w = explicitWindow(from, to, 30);
    let points: AdminSeriesPoint[];
    if (metric === 'active_users') points = await this.dailyActors(w, USER_ACTORS);
    else if (metric === 'active_guests') points = await this.dailyActors(w, `('guest')`);
    else if (metric === 'signups') points = await this.dailyAppCount('users', 'u', '1 = 1', w);
    else if (metric === 'projects_created') points = await this.dailyAppCount('projects', 'p', NOT_SANDBOX, w);
    else {
      const spec = EVENT_METRICS[metric]!;
      let where = spec.where;
      const params: unknown[] = [];
      if (dim && spec.dimProp) {
        where += spec.dimProp.startsWith('$') ? ` AND json_extract(props, '${spec.dimProp}') = ?` : ` AND ${spec.dimProp} = ?`;
        params.push(dim);
      }
      points = (await this.dailyEvents(w, where, spec.value, params)).map((p) => ({ day: p.day, value: Math.round(p.value) }));
    }
    return { metric, dim: dim ?? '', from: w.from, to: w.to, points };
  }

  // ------------------------------------------------------------ features

  async features(range: AdminRange): Promise<AdminFeaturesResponse> {
    const w = rangeWindow(range);
    const span = [w.startMs, w.endMs];
    const usage = (rows: Row[]): AdminFeatureUsage[] =>
      rows.filter((r) => r['k'] !== null).map((r) => ({ key: String(r['k']), count: num(r['c']), users: num(r['u']) }));
    const usersExpr = `COUNT(DISTINCT CASE WHEN actorType IN ${USER_ACTORS} THEN actorId END) AS u`;
    const [activeUsers, kinds, types, events, formats] = await Promise.all([
      this.distinctActors(w.from, w.to, USER_ACTORS),
      this.rows(
        `SELECT json_extract(props, '$.kind') AS k, SUM(count) AS c, ${usersExpr} FROM analytics_event
         WHERE name = 'entity.write' AND ts >= ? AND ts < ? GROUP BY k ORDER BY c DESC LIMIT 60`,
        span,
      ),
      this.rows(
        `SELECT json_extract(props, '$.elementType') AS k, SUM(count) AS c, ${usersExpr} FROM analytics_event
         WHERE name = 'entity.write' AND ts >= ? AND ts < ? AND json_extract(props, '$.elementType') IS NOT NULL
         GROUP BY k ORDER BY c DESC`,
        span,
      ),
      this.rows(
        `SELECT CASE
           WHEN name = 'client.present' THEN 'client.present:' || COALESCE(json_extract(props, '$.action'), '?')
           WHEN name = 'client.laser' THEN 'client.laser:' || COALESCE(json_extract(props, '$.action'), '?')
           ELSE name END AS k, SUM(count) AS c, ${usersExpr}
         FROM analytics_event WHERE name IN (${FEATURE_EVENTS.map(() => '?').join(', ')}) AND ts >= ? AND ts < ?
         GROUP BY k ORDER BY c DESC`,
        [...FEATURE_EVENTS, ...span],
      ),
      this.rows(
        `SELECT CASE name
           WHEN 'project.exported' THEN 'file'
           WHEN 'export.sql' THEN 'sql:' || COALESCE(json_extract(props, '$.dialect'), 'mysql')
           ELSE COALESCE(json_extract(props, '$.format'), 'image') END AS k, SUM(count) AS c
         FROM analytics_event WHERE name IN ${EXPORT_EVENTS} AND ts >= ? AND ts < ? GROUP BY k ORDER BY c DESC`,
        span,
      ),
    ]);
    return {
      ...this.windowOf(range, w),
      activeUsers: activeUsers ?? 0,
      writesByKind: usage(kinds),
      elementTypes: usage(types),
      events: usage(events),
      exportFormats: formats.map((r) => ({ key: String(r['k']), count: num(r['c']) })),
    };
  }

  // ------------------------------------------------------------ retention

  async retention(weeks = 8, now = Date.now()): Promise<AdminRetentionResponse> {
    const currentWeek = weekStartDay(now);
    const firstWeek = utcDayOf(dayStartMs(currentWeek) - (weeks - 1) * 7 * DAY_MS);
    const users = (await this.app.query(`SELECT id, createdAt FROM users WHERE createdAt >= ?`, [
      sqlDatetime(dayStartMs(firstWeek)),
    ])) as Row[];
    const cohortOf = new Map<string, string>();
    const sizes = new Map<string, number>();
    for (const user of users) {
      const created = isoOrNull(user['createdAt']);
      if (!created) continue;
      const week = weekStartDay(Date.parse(created));
      cohortOf.set(String(user['id']), week);
      sizes.set(week, (sizes.get(week) ?? 0) + 1);
    }
    const activity = await this.rows(
      `SELECT DISTINCT day, actorId FROM analytics_actor_day WHERE actorType IN ${USER_ACTORS} AND day >= ?`,
      [firstWeek],
    );
    const seen = new Set<string>();
    const active = new Map<string, number[]>();
    for (const row of activity) {
      const id = String(row['actorId']);
      const cohort = cohortOf.get(id);
      if (!cohort) continue;
      const offset = Math.floor((dayStartMs(String(row['day'])) - dayStartMs(cohort)) / (7 * DAY_MS));
      const key = `${id}|${offset}`;
      if (offset < 0 || seen.has(key)) continue;
      seen.add(key);
      const counts = active.get(cohort) ?? [];
      counts[offset] = (counts[offset] ?? 0) + 1;
      active.set(cohort, counts);
    }
    const cohorts: AdminCohort[] = [];
    for (let i = 0; i < weeks; i++) {
      const week = utcDayOf(dayStartMs(firstWeek) + i * 7 * DAY_MS);
      const elapsed = weeks - i;
      const counts = active.get(week) ?? [];
      cohorts.push({ week, size: sizes.get(week) ?? 0, active: Array.from({ length: elapsed }, (_, k) => counts[k] ?? 0) });
    }
    return { weeks, analyticsEnabled: this.analyticsEnabled, cohorts };
  }

  // ------------------------------------------------------------ api tokens

  async apiTokens(range: AdminRange): Promise<AdminApiTokensResponse> {
    const w = rangeWindow(range);
    const span = [w.startMs, w.endMs];
    const tokens = (await this.app.query(
      `SELECT t.id, t.name, t.prefix, t.scope, t.createdAt, t.lastUsedAt, t.revokedAt, u.email AS ownerEmail
       FROM api_tokens t LEFT JOIN users u ON u.id = t.userId
       ORDER BY t.revokedAt IS NOT NULL, COALESCE(t.lastUsedAt, t.createdAt) DESC LIMIT 200`,
    )) as Row[];
    const [usage, perTokenTools, tools, durations, routes, sources] = await Promise.all([
      this.rows(
        `SELECT tokenId, SUM(count) AS calls, SUM(CASE WHEN status >= 400 THEN count ELSE 0 END) AS errors
         FROM analytics_event WHERE name = 'api.request' AND tokenId IS NOT NULL AND ts >= ? AND ts < ? GROUP BY tokenId`,
        span,
      ),
      this.rows(
        `SELECT tokenId, mcpTool, SUM(count) AS c FROM analytics_event
         WHERE name = 'api.request' AND tokenId IS NOT NULL AND mcpTool IS NOT NULL AND ts >= ? AND ts < ?
         GROUP BY tokenId, mcpTool ORDER BY c DESC`,
        span,
      ),
      this.rows(
        `SELECT mcpTool AS k, SUM(count) AS c, SUM(CASE WHEN status >= 400 THEN count ELSE 0 END) AS e
         FROM analytics_event WHERE name = 'api.request' AND mcpTool IS NOT NULL AND ts >= ? AND ts < ?
         GROUP BY mcpTool ORDER BY c DESC LIMIT 50`,
        span,
      ),
      this.rows(
        `SELECT mcpTool AS k, durationMs AS d FROM analytics_event
         WHERE name = 'api.request' AND mcpTool IS NOT NULL AND durationMs IS NOT NULL AND ts >= ? AND ts < ?
         ORDER BY ts DESC LIMIT ${PERCENTILE_SAMPLE}`,
        span,
      ),
      this.rows(
        `SELECT route AS k, SUM(count) AS c FROM analytics_event
         WHERE name = 'api.request' AND source IN ('mcp', 'api') AND ts >= ? AND ts < ?
         GROUP BY route ORDER BY c DESC LIMIT 20`,
        span,
      ),
      this.rows(
        `SELECT source AS k, SUM(count) AS c FROM analytics_event
         WHERE name = 'api.request' AND source IN ('mcp', 'api') AND ts >= ? AND ts < ? GROUP BY source`,
        span,
      ),
    ]);
    const usageOf = new Map(usage.map((r) => [String(r['tokenId']), r]));
    const toolsOf = new Map<string, AdminCount[]>();
    for (const r of perTokenTools) {
      const list = toolsOf.get(String(r['tokenId'])) ?? [];
      if (list.length < 3) list.push({ key: String(r['mcpTool']), count: num(r['c']) });
      toolsOf.set(String(r['tokenId']), list);
    }
    const durationsOf = new Map<string, number[]>();
    for (const r of durations) {
      const list = durationsOf.get(String(r['k'])) ?? [];
      list.push(num(r['d']));
      durationsOf.set(String(r['k']), list);
    }
    return {
      ...this.windowOf(range, w),
      tokens: tokens.map((t) => {
        const id = String(t['id']);
        return {
          id,
          name: String(t['name']),
          prefix: String(t['prefix']),
          scope: String(t['scope']),
          ownerEmail: (t['ownerEmail'] as string | null) ?? null,
          createdAt: isoOrNull(t['createdAt']) ?? '',
          lastUsedAt: isoOrNull(t['lastUsedAt']),
          revokedAt: isoOrNull(t['revokedAt']),
          calls: num(usageOf.get(id)?.['calls']),
          errors: num(usageOf.get(id)?.['errors']),
          topTools: toolsOf.get(id) ?? [],
        };
      }),
      tools: tools.map((r) => ({
        key: String(r['k']),
        count: num(r['c']),
        errors: num(r['e']),
        p95Ms: percentile((durationsOf.get(String(r['k'])) ?? []).sort((x, y) => x - y), 0.95),
      })),
      routes: routes.map((r) => ({ key: String(r['k']), count: num(r['c']) })),
      sources: sources.map((r) => ({ key: String(r['k']), count: num(r['c']) })),
    };
  }

  // ------------------------------------------------------------ errors

  async errors(range: AdminRange): Promise<AdminErrorsResponse> {
    const w = rangeWindow(range);
    const span = [w.startMs, w.endMs];
    const [totals, groups, slowRoutes, slowDurations, clientEvents, series] = await Promise.all([
      this.rows(
        `SELECT ${EST_REQUESTS} AS requests,
           SUM(CASE WHEN status >= 500 THEN count ELSE 0 END) AS server,
           SUM(CASE WHEN status >= 400 AND status < 500 THEN count ELSE 0 END) AS client
         FROM analytics_event WHERE name = 'api.request' AND ts >= ? AND ts < ?`,
        span,
      ),
      this.rows(
        `SELECT route, status, SUM(count) AS c, MIN(ts) AS f, MAX(ts) AS l, MAX(requestId) AS sample
         FROM analytics_event WHERE name = 'api.request' AND status >= 400 AND ts >= ? AND ts < ?
         GROUP BY route, status ORDER BY status >= 500 DESC, c DESC LIMIT 100`,
        span,
      ),
      this.rows(
        `SELECT route, SUM(count) AS c, MAX(durationMs) AS maxMs FROM analytics_event
         WHERE name = 'api.request' AND json_extract(props, '$.slow') = 1 AND ts >= ? AND ts < ?
         GROUP BY route ORDER BY c DESC LIMIT 25`,
        span,
      ),
      this.rows(
        `SELECT route, durationMs AS d FROM analytics_event
         WHERE name = 'api.request' AND json_extract(props, '$.slow') = 1 AND ts >= ? AND ts < ?
         ORDER BY ts DESC LIMIT ${PERCENTILE_SAMPLE}`,
        span,
      ),
      this.rows(
        `SELECT COALESCE(json_extract(props, '$.kind'), 'unknown') AS k, SUM(count) AS c FROM analytics_event
         WHERE name = 'client.error' AND ts >= ? AND ts < ? GROUP BY k ORDER BY c DESC`,
        span,
      ),
      this.dailyEvents(w, `name = 'api.request' AND status >= 500`),
    ]);
    const durationsOf = new Map<string, number[]>();
    for (const r of slowDurations) {
      const list = durationsOf.get(String(r['route'])) ?? [];
      list.push(num(r['d']));
      durationsOf.set(String(r['route']), list);
    }
    const total = totals[0] ?? {};
    return {
      ...this.windowOf(range, w),
      requests: Math.round(num(total['requests'])),
      serverErrors: num(total['server']),
      clientErrors: num(total['client']),
      groups: groups.map((r) => ({
        route: String(r['route'] ?? '(unknown)'),
        status: num(r['status']),
        count: num(r['c']),
        firstSeen: new Date(num(r['f'])).toISOString(),
        lastSeen: new Date(num(r['l'])).toISOString(),
        sampleRequestId: (r['sample'] as string | null) ?? null,
      })),
      slow: slowRoutes.map((r) => ({
        route: String(r['route'] ?? '(unknown)'),
        count: num(r['c']),
        p95Ms: percentile((durationsOf.get(String(r['route'])) ?? []).sort((x, y) => x - y), 0.95) ?? 0,
        maxMs: num(r['maxMs']),
      })),
      clientEvents: clientEvents.map((r) => ({ key: String(r['k']), count: num(r['c']) })),
      series,
    };
  }

  // ------------------------------------------------------------ realtime

  async realtime(now = Date.now()): Promise<AdminRealtimeResponse> {
    const live: RealtimeRoomSnapshot[] = this.gateway?.snapshot() ?? [];
    const names = new Map<string, string>();
    if (live.length > 0) {
      const ids = live.map((room) => room.projectId);
      const rows = (await this.app.query(
        `SELECT id, name FROM projects WHERE id IN (${ids.map(() => '?').join(', ')})`,
        ids,
      )) as Row[];
      for (const row of rows) names.set(String(row['id']), String(row['name']));
    }
    const w = windowOf(utcDayOf(now - 29 * DAY_MS), utcDayOf(now));
    const span = [w.startMs, w.endMs];
    const [joins, sessions, presents] = await Promise.all([
      this.dailyEvents(w, `name = 'realtime.joined'`),
      this.rows(
        `SELECT json_extract(props, '$.sessionMs') AS ms FROM analytics_event
         WHERE name = 'realtime.left' AND ts >= ? AND ts < ? AND json_extract(props, '$.sessionMs') IS NOT NULL
         ORDER BY ts DESC LIMIT ${PERCENTILE_SAMPLE}`,
        span,
      ),
      this.scalar(
        `SELECT SUM(count) AS n FROM analytics_event WHERE ts >= ? AND ts < ? AND
         (name = 'present.started' OR (name = 'client.present' AND json_extract(props, '$.action') = 'start'))`,
        span,
      ),
    ]);
    const lengths = sessions.map((r) => num(r['ms'])).sort((x, y) => x - y);
    const rooms = live
      .map((room) => ({ ...room, projectName: names.get(room.projectId) ?? null }))
      .sort((x, y) => y.participants - x.participants);
    return {
      generatedAt: new Date(now).toISOString(),
      analyticsEnabled: this.analyticsEnabled,
      rooms,
      totals: {
        rooms: rooms.length,
        participants: rooms.reduce((acc, r) => acc + r.participants, 0),
        presenters: rooms.reduce((acc, r) => acc + r.presenters, 0),
      },
      joins,
      sessionP50Ms: percentile(lengths, 0.5),
      sessionP95Ms: percentile(lengths, 0.95),
      presents30d: presents ?? 0,
    };
  }

  // ------------------------------------------------------------ events

  async events(query: { name?: string; from?: string; to?: string; cursor?: number; limit?: number }): Promise<AdminEventsResponse> {
    const w = explicitWindow(query.from, query.to, 7);
    const limit = query.limit ?? 50;
    const where = ['ts >= ?', 'ts < ?'];
    const params: unknown[] = [w.startMs, w.endMs];
    if (query.name) {
      where.push('name = ?');
      params.push(query.name);
    }
    if (query.cursor) {
      where.push('id < ?');
      params.push(query.cursor);
    }
    const rows = await this.rows(
      `SELECT id, ts, name, source, actorType, actorId, tokenId, projectId, route, status, durationMs, count, props,
         mcpTool, requestId
       FROM analytics_event WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`,
      [...params, limit + 1],
    );
    const page = rows.slice(0, limit);
    const items: AdminEventRow[] = page.map((r) => ({
      id: num(r['id']),
      ts: num(r['ts']),
      name: String(r['name']),
      source: String(r['source']),
      actorType: String(r['actorType']),
      actorId: (r['actorId'] as string | null) ?? null,
      tokenId: (r['tokenId'] as string | null) ?? null,
      projectId: (r['projectId'] as string | null) ?? null,
      route: (r['route'] as string | null) ?? null,
      status: r['status'] === null ? null : num(r['status']),
      durationMs: r['durationMs'] === null ? null : num(r['durationMs']),
      count: num(r['count']),
      props: parseProps(r['props']),
      mcpTool: (r['mcpTool'] as string | null) ?? null,
      requestId: (r['requestId'] as string | null) ?? null,
    }));
    return {
      analyticsEnabled: this.analyticsEnabled,
      items,
      nextCursor: rows.length > limit && items.length > 0 ? items[items.length - 1].id : null,
    };
  }

  // ------------------------------------------------------------ per-user (users page)

  /** Events per day for one signed-in user. */
  async userActivity(userId: string, w: DayWindow): Promise<AdminSeriesPoint[]> {
    return this.dailyEvents(w, `actorId = ? AND actorType IN ${USER_ACTORS}`, undefined, [userId]);
  }

  async userTopFeatures(userId: string, sinceMs: number): Promise<AdminCount[]> {
    const rows = await this.rows(
      `SELECT CASE WHEN name = 'entity.write' THEN json_extract(props, '$.kind') ELSE name END AS k, SUM(count) AS c
       FROM analytics_event WHERE actorId = ? AND actorType IN ${USER_ACTORS} AND ts >= ?
         AND name NOT IN ('api.request', 'api.not_modified')
       GROUP BY k ORDER BY c DESC LIMIT 10`,
      [userId, sinceMs],
    );
    return rows.filter((r) => r['k'] !== null).map((r) => ({ key: String(r['k']), count: num(r['c']) }));
  }

  /** entity.write count per project since `sinceMs`. */
  async writesByProject(sinceMs: number): Promise<Map<string, number>> {
    const rows = await this.rows(
      `SELECT projectId, SUM(count) AS c FROM analytics_event
       WHERE name = 'entity.write' AND projectId IS NOT NULL AND ts >= ? GROUP BY projectId`,
      [sinceMs],
    );
    return new Map(rows.map((r) => [String(r['projectId']), num(r['c'])]));
  }

  // ------------------------------------------------------------ helpers

  private windowOf(range: AdminRange, w: DayWindow): AdminWindow {
    return { range, from: w.from, to: w.to, analyticsEnabled: this.analyticsEnabled };
  }

  private activeProjectsSql(): string {
    return `SELECT COUNT(DISTINCT projectId) AS n FROM analytics_event
      WHERE name IN ('project.opened', 'entity.write') AND projectId IS NOT NULL AND ts >= ? AND ts < ?`;
  }

  private mcpCallsSql(): string {
    return `SELECT SUM(count) AS n FROM analytics_event WHERE name = 'api.request' AND source = 'mcp' AND ts >= ? AND ts < ?`;
  }

  private async rows(sql: string, params: unknown[] = []): Promise<Row[]> {
    if (!this.analyticsEnabled) return [];
    return (await this.analytics!.query(sql, params)) as Row[];
  }

  private async scalar(sql: string, params: unknown[]): Promise<number | null> {
    if (!this.analyticsEnabled) return null;
    const [row] = await this.rows(sql, params);
    return num(row?.['n']);
  }

  private async distinctActors(from: string, to: string, types: string): Promise<number | null> {
    return this.scalar(
      `SELECT COUNT(DISTINCT actorId) AS n FROM analytics_actor_day WHERE day >= ? AND day <= ? AND actorType IN ${types}`,
      [from, to],
    );
  }

  private async dailyActors(w: DayWindow, types: string): Promise<AdminSeriesPoint[]> {
    const rows = await this.rows(
      `SELECT day, COUNT(DISTINCT actorId) AS n FROM analytics_actor_day
       WHERE day >= ? AND day <= ? AND actorType IN ${types} GROUP BY day`,
      [w.from, w.to],
    );
    return denseSeries(w.days, new Map(rows.map((r) => [String(r['day']), num(r['n'])])));
  }

  private async dailyEvents(w: DayWindow, where: string, value = 'SUM(count)', params: unknown[] = []): Promise<AdminSeriesPoint[]> {
    const rows = await this.rows(
      `SELECT ${TS_DAY} AS day, ${value} AS n FROM analytics_event
       WHERE ${where} AND ts >= ? AND ts < ? GROUP BY day`,
      [...params, w.startMs, w.endMs],
    );
    return denseSeries(w.days, new Map(rows.map((r) => [String(r['day']), num(r['n'])])));
  }

  /** Rows created per day in an app table (`createdAt`), always available. */
  private async dailyAppCount(table: 'users' | 'projects', alias: string, where: string, w: DayWindow): Promise<AdminSeriesPoint[]> {
    const rows = (await this.app.query(
      `SELECT substr(${alias}.createdAt, 1, 10) AS day, COUNT(*) AS n FROM ${table} ${alias}
       WHERE ${where} AND ${alias}.createdAt >= ? AND ${alias}.createdAt < ? GROUP BY day`,
      [sqlDatetime(w.startMs), sqlDatetime(w.endMs)],
    )) as Row[];
    return denseSeries(w.days, new Map(rows.map((r) => [String(r['day']), num(r['n'])])));
  }

  /** Nearest-rank percentile computed in SQL (COUNT, then one row at the rank offset). */
  private async percentileOf(where: string, span: unknown[], column: string, p: number): Promise<number | null> {
    const n = await this.scalar(`SELECT COUNT(*) AS n FROM analytics_event WHERE ${where} AND ts >= ? AND ts < ?`, span);
    if (!n) return null;
    const [row] = await this.rows(
      `SELECT ${column} AS v FROM analytics_event WHERE ${where} AND ts >= ? AND ts < ? ORDER BY ${column} LIMIT 1 OFFSET ?`,
      [...span, Math.max(0, Math.ceil(p * n) - 1)],
    );
    return row ? num(row['v']) : null;
  }

  private async appDbBytes(): Promise<number> {
    const [pages] = (await this.app.query('PRAGMA page_count')) as Row[];
    const [size] = (await this.app.query('PRAGMA page_size')) as Row[];
    return num(pages?.['page_count']) * num(size?.['page_size']);
  }
}

function parseProps(value: unknown): Record<string, number | boolean | string> | null {
  if (typeof value !== 'string' || value === '') return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number | boolean | string>) : null;
  } catch {
    return null;
  }
}
