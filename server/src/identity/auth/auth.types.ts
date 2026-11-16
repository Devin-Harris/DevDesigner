/** Shared auth primitives used across the guard, decorator, and service. */

/** Name of the httpOnly cookie carrying the session JWT. */
export const AUTH_COOKIE = 'access_token';

/** Default session lifetime (JWT_EXPIRES_IN unset or unparseable); the cookie maxAge follows JWT_EXPIRES_IN. */
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Emitted (awaited, via emitAsync) right before an account row is deleted, so every
 * module drops what the account owns: projects, themes, analytics rows.
 */
export const ACCOUNT_DELETED_EVENT = 'account.deleted';

export interface AccountDeletedEvent {
  userId: string;
}

/** Signed JWT payload. `sub` is the user id. */
export interface JwtPayload {
  sub: string;
  email: string | null;
  /** users.tokenVersion at signing time; absent on tokens issued before it existed (= 0). */
  tv?: number;
}

/**
 * The authenticated caller attached to the request by the optional auth guard.
 * Null on the request when the caller is anonymous. Kept minimal (no DB hit):
 * everything here comes straight from the verified token.
 */
export interface AuthUser {
  id: string;
  email: string | null;
  /** Set when the caller authenticated with an API token instead of a session cookie. */
  viaToken?: { id: string; scope: 'read' | 'write' };
}

/** Account role. Stored on users.role; never carried in the JWT. */
export type UserRole = 'user' | 'admin';
