import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { guestOwnerId } from '../auth/guest-id';
import { realtimePrincipal, trustedClientId } from '../realtime/realtime-clients';

/**
 * Inject the anonymous share token from the X-Share-Token header, or null when
 * absent. Shared-mode clients send this so the access layer can grant the link's
 * level (see BUILD_INSTRUCTIONS.md section 6). Never logged.
 */
export const ShareToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const value = request.headers['x-share-token'];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
    return null;
  },
);

/**
 * The caller tab's X-Client-Id when it can be trusted, else null. The id is
 * issued by the realtime gateway per socket; it is honored only while that
 * socket is open and only for the principal that opened it (security L-1), so a
 * write's broadcast can skip the tab that made it (it applied it optimistically)
 * but nobody can hide a change from someone else's tab.
 */
export function originClientIdOf(
  request: Request & { user?: { id: string } | null },
): string | null {
  const shareToken = request.headers['x-share-token'];
  const principal = realtimePrincipal(
    request.user?.id,
    guestOwnerId(request.headers['x-guest-id']),
    typeof shareToken === 'string' ? shareToken : null,
  );
  return trustedClientId(request.headers['x-client-id'], principal);
}

/** Inject the trusted X-Client-Id (see originClientIdOf), or null. */
export const ClientId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null =>
    originClientIdOf(ctx.switchToHttp().getRequest<Request & { user?: { id: string } | null }>()),
);

/** Inject this browser's raw X-Guest-Id (validate with guestOwnerId), or null. */
export const GuestId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const value = request.headers['x-guest-id'];
    return typeof value === 'string' && value.length > 0 ? value : null;
  },
);
