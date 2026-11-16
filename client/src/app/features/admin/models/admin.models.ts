import type {
   AdminApiTokensResponse,
   AdminErrorsResponse,
   AdminEventsResponse,
   AdminFeaturesResponse,
   AdminKpiKey,
   AdminMetric,
   AdminOverviewResponse,
   AdminPage,
   AdminProjectRow,
   AdminProjectSort,
   AdminRange,
   AdminRealtimeResponse,
   AdminRetentionResponse,
   AdminSeriesPoint,
   AdminSortDir,
   AdminStorageResponse,
   AdminTimeseriesResponse,
   AdminUserDetail,
   AdminUserRow,
   AdminUserSort,
} from '@devdesigner/shared';

export type * from '@devdesigner/shared';

/** How a number is shown (tiles, charts, tables). */
export type AdminValueFormat = 'count' | 'percent' | 'ms' | 'bytes' | 'date' | 'datetime' | 'text';

/** One line of a line chart. `slot` picks the categorical color (--dd-chart-N), in fixed order. */
export interface ChartSeries {
   id: string;
   label: string;
   slot: 1 | 2 | 3;
   points: AdminSeriesPoint[];
}

/** One bar of a bar list. */
export interface BarItem {
   key: string;
   label: string;
   value: number;
   /** Optional secondary text after the value (e.g. "42% of users"). */
   note?: string;
}

/** One part of a stacked proportion bar. */
export interface StatSegment {
   key: string;
   label: string;
   value: number;
}

export interface TableColumn {
   key: string;
   label: string;
   format?: AdminValueFormat;
   sortable?: boolean;
   align?: 'start' | 'end';
}

export type TableRow = Record<string, string | number | boolean | null>;

/** Per-endpoint request params held in the store. */
export interface AdminListQuery<S extends string> {
   q: string;
   sort: S;
   dir: AdminSortDir;
   page: number;
}

export interface AdminEventsQuery {
   name: string;
   /** Cursors of the pages before the current one (newest first), for "Newer". */
   cursors: number[];
}

/** Everything the store loads, keyed by resource. */
export interface AdminResponses {
   overview: AdminOverviewResponse;
   features: AdminFeaturesResponse;
   timeseries: AdminTimeseriesResponse;
   retention: AdminRetentionResponse;
   users: AdminPage<AdminUserRow>;
   userDetail: AdminUserDetail;
   projects: AdminPage<AdminProjectRow>;
   storage: AdminStorageResponse;
   apiTokens: AdminApiTokensResponse;
   errors: AdminErrorsResponse;
   realtime: AdminRealtimeResponse;
   events: AdminEventsResponse;
}

export type AdminResource = keyof AdminResponses;

/** One cached response. */
export interface AdminEntry {
   value: unknown;
   loading: boolean;
   error: string | null;
   loadedAt: number | null;
}

/** What a page reads for one resource. `stale` = showing the previous params' data while reloading. */
export interface AdminView<T> {
   value: T | null;
   loading: boolean;
   error: string | null;
   stale: boolean;
}

/** A resolved request: a cache key plus the params the API service needs. */
export interface AdminRequest<R extends AdminResource = AdminResource> {
   resource: R;
   key: string;
   params: AdminRequestParams;
}

export interface AdminRequestParams {
   range: AdminRange;
   metric: AdminMetric;
   users: AdminListQuery<AdminUserSort>;
   projects: AdminListQuery<AdminProjectSort>;
   userId: string | null;
   events: AdminEventsQuery;
   retentionWeeks: number;
}

export const ADMIN_PAGE_SIZE = 25;
export const ADMIN_EVENTS_PAGE = 50;
/** Cached responses younger than this are not refetched when a page reopens. */
export const ADMIN_CACHE_MS = 60_000;

export const KPI_LABELS: Readonly<Record<AdminKpiKey, string>> = {
   activeUsers: 'Active users',
   activeGuests: 'Active guests',
   dau: 'Avg daily active users',
   wau: 'Weekly active users',
   mau: 'Monthly active users',
   signups: 'New signups',
   guestConversions: 'Guest conversions',
   projectsCreated: 'Projects created',
   activeProjects: 'Active projects',
   mcpCalls: 'MCP calls',
   errorRate: 'Server error rate',
   p95Ms: 'p95 latency',
   dbBytes: 'Database size',
};

/** KPIs where a rise is bad (deltas are colored by direction × goodness). */
export const KPI_UP_IS_BAD: ReadonlySet<AdminKpiKey> = new Set(['errorRate', 'p95Ms']);

export const METRIC_LABELS: Readonly<Record<AdminMetric, string>> = {
   active_users: 'Active users',
   active_guests: 'Active guests',
   signups: 'Signups',
   projects_created: 'Projects created',
   entity_writes: 'Entity writes',
   requests: 'Requests',
   mcp_calls: 'MCP calls',
   errors: 'Server errors',
   share_opens: 'Share link opens',
   realtime_joins: 'Realtime joins',
   presents: 'Presentations',
   exports: 'Exports',
};
