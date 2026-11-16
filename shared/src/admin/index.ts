// Admin API response shapes (`/api/admin/*`), shared by the server and the admin feature.
// Every list is paged or capped; no response carries project content (only names, counts, sizes).

/** GET /api/admin/ping: proves the caller passed the admin wall. */
export interface AdminPingResponse {
  ok: true;
  serverTime: string;
}

/** Preset ranges accepted by `?range=` (days back from today, inclusive). */
export const ADMIN_RANGES = ['7d', '30d', '90d'] as const;
export type AdminRange = (typeof ADMIN_RANGES)[number];
export const ADMIN_RANGE_DAYS: Readonly<Record<AdminRange, number>> = { '7d': 7, '30d': 30, '90d': 90 };

/** Longest explicit `from..to` window (days) the server accepts. */
export const ADMIN_MAX_RANGE_DAYS = 366;
/** Largest page size for paged lists. */
export const ADMIN_MAX_PAGE_SIZE = 100;
/** Largest page of the raw event explorer. */
export const ADMIN_MAX_EVENTS_PAGE = 200;

/** A UTC day (`YYYY-MM-DD`) and a value. Series are dense: days without data are 0. */
export interface AdminSeriesPoint {
  day: string;
  value: number;
}

/** A labelled count (top-N lists, distributions). */
export interface AdminCount {
  key: string;
  count: number;
}

export interface AdminPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** The resolved window of a range-scoped response (inclusive UTC days). */
export interface AdminWindow {
  range: AdminRange;
  from: string;
  to: string;
  /** False when ANALYTICS_ENABLED is off: analytics-backed numbers are empty. */
  analyticsEnabled: boolean;
}

// ---------------------------------------------------------------- overview

export type AdminKpiKey =
  | 'activeUsers'
  | 'activeGuests'
  | 'dau'
  | 'wau'
  | 'mau'
  | 'signups'
  | 'guestConversions'
  | 'projectsCreated'
  | 'activeProjects'
  | 'mcpCalls'
  | 'errorRate'
  | 'p95Ms'
  | 'dbBytes';

export type AdminKpiUnit = 'count' | 'percent' | 'ms' | 'bytes';

export interface AdminKpi {
  key: AdminKpiKey;
  value: number | null;
  /** Same measure over the previous window of equal length (null when not comparable). */
  previous: number | null;
  unit: AdminKpiUnit;
}

export interface AdminOverviewResponse extends AdminWindow {
  kpis: AdminKpi[];
  series: {
    activeUsers: AdminSeriesPoint[];
    activeGuests: AdminSeriesPoint[];
    signups: AdminSeriesPoint[];
    projectsCreated: AdminSeriesPoint[];
    requests: AdminSeriesPoint[];
    errors: AdminSeriesPoint[];
  };
}

// ---------------------------------------------------------------- timeseries

export const ADMIN_METRICS = [
  'active_users',
  'active_guests',
  'signups',
  'projects_created',
  'entity_writes',
  'requests',
  'mcp_calls',
  'errors',
  'share_opens',
  'realtime_joins',
  'presents',
  'exports',
] as const;
export type AdminMetric = (typeof ADMIN_METRICS)[number];

export interface AdminTimeseriesResponse {
  metric: AdminMetric;
  /** Mutation kind for `entity_writes`, MCP tool for `mcp_calls`; '' = all. */
  dim: string;
  from: string;
  to: string;
  points: AdminSeriesPoint[];
}

// ---------------------------------------------------------------- features

export interface AdminFeatureUsage {
  key: string;
  /** Events (sum of counts). */
  count: number;
  /** Distinct signed-in users who used it in the window. */
  users: number;
}

export interface AdminFeaturesResponse extends AdminWindow {
  /** Distinct signed-in users active in the window (the denominator for `users`). */
  activeUsers: number;
  /** entity.write grouped by mutation kind (`element.created`, `table.moved`, ...). */
  writesByKind: AdminFeatureUsage[];
  /** element writes grouped by element type (shape, text, code, grid, frame, ...). */
  elementTypes: AdminFeatureUsage[];
  /** Feature events: presents, exports, imports, shares, laser, guide tabs... */
  events: AdminFeatureUsage[];
  /** Exports by format (`file`, `sql:mysql`, `png`, ...). */
  exportFormats: AdminCount[];
}

// ---------------------------------------------------------------- retention

export interface AdminCohort {
  /** Monday (UTC) of the signup week. */
  week: string;
  size: number;
  /** Users of the cohort active in week N after signup (index 0 = signup week). */
  active: number[];
}

export interface AdminRetentionResponse {
  weeks: number;
  analyticsEnabled: boolean;
  cohorts: AdminCohort[];
}

// ---------------------------------------------------------------- users

export const ADMIN_USER_SORTS = ['createdAt', 'lastSeenAt', 'projects', 'bytes', 'email'] as const;
export type AdminUserSort = (typeof ADMIN_USER_SORTS)[number];
export type AdminSortDir = 'asc' | 'desc';

export interface AdminUserRow {
  id: string;
  email: string | null;
  displayName: string | null;
  method: string;
  role: 'user' | 'admin';
  createdAt: string;
  lastSeenAt: string | null;
  lastLoginAt: string | null;
  projects: number;
  imageBytes: number;
  activeTokens: number;
}

export interface AdminUserProject {
  id: string;
  name: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  tables: number;
  elements: number;
  imageBytes: number;
  activeShareLinks: number;
}

