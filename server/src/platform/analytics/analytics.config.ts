import { dirname, join } from 'node:path';

/** Name of the separate TypeORM connection for analytics.sqlite. */
export const ANALYTICS_CONNECTION = 'analytics';

/** Runtime knobs for event capture (validated by platform/config/env.validation). */
export interface AnalyticsConfig {
  enabled: boolean;
  databasePath: string;
  saltSecret: string | null;
  /** Fraction of fast, successful, anonymous-or-web GETs recorded (0-1). */
  getSample: number;
  /** Requests at least this slow (ms) are always recorded. */
  slowRequestMs: number;
  /** Raw events older than this are purged (0 = keep forever). */
  rawRetentionDays: number;
  /** Flush timer and size trigger. */
  flushIntervalMs: number;
  flushAtRows: number;
  /** Rows held in memory at most; beyond this new rows are dropped and counted. */
  maxBufferRows: number;
}

type Env = Record<string, unknown>;

const str = (env: Env, key: string): string => {
  const v = env[key];
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
};

const numberOr = (env: Env, key: string, fallback: number): number => {
  const raw = str(env, key);
  const n = raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

/** ANALYTICS_ENABLED (default on): readable before ConfigService exists. */
export function analyticsEnabled(env: Env = process.env): boolean {
  return !['false', '0', 'no'].includes(str(env, 'ANALYTICS_ENABLED').toLowerCase());
}

/** analytics.sqlite next to the app database unless ANALYTICS_DATABASE_PATH is set. */
export function analyticsDatabasePath(env: Env = process.env): string {
  const explicit = str(env, 'ANALYTICS_DATABASE_PATH');
  if (explicit) return explicit;
  const app = str(env, 'DATABASE_PATH') || 'devdesigner.sqlite';
  return app === ':memory:' ? ':memory:' : join(dirname(app), 'analytics.sqlite');
}

export function analyticsConfig(env: Env = process.env): AnalyticsConfig {
  return {
    enabled: analyticsEnabled(env),
    databasePath: analyticsDatabasePath(env),
    saltSecret: str(env, 'ANALYTICS_SALT_SECRET') || null,
    getSample: Math.min(1, Math.max(0, numberOr(env, 'ANALYTICS_GET_SAMPLE', 0.05))),
    slowRequestMs: Math.max(0, numberOr(env, 'SLOW_REQUEST_MS', 1000)),
    rawRetentionDays: Math.max(0, numberOr(env, 'ANALYTICS_RAW_RETENTION_DAYS', 90)),
    flushIntervalMs: 10_000,
    flushAtRows: 500,
    maxBufferRows: 10_000,
  };
}
