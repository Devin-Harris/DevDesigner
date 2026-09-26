/** Shared auth primitives used across the guard, decorator, and service. */

/** Name of the httpOnly cookie carrying the session JWT. */
export const AUTH_COOKIE = 'access_token';

/** Session lifetime, applied to both the JWT and the cookie maxAge. */
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Signed JWT payload. `sub` is the user id. */
export interface JwtPayload {
  sub: string;
  email: string | null;
}

/**
 * The authenticated caller attached to the request by the optional auth guard.
 * Null on the request when the caller is anonymous. Kept minimal (no DB hit):
 * everything here comes straight from the verified token.
 */
export interface AuthUser {
  id: string;
  email: string | null;
}
