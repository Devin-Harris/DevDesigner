import { createHash } from 'node:crypto';
import { applyDecorators, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { guestOwnerId } from '../../identity/auth/guest-id';

/**
 * HTTP rate limiting (security H-3 / S3.1), on top of @nestjs/throttler.
 *
 * Two named throttlers run on every request:
 *  - `default`: keyed by WHO is calling: the account (session or API token), else
 *    this browser's guest id, else the client IP.
 *  - `ip`: keyed by the client IP only. Guest ids are chosen by the client, so this
 *    second bucket is what stops a caller who rotates X-Guest-Id on every request.
 *
 * Unless a route opts into a named policy with `@RateLimit(...)`, both count against
 * one GLOBAL bucket per caller (not one per route). A policy gets its own bucket per
 * caller, shared by every route using that policy (import and import-content share
 * one), with its own limits for both throttlers.
 */
export const THROTTLER_IDENTITY = 'default';
export const THROTTLER_IP = 'ip';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface RatePolicy {
  /** Requests per window per caller identity. */
  limit: number;
  /** Requests per window per client IP (covers guest-id rotation). */
  ipLimit: number;
  /** Window in ms. */
  ttl: number;
}

/**
 * Stricter buckets for expensive or abuse-prone routes. Generous for people using
 * the app; tight enough that a script cannot burn CPU, disk or accounts.
 */
export const RATE_POLICIES = {
  /** bcrypt compare is ~250 ms of CPU; per-email backoff (LoginBackoff) adds to this. */
  login: { limit: 10, ipLimit: 30, ttl: MINUTE },
  register: { limit: 10, ipLimit: 20, ttl: HOUR },
  projectCreate: { limit: 60, ipLimit: 120, ttl: MINUTE },
  /** Import files can be 200 MB and write thousands of rows. */
  projectImport: { limit: 20, ipLimit: 40, ttl: MINUTE },
  /** Export files base64 every image of the project. */
  exportFile: { limit: 30, ipLimit: 60, ttl: MINUTE },
  imageUpload: { limit: 120, ipLimit: 240, ttl: MINUTE },
  shareCreate: { limit: 30, ipLimit: 60, ttl: MINUTE },
  admin: { limit: 120, ipLimit: 240, ttl: MINUTE },
  /** Client analytics beacon: one batch (<= 20 events) every ~15 s per tab. */
  telemetry: { limit: 30, ipLimit: 120, ttl: MINUTE },
} satisfies Record<string, RatePolicy>;

export type RatePolicyName = keyof typeof RATE_POLICIES;

export const RATE_POLICY_KEY = 'dd:rate-policy';

/** Put a route (or a whole controller) in a named, stricter rate-limit bucket. */
export function RateLimit(name: RatePolicyName): MethodDecorator & ClassDecorator {
  const p: RatePolicy = RATE_POLICIES[name];
  return applyDecorators(
    SetMetadata(RATE_POLICY_KEY, name),
    Throttle({
      [THROTTLER_IDENTITY]: { limit: p.limit, ttl: p.ttl },
      [THROTTLER_IP]: { limit: p.ipLimit, ttl: p.ttl },
    }),
  );
}

/** Exempt a route or controller from rate limiting entirely (health checks). */
export const NoRateLimit = (): MethodDecorator & ClassDecorator =>
  SkipThrottle({ [THROTTLER_IDENTITY]: true, [THROTTLER_IP]: true });

/** The policy a handler (or its class) declared, if any. */
export function ratePolicyOf(context: ExecutionContext): RatePolicyName | undefined {
  return (
    (Reflect.getMetadata(RATE_POLICY_KEY, context.getHandler()) as RatePolicyName | undefined) ??
    (Reflect.getMetadata(RATE_POLICY_KEY, context.getClass()) as RatePolicyName | undefined)
  );
}

/** Storage key: `<policy or global>:<throttler>:<tracker>` (hashed so ids never sit in memory raw). */
export function rateKey(context: ExecutionContext, tracker: string, throttlerName: string): string {
  const bucket = ratePolicyOf(context) ?? 'global';
  return createHash('sha256').update(`${bucket}:${throttlerName}:${tracker}`).digest('hex');
}

/** Minimal request shape the trackers read. */
export interface TrackedRequest {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

/** Client IP as Express sees it (honors `trust proxy`), IPv4-mapped IPv6 unwrapped. */
export function clientIp(req: TrackedRequest): string {
  const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

/**
 * Identity tracker: `t:` API token (hashed), `u:` session account, `g:` guest id,
 * else `ip:`. It does not depend on the auth guard having run first: the bearer
 * token is hashed as-is and the cookie is verified by `sessionUserId` (no DB hit).
 */
export function identityTracker(req: TrackedRequest, sessionUserId: (cookie: string | undefined) => string | null): string {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && /^Bearer\s+\S/i.test(auth)) {
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    return `t:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`;
  }
  const cookie = req.headers['cookie'];
  const userId = sessionUserId(typeof cookie === 'string' ? cookie : undefined);
  if (userId) return `u:${userId}`;
  const guest = guestOwnerId(req.headers['x-guest-id']);
  if (guest) return `g:${guest.slice('guest:'.length)}`;
  return `ip:${clientIp(req)}`;
}

/** IP tracker for the `ip` throttler. */
export function ipTracker(req: TrackedRequest): string {
  return `ip:${clientIp(req)}`;
}
