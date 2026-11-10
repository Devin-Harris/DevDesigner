/**
 * Analytics event catalog (audit 04, Phase 1). The single allow-list for every
 * event the server records, whether captured server-side or sent by the client
 * beacon (`POST /api/telemetry`).
 *
 * Privacy rule: props are ONLY numbers, booleans or values from a fixed enum.
 * There is deliberately no free-text prop type, so diagram content (table or
 * column names, text, code, URLs, emails, tokens) cannot be recorded through a
 * prop. Route templates and MCP tool names are server-derived columns, not props.
 */

export type AnalyticsPropSpec =
  | { type: 'number'; min?: number; max?: number }
  | { type: 'boolean' }
  | { type: 'enum'; values: readonly string[] };

export interface AnalyticsEventSpec {
  props: Readonly<Record<string, AnalyticsPropSpec>>;
  /** True when the client beacon may send this event. */
  client?: boolean;
}

const num = (max = Number.MAX_SAFE_INTEGER): AnalyticsPropSpec => ({ type: 'number', min: 0, max });
const bool: AnalyticsPropSpec = { type: 'boolean' };
const oneOf = (values: readonly string[]): AnalyticsPropSpec => ({ type: 'enum', values });

/** Every persisted mutation kind (full and patch kinds), the `entity.write` dimension. */
export const MUTATION_KINDS = [
  'table.created', 'table.updated', 'table.moved', 'table.deleted', 'table.patched',
  'column.created', 'column.updated', 'column.deleted', 'column.reordered', 'column.patched',
  'index.created', 'index.updated', 'index.deleted', 'index.reordered', 'index.patched',
  'relationship.created', 'relationship.updated', 'relationship.deleted', 'relationship.patched',
  'element.created', 'element.updated', 'element.moved', 'element.deleted', 'element.reordered', 'element.patched',
  'sequenceDiagram.created', 'sequenceDiagram.updated', 'sequenceDiagram.deleted', 'sequenceDiagram.patched',
  'lifeline.created', 'lifeline.updated', 'lifeline.moved', 'lifeline.deleted', 'lifeline.patched',
  'message.created', 'message.updated', 'message.moved', 'message.deleted', 'message.patched',
  'home.updated', 'themes.updated',
] as const;

/** Canvas element types (mirrors ELEMENT_TYPES; kept literal so the catalog stays self-contained). */
export const ANALYTICS_ELEMENT_TYPES = [
  'rectangle', 'ellipse', 'diamond', 'line', 'arrow', 'freedraw', 'text', 'frame', 'image', 'code', 'grid',
] as const;

const ACCESS = ['OWNER', 'EDIT', 'VIEW'] as const;
const PROJECT_TYPE = ['ERD', 'FLOW', 'SCRATCH'] as const;
const MEDIA_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'video/mp4', 'video/webm', 'other',
] as const;
const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

/** Client route templates (never concrete paths: no project ids or share tokens). */
export const CLIENT_ROUTE_TEMPLATES = [
  '/', '/projects/:projectId', '/guide', '/guide/:tool', '/shared/:token', '/admin', 'other',
] as const;

/** Guide pages (`/guide/:tool`). */
export const GUIDE_TOOL_IDS = [
  'select', 'tables', 'sequence', 'shapes', 'text', 'draw', 'code', 'grid', 'media', 'frame', 'laser',
  'presentations', 'design', 'present', 'export', 'other',
] as const;

