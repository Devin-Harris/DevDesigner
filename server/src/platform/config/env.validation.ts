/**
 * Validates and normalizes the server's environment (ConfigModule.forRoot({ validate })).
 * Defaults match what the code used before validation existed, so local dev needs no
 * .env at all. Production refuses to boot with a missing, short or default JWT_SECRET.
 */

export const DEFAULT_JWT_SECRET = 'change-me-in-production';
const MIN_PROD_SECRET_LENGTH = 32;
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
const SAME_SITE = ['lax', 'strict', 'none'] as const;

export interface EnvConfig {
  NODE_ENV?: string;
  PORT: number;
  CORS_ORIGIN: string;
  PUBLIC_APP_URL: string;
  DATABASE_PATH: string;
  DATABASE_SYNCHRONIZE: 'true' | 'false';
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  COOKIE_SECURE: 'true' | 'false';
  COOKIE_SAMESITE: (typeof SAME_SITE)[number];
  API_TOKEN_RATE_LIMIT: number;
  LOG_LEVEL: (typeof LOG_LEVELS)[number];
  SLOW_QUERY_MS: number;
  SENTRY_DSN: string;
  SENTRY_TRACES_SAMPLE_RATE: number;
  /** Normalized (trimmed, lower-cased, de-duplicated) comma-separated admin allowlist. */
  ADMIN_EMAILS: string;
  /** Reverse-proxy hops in front of the server (Railway: 1); 0 = trust none. */
  TRUST_PROXY_HOPS: number;
  RATE_LIMIT_ENABLED: 'true' | 'false';
  /** Requests per minute per caller (account, guest id or IP) across all routes. */
  RATE_LIMIT_PER_MIN: number;
  /** Requests per minute per client IP across all routes. */
  RATE_LIMIT_IP_PER_MIN: number;
  /** Storage quotas (0 = unlimited). */
  QUOTA_PROJECTS_PER_OWNER: number;
  QUOTA_TABLES_PER_PROJECT: number;
  QUOTA_ELEMENTS_PER_PROJECT: number;
  QUOTA_IMAGE_BYTES_PER_OWNER: number;
  QUOTA_IMAGE_BYTES_PER_PROJECT: number;
  QUOTA_IMPORT_MAX_IMAGES: number;
  /** Lifetime of access-cache entries (project owner, share link); 0 = no cache. */
  ACCESS_CACHE_TTL_MS: number;
  /** Total bytes of serialized graphs kept in memory; 0 = no graph cache. */
  GRAPH_CACHE_MAX_BYTES: number;
  /** Broadcast batch edits as `*.patched` (changed fields only); needs patch-aware clients. */
  REALTIME_PATCH_MUTATIONS: 'true' | 'false';
  /** Media store driver (only `fs`). */
  MEDIA_DRIVER: 'fs';
  /** Media folder; empty = a `media` folder next to DATABASE_PATH. */
  MEDIA_DIR: string;
  /** First-party analytics capture (audit 04 Phase 1); also gates the activity touches. */
  ANALYTICS_ENABLED: 'true' | 'false';
  /** analytics.sqlite location; empty = next to DATABASE_PATH. */
  ANALYTICS_DATABASE_PATH: string;
  /** Keys the IP / guest / share hashes; empty = random per process. */
  ANALYTICS_SALT_SECRET: string;
  /** Fraction (0-1) of fast, successful web GETs recorded as api.request. */
  ANALYTICS_GET_SAMPLE: number;
  /** Requests at least this slow (ms) are always recorded. */
  SLOW_REQUEST_MS: number;
  /** Raw analytics events older than this are purged daily (0 = keep). */
  ANALYTICS_RAW_RETENTION_DAYS: number;
  [key: string]: unknown;
}

export function isProduction(env: Record<string, unknown> = process.env): boolean {
  return env['NODE_ENV'] === 'production';
}

