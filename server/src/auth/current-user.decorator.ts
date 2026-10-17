import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from './auth.types';
import { guestOwnerId } from './guest-id';

interface RequestWithUser extends Request {
  user?: AuthUser | null;
}

/** Inject the authenticated caller, or null when anonymous. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | null => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    return request.user ?? null;
  },
);

/**
 * Inject the caller's owner id for scoping: the account id when signed in,
 * else `guest:<id>` from this browser's X-Guest-Id, else null.
 */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    return request.user?.id ?? guestOwnerId(request.headers['x-guest-id']);
  },
);