export const ANALYTICS_EVENTS = {
  // --- Requests (interceptor) ---
  /** One HTTP request. Route template, status and duration are columns. `sample` < 1 for sampled GETs. */
  'api.request': { props: { method: oneOf(HTTP_METHODS), sample: num(1), slow: bool } },
  /** 304 responses, counted per minute and route only. */
  'api.not_modified': { props: {} },

  // --- Mutation bus (pre-aggregated per minute) ---
  'entity.write': { props: { kind: oneOf(MUTATION_KINDS), elementType: oneOf(ANALYTICS_ELEMENT_TYPES) } },

  // --- Auth ---
  'auth.signup': { props: { method: oneOf(['password']) } },
  'auth.login': { props: { method: oneOf(['password']) } },
  'auth.login_failed': { props: { reason: oneOf(['credentials', 'locked']) } },
  'auth.logout': { props: {} },
  'guest.claimed': { props: { count: num() } },

  // --- Projects ---
  'project.created': { props: { type: oneOf(PROJECT_TYPE) } },
  'project.duplicated': { props: { type: oneOf(PROJECT_TYPE) } },
  'project.deleted': { props: {} },
  'project.archived': { props: { archived: bool } },
  /** GET /projects/:id with a 200 (not 304), once per actor and project per 30 min. */
  'project.opened': { props: { access: oneOf(ACCESS) } },
  'project.imported': {
    props: { tables: num(), elements: num(), sequenceDiagrams: num(), images: num(), into: bool },
  },
  'project.exported': { props: { images: num() } },
  'export.sql': { props: { dialect: oneOf(['mysql', 'postgres', 'sqlite']) } },

  // --- Sharing ---
  'share.created': { props: { access: oneOf(ACCESS), hasExpiry: bool } },
  'share.revoked': { props: {} },
  /** GET /shared/:token, once per link and client per hour. */
  'share.opened': { props: { access: oneOf(ACCESS) } },

  // --- Media ---
  'image.uploaded': { props: { mimeType: oneOf(MEDIA_TYPES), bytes: num(), deduped: bool } },

  // --- API tokens ---
  'token.created': { props: { scope: oneOf(['read', 'write']) } },
  'token.revoked': { props: {} },
  /** At most once per token per minute. */
  'token.used': { props: { scope: oneOf(['read', 'write']) } },

  // --- Realtime (gateway, internal bus only) ---
  'realtime.joined': { props: { access: oneOf(ACCESS), roomSize: num(10_000) } },
  'realtime.left': { props: { sessionMs: num(), roomSize: num(10_000) } },
  'present.started': { props: {} },
  'present.ended': { props: { durationMs: num() } },

  // --- Analytics itself ---
  /** Rows dropped because the buffer was full (count column). */
  'analytics.dropped': { props: {} },
  /** Beacon events refused (unknown name or bad shape), counted per minute. */
  'telemetry.rejected': { props: {} },

  // --- Client beacon ---
  'client.pageview': { client: true, props: { route: oneOf(CLIENT_ROUTE_TEMPLATES) } },
  'client.present': {
    client: true,
    props: { action: oneOf(['start', 'end']), slides: num(10_000), durationMs: num(), solo: bool },
  },
  'client.export_image': {
    client: true,
    props: { format: oneOf(['png', 'svg', 'pdf', 'clipboard']), scope: oneOf(['canvas', 'selection', 'slide', 'deck']) },
  },
  'client.guide_tab': { client: true, props: { tool: oneOf(GUIDE_TOOL_IDS) } },
  'client.laser': { client: true, props: { action: oneOf(['on', 'off']) } },
  'client.error': { client: true, props: { kind: oneOf(['uncaught', 'unhandled_rejection', 'http', 'chunk_load']) } },
} as const satisfies Record<string, AnalyticsEventSpec>;

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS;
export type ClientAnalyticsEventName = {
  [N in AnalyticsEventName]: (typeof ANALYTICS_EVENTS)[N] extends { client: true } ? N : never;
}[AnalyticsEventName];

type PropValue<S> = S extends { type: 'number' }
  ? number
  : S extends { type: 'boolean' }
    ? boolean
    : S extends { type: 'enum'; values: readonly (infer V)[] }
      ? V
      : never;

/** Typed props for an event (all optional; unknown keys are not allowed). */
export type AnalyticsProps<N extends AnalyticsEventName> = {
  -readonly [K in keyof (typeof ANALYTICS_EVENTS)[N]['props']]?: PropValue<(typeof ANALYTICS_EVENTS)[N]['props'][K]>;
};

export type AnalyticsPropValue = number | boolean | string;

/** Max serialized props size per event. */
export const ANALYTICS_MAX_PROPS_BYTES = 1024;

/** Client beacon limits: events per request and JSON body bytes. */
export const TELEMETRY_MAX_EVENTS = 20;
export const TELEMETRY_MAX_BODY_BYTES = 8 * 1024;

/** One event as sent by the client beacon. */
export interface TelemetryEventInput {
  name: ClientAnalyticsEventName;
  props?: Record<string, AnalyticsPropValue>;
}

/** `POST /api/telemetry` body. */
export interface TelemetryBatch {
  events: TelemetryEventInput[];
}

export function isAnalyticsEventName(name: unknown): name is AnalyticsEventName {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(ANALYTICS_EVENTS, name);
}

export function isClientAnalyticsEventName(name: unknown): name is ClientAnalyticsEventName {
  return isAnalyticsEventName(name) && (ANALYTICS_EVENTS[name] as AnalyticsEventSpec).client === true;
}

function validValue(spec: AnalyticsPropSpec, value: unknown): value is AnalyticsPropValue {
  switch (spec.type) {
    case 'number':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= (spec.min ?? -Number.MAX_SAFE_INTEGER) &&
        value <= (spec.max ?? Number.MAX_SAFE_INTEGER)
      );
    case 'boolean':
      return typeof value === 'boolean';
    case 'enum':
      return typeof value === 'string' && spec.values.includes(value);
  }
}

/**
 * Keep only the props the event declares, with valid values; everything else is
 * dropped silently. Returns null for an unknown event name. The result is never
 * larger than {@link ANALYTICS_MAX_PROPS_BYTES} once serialized.
 */
export function sanitizeAnalyticsProps(
  name: string,
  props: unknown,
): Record<string, AnalyticsPropValue> | null {
  if (!isAnalyticsEventName(name)) return null;
  const spec = ANALYTICS_EVENTS[name].props as Readonly<Record<string, AnalyticsPropSpec>>;
  const out: Record<string, AnalyticsPropValue> = {};
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    for (const key of Object.keys(spec)) {
      const value = (props as Record<string, unknown>)[key];
      if (value !== undefined && validValue(spec[key], value)) {
        out[key] = typeof value === 'number' ? Math.round(value * 1000) / 1000 : value;
      }
    }
  }
  // Declared props are short enums/numbers, so this only trips on a malformed catalog.
  return JSON.stringify(out).length <= ANALYTICS_MAX_PROPS_BYTES ? out : {};
}
