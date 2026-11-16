import type { CookieOptions } from 'express';

/** Reads string settings; satisfied by ConfigService and by a plain env lookup. */
export interface CookieConfig {
  get<T = string>(key: string, fallback: T): T;
}

/**
 * Cookie attributes shared by the session and guest cookies. Secure is on in
 * production (COOKIE_SECURE). When the client and API live on different sites, set
 * COOKIE_SAMESITE=none (browsers require Secure with it, so it is forced on). Those
 * cross-site cookies are also Partitioned (CHIPS), so browsers that block
 * third-party cookies still keep them, keyed to the client's site.
 */
export function baseCookieOptions(config: CookieConfig, maxAge: number): CookieOptions {
  const raw = String(config.get<string>('COOKIE_SAMESITE', 'lax')).toLowerCase();
  const sameSite: CookieOptions['sameSite'] = raw === 'none' || raw === 'strict' ? raw : 'lax';
  const secure = sameSite === 'none' || String(config.get<string>('COOKIE_SECURE', 'false')) === 'true';
  return { httpOnly: true, sameSite, secure, partitioned: sameSite === 'none', path: '/', maxAge };
}

/** Parse a single cookie value out of a raw Cookie header (no cookie-parser dep). */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) {
    return null;
  }
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      continue;
    }
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/**
 * Milliseconds for a JWT-style duration (`7d`, `12h`, `30m`). A bare numeric string
 * means milliseconds, as jsonwebtoken (vercel/ms) reads it. Unparseable values give
 * the fallback.
 */
export function durationMs(value: unknown, fallbackMs: number): number {
  const text = String(value ?? '').trim().toLowerCase();
  if (/^\d+$/.test(text)) return Number(text) > 0 ? Number(text) : fallbackMs;
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)$/.exec(text);
  if (!match) return fallbackMs;
  const ms = Number(match[1]) * UNIT_MS[match[2]];
  return ms > 0 ? ms : fallbackMs;
}
