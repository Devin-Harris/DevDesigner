import { of, type Observable } from 'rxjs';
import type { AdminSeriesPoint } from '@devdesigner/shared';
import type { AdminRequest, AdminResource, AdminResponses } from '../models/admin.models';

/** Test data for every admin endpoint (specs only). */
export const series = (values: number[], start = '2026-11-01'): AdminSeriesPoint[] =>
   values.map((value, i) => ({
      day: new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10),
      value,
   }));

const windowOf = { range: '7d' as const, from: '2026-11-01', to: '2026-11-07', analyticsEnabled: true };

export const ADMIN_FIXTURES: AdminResponses = {
   overview: {
      ...windowOf,
      kpis: [
         { key: 'activeUsers', value: 12, previous: 10, unit: 'count' },
         { key: 'errorRate', value: 1.5, previous: 1, unit: 'percent' },
         { key: 'p95Ms', value: 120, previous: null, unit: 'ms' },
         { key: 'dbBytes', value: 2_400_000, previous: null, unit: 'bytes' },
      ],
      series: {
         activeUsers: series([1, 2, 3, 4, 5, 6, 7]),
         activeGuests: series([0, 1, 0, 1, 0, 1, 0]),
         signups: series([0, 0, 1, 0, 0, 2, 0]),
         projectsCreated: series([1, 0, 1, 0, 1, 0, 1]),
         requests: series([100, 120, 90, 80, 110, 130, 140]),
         errors: series([0, 0, 1, 0, 0, 0, 2]),
      },
   },
   features: {
      ...windowOf,
      activeUsers: 10,
      writesByKind: [{ key: 'element.created', count: 40, users: 5 }],
      elementTypes: [{ key: 'code', count: 12, users: 3 }],
      events: [{ key: 'export.sql', count: 4, users: 2 }],
      exportFormats: [{ key: 'png', count: 3 }],
   },
   timeseries: {
      metric: 'entity_writes',
      dim: '',
      from: '2026-11-01',
      to: '2026-11-07',
      points: series([5, 6, 7, 8, 9, 10, 11]),
   },
   retention: { weeks: 2, analyticsEnabled: true, cohorts: [{ week: '2026-10-26', size: 4, active: [4, 2] }] },
   users: {
      items: [
         {
            id: 'u1',
            email: 'ada@example.com',
            displayName: 'Ada',
            method: 'password',
            role: 'admin',
            createdAt: '2026-10-01T00:00:00.000Z',
            lastSeenAt: '2026-11-06T10:00:00.000Z',
            lastLoginAt: null,
            projects: 3,
            imageBytes: 4096,
            activeTokens: 1,
         },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
   },
   userDetail: {
      id: 'u1',
      email: 'ada@example.com',
      displayName: 'Ada',
      method: 'password',
      role: 'admin',
      createdAt: '2026-10-01T00:00:00.000Z',
      lastSeenAt: null,
      lastLoginAt: null,
      projects: 1,
      imageBytes: 0,
      activeTokens: 0,
      projectList: [
         {
            id: 'p1',
            name: 'Schema',
            archived: false,
            createdAt: '2026-10-02T00:00:00.000Z',
            updatedAt: '2026-10-02T00:00:00.000Z',
            lastOpenedAt: null,
            tables: 4,
            elements: 2,
            imageBytes: 0,
            activeShareLinks: 1,
         },
      ],
      tokens: [],
      activity: series([0, 1, 2]),
      topFeatures: [{ key: 'table.created', count: 4 }],
   },
   projects: {
      items: [
         {
            id: 'p1',
            name: 'Schema',
            ownerKind: 'guest',
            ownerEmail: null,
            archived: false,
            createdAt: '2026-10-02T00:00:00.000Z',
            lastOpenedAt: null,
            updatedAt: '2026-10-02T00:00:00.000Z',
            tables: 4,
            elements: 2,
            textBytes: 100,
            imageBytes: 2000,
            activeShareLinks: 0,
            writes30d: 9,
         },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
   },
   storage: {
      generatedAt: '2026-11-07T10:00:00.000Z',
      rows: [{ key: 'users', count: 2 }],
      tableBytes: null,
      database: {
         pageCount: 10,
         pageSize: 4096,
         freelistCount: 1,
         file: { path: 'app.sqlite', bytes: 40960, walBytes: 0 },
      },
      analyticsDatabase: null,
      images: [{ mimeType: 'image/png', count: 1, bytes: 2000, unique: 1 }],
      orphanImages: { count: 0, bytes: 0 },
      elementsByType: [{ key: 'text', count: 3, textBytes: 20 }],
      slides: 1,
      largestProjects: [
         { id: 'p1', name: 'Schema', ownerKind: 'user', tables: 4, elements: 2, textBytes: 100, imageBytes: 2000 },
      ],
      projectActivity: [
         { key: 'active_7d', count: 1 },
         { key: 'dormant', count: 1 },
      ],
      projectActivityApprox: true,
      authMethods: [{ key: 'password', count: 2 }],
      guests: { owners: 1, projects: 1 },
      ownerlessProjects: 0,
      activeShareLinks: [{ key: 'VIEW', count: 1 }],
      apiTokens: [{ scope: 'write', total: 1, active: 1, used7d: 1 }],
      projectsPerUser: [{ key: '1', count: 2 }],
   },
   apiTokens: {
      ...windowOf,
      tokens: [
         {
            id: 't1',
            name: 'CI',
            prefix: 'ddt_ab',
            scope: 'write',
            ownerEmail: 'ada@example.com',
            createdAt: '2026-10-01T00:00:00.000Z',
            lastUsedAt: null,
            revokedAt: null,
            calls: 30,
            errors: 1,
            topTools: [{ key: 'add_table', count: 20 }],
         },
      ],
      tools: [{ key: 'add_table', count: 20, errors: 0, p95Ms: 40 }],
      routes: [{ key: 'POST /api/projects/:projectId/tables', count: 20 }],
      sources: [{ key: 'mcp', count: 30 }],
   },
   errors: {
      ...windowOf,
      requests: 1000,
      serverErrors: 3,
      clientErrors: 12,
      groups: [
         {
            route: 'POST /api/projects/import',
            status: 500,
            count: 3,
            firstSeen: '2026-11-02T00:00:00.000Z',
            lastSeen: '2026-11-06T00:00:00.000Z',
            sampleRequestId: 'r1',
         },
      ],
      slow: [{ route: 'GET /api/projects/:projectId', count: 2, p95Ms: 1500, maxMs: 1800 }],
      clientEvents: [],
      series: series([0, 0, 1, 0, 0, 0, 2]),
   },
   realtime: {
      generatedAt: '2026-11-07T10:00:00.000Z',
      analyticsEnabled: true,
      rooms: [{ projectId: 'p1', projectName: 'Schema', participants: 2, editors: 1, viewers: 1, presenters: 0 }],
      totals: { rooms: 1, participants: 2, presenters: 0 },
      joins: series([1, 2, 3]),
      sessionP50Ms: 60_000,
      sessionP95Ms: 600_000,
      presents30d: 1,
   },
   events: {
      analyticsEnabled: true,
      items: [
         {
            id: 7,
            ts: Date.parse('2026-11-07T09:00:00Z'),
            name: 'api.request',
            source: 'web',
            actorType: 'user',
            actorId: 'u1',
            tokenId: null,
            projectId: null,
            route: 'GET /api/projects',
            status: 200,
            durationMs: 4,
            count: 1,
            props: { method: 'GET', sample: 1 },
            mcpTool: null,
            requestId: 'r7',
         },
      ],
      nextCursor: 7,
   },
};

/** An AdminApiService stand-in whose `fetch` answers from the fixtures (or `override`). */
export function fakeAdminApi(override?: (request: AdminRequest) => Observable<unknown> | undefined) {
   return {
      fetch: jest.fn(
         (request: AdminRequest<AdminResource>) => override?.(request) ?? of(ADMIN_FIXTURES[request.resource])
      ),
   };
}