export interface AdminUserToken {
  id: string;
  name: string;
  prefix: string;
  scope: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface AdminUserDetail extends AdminUserRow {
  projectList: AdminUserProject[];
  tokens: AdminUserToken[];
  /** Events per day over the last 90 days. */
  activity: AdminSeriesPoint[];
  /** Most used features (mutation kinds and feature events) over 90 days. */
  topFeatures: AdminCount[];
}

// ---------------------------------------------------------------- projects

export const ADMIN_PROJECT_SORTS = ['size', 'lastOpened', 'writes', 'createdAt'] as const;
export type AdminProjectSort = (typeof ADMIN_PROJECT_SORTS)[number];
export type AdminOwnerKind = 'user' | 'guest' | 'anon';

export interface AdminProjectRow {
  id: string;
  name: string;
  ownerKind: AdminOwnerKind;
  ownerEmail: string | null;
  archived: boolean;
  createdAt: string;
  lastOpenedAt: string | null;
  updatedAt: string;
  tables: number;
  elements: number;
  textBytes: number;
  imageBytes: number;
  activeShareLinks: number;
  /** entity.write events over the last 30 days. */
  writes30d: number;
}

// ---------------------------------------------------------------- storage

export interface AdminTableBytes {
  name: string;
  bytes: number;
}

export interface AdminFileSize {
  path: string;
  bytes: number;
  walBytes: number;
}

export interface AdminImageStats {
  mimeType: string;
  count: number;
  bytes: number;
  unique: number;
}

export interface AdminLargestProject {
  id: string;
  name: string;
  ownerKind: AdminOwnerKind;
  tables: number;
  elements: number;
  textBytes: number;
  imageBytes: number;
}

export interface AdminTokenScopeStats {
  scope: string;
  total: number;
  active: number;
  used7d: number;
}

export interface AdminStorageResponse {
  generatedAt: string;
  /** Row counts per app table. */
  rows: AdminCount[];
  /** dbstat bytes per table/index, or null when the SQLite build has no DBSTAT. */
  tableBytes: AdminTableBytes[] | null;
  database: { pageCount: number; pageSize: number; freelistCount: number; file: AdminFileSize | null };
  analyticsDatabase: AdminFileSize | null;
  images: AdminImageStats[];
  orphanImages: { count: number; bytes: number };
  elementsByType: Array<AdminCount & { textBytes: number }>;
  slides: number;
  largestProjects: AdminLargestProject[];
  /** active_7d / active_30d / idle / dormant, by COALESCE(lastOpenedAt, updatedAt). */
  projectActivity: AdminCount[];
  /** True when some projects have no lastOpenedAt yet (bucketed by updatedAt instead). */
  projectActivityApprox: boolean;
  authMethods: AdminCount[];
  guests: { owners: number; projects: number };
  ownerlessProjects: number;
  activeShareLinks: AdminCount[];
  apiTokens: AdminTokenScopeStats[];
  projectsPerUser: AdminCount[];
}

// ---------------------------------------------------------------- api tokens

export interface AdminTokenUsage {
  id: string;
  name: string;
  prefix: string;
  scope: string;
  ownerEmail: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  calls: number;
  errors: number;
  topTools: AdminCount[];
}

export interface AdminToolUsage {
  key: string;
  count: number;
  errors: number;
  p95Ms: number | null;
}

export interface AdminApiTokensResponse extends AdminWindow {
  tokens: AdminTokenUsage[];
  tools: AdminToolUsage[];
  routes: AdminCount[];
  /** Calls by source: mcp vs api (bearer without MCP). */
  sources: AdminCount[];
}

// ---------------------------------------------------------------- errors

export interface AdminErrorGroup {
  route: string;
  status: number;
  count: number;
  firstSeen: string;
  lastSeen: string;
  sampleRequestId: string | null;
}

export interface AdminSlowRoute {
  route: string;
  count: number;
  p95Ms: number;
  maxMs: number;
}

export interface AdminErrorsResponse extends AdminWindow {
  /** Estimated requests (sampled GETs scaled back up) and 5xx count. */
  requests: number;
  serverErrors: number;
  clientErrors: number;
  groups: AdminErrorGroup[];
  slow: AdminSlowRoute[];
  /** Client beacon errors by kind. */
  clientEvents: AdminCount[];
  series: AdminSeriesPoint[];
}

// ---------------------------------------------------------------- realtime

/** One live room (no participant names or emails). */
export interface AdminRealtimeRoom {
  projectId: string;
  projectName: string | null;
  participants: number;
  editors: number;
  viewers: number;
  presenters: number;
}

/** What the gateway reports about its rooms, from memory. */
export interface RealtimeRoomSnapshot {
  projectId: string;
  participants: number;
  editors: number;
  viewers: number;
  presenters: number;
}

export interface AdminRealtimeResponse {
  generatedAt: string;
  analyticsEnabled: boolean;
  rooms: AdminRealtimeRoom[];
  totals: { rooms: number; participants: number; presenters: number };
  /** Socket joins per day over 30 days. */
  joins: AdminSeriesPoint[];
  /** Median and p95 session length (ms) over 30 days, from realtime.left. */
  sessionP50Ms: number | null;
  sessionP95Ms: number | null;
  presents30d: number;
}

// ---------------------------------------------------------------- events

export interface AdminEventRow {
  id: number;
  ts: number;
  name: string;
  source: string;
  actorType: string;
  actorId: string | null;
  tokenId: string | null;
  projectId: string | null;
  route: string | null;
  status: number | null;
  durationMs: number | null;
  count: number;
  props: Record<string, number | boolean | string> | null;
  mcpTool: string | null;
  requestId: string | null;
}

export interface AdminEventsResponse {
  analyticsEnabled: boolean;
  items: AdminEventRow[];
  /** Pass as `cursor` for the next (older) page; null at the end. */
  nextCursor: number | null;
}
