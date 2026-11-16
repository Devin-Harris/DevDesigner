import type { NextFunction, Request, Response } from 'express';
import { baseCookieOptions, readCookie, type CookieConfig } from './cookies';

/**
 * Anonymous callers identify their browser with a random guest id. Projects
 * created without an account are owned by `guest:<id>`, so one browser's guest
 * projects are invisible to every other browser.
 *
 * The id lives in an httpOnly cookie the server issues (security L-2), so page
 * script cannot read or swap it. Older clients keep the id in localStorage and
 * send it as X-Guest-Id; for a migration window the server adopts that header
 * value into the cookie on first sight, after which the cookie always wins.
 */
const GUEST_ID = /^[A-Za-z0-9_-]{16,64}$/;

/** Name of the httpOnly guest cookie. */
export const GUEST_COOKIE = 'dd_guest';
/** Guest cookies live a year (refreshed whenever one is adopted). */
const GUEST_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

export function isGuestId(raw: unknown): raw is string {
  return typeof raw === 'string' && GUEST_ID.test(raw);
}

export function guestOwnerId(raw: unknown): string | null {
  return isGuestId(raw) ? `guest:${raw}` : null;
}

/** The guest id a request (or socket handshake) presents: the cookie first, else the header. */
export function presentedGuestId(cookieHeader: string | undefined, headerValue: unknown): string | null {
  const fromCookie = readCookie(cookieHeader, GUEST_COOKIE);
  if (isGuestId(fromCookie)) return fromCookie;
  return isGuestId(headerValue) ? headerValue : null;
}

/**
 * Express middleware (runs before guards): settles the request's guest id, from
 * the cookie when present, and rewrites X-Guest-Id to it so every reader (caller,
 * rate limits, analytics) sees the same identity. A header-only caller gets the
 * cookie issued for its id.
 */
export function guestCookieMiddleware(config: CookieConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const fromCookie = readCookie(req.headers.cookie, GUEST_COOKIE);
    if (isGuestId(fromCookie)) {
      req.headers['x-guest-id'] = fromCookie;
    } else {
      const header = req.headers['x-guest-id'];
      if (isGuestId(header)) {
        res.cookie(GUEST_COOKIE, header, baseCookieOptions(config, GUEST_COOKIE_MAX_AGE_MS));
      } else if (header !== undefined) {
        delete req.headers['x-guest-id'];
      }
    }
    next();
  };
}