export function validateEnv(raw: Record<string, unknown>): EnvConfig {
  const errors: string[] = [];
  const prod = isProduction(raw);

  const str = (key: string, fallback: string): string => {
    const value = raw[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
  };
  const int = (key: string, fallback: number, min: number, max: number): number => {
    const value = str(key, '');
    if (value === '') return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) {
      errors.push(`${key} must be an integer between ${min} and ${max} (got "${value}")`);
      return fallback;
    }
    return n;
  };
  const bool = (key: string, fallback: boolean): 'true' | 'false' => {
    const value = str(key, '').toLowerCase();
    if (value === '') return fallback ? 'true' : 'false';
    if (['true', '1', 'yes'].includes(value)) return 'true';
    if (['false', '0', 'no'].includes(value)) return 'false';
    errors.push(`${key} must be true or false (got "${value}")`);
    return fallback ? 'true' : 'false';
  };
  const oneOf = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = str(key, '').toLowerCase();
    if (value === '') return fallback;
    if ((allowed as readonly string[]).includes(value)) return value as T;
    errors.push(`${key} must be one of ${allowed.join(', ')} (got "${value}")`);
    return fallback;
  };

  const jwtSecret = typeof raw['JWT_SECRET'] === 'string' ? raw['JWT_SECRET'] : '';
  if (prod) {
    if (jwtSecret === '') {
      errors.push('JWT_SECRET is required in production');
    } else if (jwtSecret === DEFAULT_JWT_SECRET) {
      errors.push('JWT_SECRET must not be the public default in production');
    } else if (jwtSecret.length < MIN_PROD_SECRET_LENGTH) {
      errors.push(`JWT_SECRET must be at least ${MIN_PROD_SECRET_LENGTH} characters in production`);
    }
  }

  const fraction = (key: string, fallback: number): number => {
    const value = str(key, '');
    if (value === '') return fallback;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      errors.push(`${key} must be a number between 0 and 1 (got "${value}")`);
      return fallback;
    }
    return n;
  };
  const sampleRate = fraction('SENTRY_TRACES_SAMPLE_RATE', 0);

  const adminEmails = parseAdminEmails(str('ADMIN_EMAILS', ''));
  const badAdmin = adminEmails.filter((email) => !/^[^@\s]+@[^@\s]+$/.test(email));
  if (badAdmin.length > 0) {
    errors.push(`ADMIN_EMAILS must be comma-separated email addresses (got "${badAdmin.join('", "')}")`);
  }

  const config: EnvConfig = {
    ...raw,
    PORT: int('PORT', 3000, 1, 65535),
    CORS_ORIGIN: str('CORS_ORIGIN', 'http://localhost:4242'),
    PUBLIC_APP_URL: str('PUBLIC_APP_URL', 'http://localhost:4242'),
    DATABASE_PATH: str('DATABASE_PATH', 'devdesigner.sqlite'),
    // Production still relies on synchronize to create/alter tables (there is no
    // baseline migration and no migrationsRun), so the default stays on everywhere.
    DATABASE_SYNCHRONIZE: bool('DATABASE_SYNCHRONIZE', true),
    JWT_SECRET: jwtSecret === '' ? DEFAULT_JWT_SECRET : jwtSecret,
    JWT_EXPIRES_IN: str('JWT_EXPIRES_IN', '7d'),
    COOKIE_SECURE: bool('COOKIE_SECURE', false),
    COOKIE_SAMESITE: oneOf('COOKIE_SAMESITE', SAME_SITE, 'lax'),
    API_TOKEN_RATE_LIMIT: int('API_TOKEN_RATE_LIMIT', 600, 1, 1_000_000),
    LOG_LEVEL: oneOf('LOG_LEVEL', LOG_LEVELS, prod ? 'info' : 'debug'),
    SLOW_QUERY_MS: int('SLOW_QUERY_MS', 200, 0, 600_000),
    SENTRY_DSN: str('SENTRY_DSN', ''),
    SENTRY_TRACES_SAMPLE_RATE: sampleRate,
    ADMIN_EMAILS: adminEmails.join(','),
    TRUST_PROXY_HOPS: int('TRUST_PROXY_HOPS', 1, 0, 10),
    RATE_LIMIT_ENABLED: bool('RATE_LIMIT_ENABLED', true),
    RATE_LIMIT_PER_MIN: int('RATE_LIMIT_PER_MIN', 1200, 1, 1_000_000),
    RATE_LIMIT_IP_PER_MIN: int('RATE_LIMIT_IP_PER_MIN', 3000, 1, 1_000_000),
    QUOTA_PROJECTS_PER_OWNER: int('QUOTA_PROJECTS_PER_OWNER', 500, 0, 10_000_000),
    QUOTA_TABLES_PER_PROJECT: int('QUOTA_TABLES_PER_PROJECT', 5_000, 0, 10_000_000),
    QUOTA_ELEMENTS_PER_PROJECT: int('QUOTA_ELEMENTS_PER_PROJECT', 20_000, 0, 10_000_000),
    QUOTA_IMAGE_BYTES_PER_OWNER: int('QUOTA_IMAGE_BYTES_PER_OWNER', 1024 ** 3, 0, 2 ** 50),
    QUOTA_IMAGE_BYTES_PER_PROJECT: int('QUOTA_IMAGE_BYTES_PER_PROJECT', 512 * 1024 ** 2, 0, 2 ** 50),
    QUOTA_IMPORT_MAX_IMAGES: int('QUOTA_IMPORT_MAX_IMAGES', 1_000, 0, 10_000_000),
    ACCESS_CACHE_TTL_MS: int('ACCESS_CACHE_TTL_MS', 30_000, 0, 600_000),
    GRAPH_CACHE_MAX_BYTES: int('GRAPH_CACHE_MAX_BYTES', 64 * 1024 * 1024, 0, 2 ** 40),
    REALTIME_PATCH_MUTATIONS: bool('REALTIME_PATCH_MUTATIONS', true),
    MEDIA_DRIVER: oneOf('MEDIA_DRIVER', ['fs'] as const, 'fs'),
    MEDIA_DIR: str('MEDIA_DIR', ''),
    ANALYTICS_ENABLED: bool('ANALYTICS_ENABLED', true),
    ANALYTICS_DATABASE_PATH: str('ANALYTICS_DATABASE_PATH', ''),
    ANALYTICS_SALT_SECRET: str('ANALYTICS_SALT_SECRET', ''),
    ANALYTICS_GET_SAMPLE: fraction('ANALYTICS_GET_SAMPLE', 0.05),
    SLOW_REQUEST_MS: int('SLOW_REQUEST_MS', 1000, 0, 600_000),
    ANALYTICS_RAW_RETENTION_DAYS: int('ANALYTICS_RAW_RETENTION_DAYS', 90, 0, 36_500),
  };

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n  - ${errors.join('\n  - ')}`);
  }
  return config;
}

/** Split a comma-separated email list into trimmed, lower-cased, unique entries. */
export function parseAdminEmails(value: string | undefined): string[] {
  if (!value) return [];
  const emails = value
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email !== '');
  return [...new Set(emails)];
}
