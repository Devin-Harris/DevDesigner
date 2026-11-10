import { randomBytes } from 'node:crypto';

/**
 * Server-assigned realtime client ids (security L-1).
 *
 * Every socket gets a random, unguessable id from the server. The tab sends it
 * back as X-Client-Id on its writes so the broadcast of that write skips its own
 * socket. An incoming id is honored only when it belongs to a live socket opened
 * by the same principal (account, else guest id, else share token); the gateway
 * also checks the project. Anything else is ignored and the change goes to
 * everyone, so no one can hide their writes from a chosen collaborator.
 *
 * Kept at module level (like the project revision counter) so the request
 * decorator, which has no DI, can read it.
 */
export interface RealtimeClient {
  /** Who opened the socket, as returned by realtimePrincipal; null when anonymous. */
  principal: string | null;
  projectId: string;
}

const clients = new Map<string, RealtimeClient>();

/** A fresh, unguessable client id (32 url-safe characters). */
export function mintRealtimeClientId(): string {
  return randomBytes(24).toString('base64url');
}

export function registerRealtimeClient(clientId: string, client: RealtimeClient): void {
  clients.set(clientId, client);
}

export function unregisterRealtimeClient(clientId: string): void {
  clients.delete(clientId);
}

/** The live socket's registration for this id, if any. */
export function realtimeClient(clientId: string): RealtimeClient | undefined {
  return clients.get(clientId);
}

/**
 * The identity a socket or request acts as: the account when signed in, else
 * the browser's guest owner id (`guest:<id>`), else the share token. Null when
 * the caller carries none of them.
 */
export function realtimePrincipal(
  userId: string | null | undefined,
  guestOwner: string | null | undefined,
  shareToken: string | null | undefined,
): string | null {
  if (userId) return `user:${userId}`;
  if (guestOwner) return guestOwner;
  if (shareToken) return `token:${shareToken}`;
  return null;
}

/**
 * The X-Client-Id to exclude from a write's broadcast, or null when the header is
 * absent, unknown (stale or never issued) or belongs to another principal.
 */
export function trustedClientId(raw: unknown, principal: string | null): string | null {
  if (typeof raw !== 'string' || !raw || !principal) return null;
  const client = clients.get(raw);
  return client && client.principal === principal ? raw : null;
}
