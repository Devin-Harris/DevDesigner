import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

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
 * Inject the caller tab's X-Client-Id, or null when absent. It rides on every
 * write so the realtime broadcast can be self-filtered by the tab that made the
 * change (which already applied it optimistically).
 */
export const ClientId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const value = request.headers['x-client-id'];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
    return null;
  },
);
