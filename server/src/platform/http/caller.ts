import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../../auth/auth.types';
import { guestOwnerId } from '../../auth/guest-id';
import { realtimePrincipal, trustedClientId } from '../../realtime/realtime-clients';

/** The request after the global auth guard has resolved the account (or null). */
export type CallerRequest = Request & { user?: Pick<AuthUser, 'id' | 'viaToken'> | null };

/**
 * Who is calling, resolved once from the request: the account (session cookie or
 * API token), this browser's guest id, the share link it presents, and the realtime
 * tab it writes from.
 */
export interface Caller {
  /** Account id when signed in (cookie session or API token), else null. */
  userId: string | null;
  /** Validated guest owner id (`guest:<X-Guest-Id>`), else null. */
  guestId: string | null;
  /**
   * The identity that owns what this caller creates and is matched against
   * `projects.ownerId`: the account when signed in, else the guest id.
   */
  ownerId: string | null;
  /** X-Share-Token as sent (resolved against share_links by the access layer). */
  shareToken: string | null;
  /** X-Client-Id when it belongs to a live socket of this same caller (security L-1), else null. */
  clientId: string | null;
  /** True when the account authenticated with an API token rather than a cookie. */
  viaToken: boolean;
}

const headerValue = (req: Request, name: string): string | null => {
  const value = req.headers[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

/**
 * The caller tab's X-Client-Id when it can be trusted, else null. The id is
 * issued by the realtime gateway per socket; it is honored only while that
 * socket is open and only for the principal that opened it (security L-1), so a
 * write's broadcast can skip the tab that made it (it applied it optimistically)
 * but nobody can hide a change from someone else's tab.
 */
export function originClientIdOf(request: CallerRequest): string | null {
  const principal = realtimePrincipal(
    request.user?.id,
    guestOwnerId(request.headers['x-guest-id']),
    headerValue(request, 'x-share-token'),
  );
  return trustedClientId(request.headers['x-client-id'], principal);
}

/** Resolve the Caller for a request (call after the global auth guard). */
export function callerOf(request: CallerRequest): Caller {
  const userId = request.user?.id ?? null;
  const guestId = guestOwnerId(request.headers['x-guest-id']);
  return {
    userId,
    guestId,
    ownerId: userId ?? guestId,
    shareToken: headerValue(request, 'x-share-token'),
    clientId: originClientIdOf(request),
    viaToken: !!request.user?.viaToken,
  };
}

/** Param decorator: inject the resolved {@link Caller} (`@Caller() caller: Caller`). */
export const Caller = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Caller => callerOf(ctx.switchToHttp().getRequest<CallerRequest>()),
);
