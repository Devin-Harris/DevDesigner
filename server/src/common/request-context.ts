import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  NestMiddleware,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { Observable } from 'rxjs';

/** Per-request facts shared by logging, error reporting and (later) analytics. */
export interface RequestContext {
  requestId: string;
  /** Account id once the auth guard has run (null for anonymous callers). */
  userId: string | null;
  /** Raw X-Guest-Id header; never logged as-is. */
  guestId: string | null;
  /** True when the caller presents an X-Share-Token (link-based access). */
  viaShareToken: boolean;
  clientId: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();
const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** The current request's context, or undefined outside a request. */
export function requestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

const header = (req: IncomingMessage, name: string): string | null => {
  const value = req.headers[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

/**
 * Request id from a well-formed incoming X-Request-Id, else a fresh UUID. Cached on
 * the request so pino-http's genReqId and the context middleware agree.
 */
export function resolveRequestId(req: IncomingMessage): string {
  const cached = (req as IncomingMessage & { id?: unknown }).id;
  if (typeof cached === 'string') return cached;
  const incoming = header(req, 'x-request-id');
  const id = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  (req as IncomingMessage & { id?: string }).id = id;
  return id;
}

/** Opens the request's context and echoes X-Request-Id. Registered for all routes. */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = resolveRequestId(req);
    res.setHeader(REQUEST_ID_HEADER, requestId);
    runWithRequestContext(
      {
        requestId,
        userId: null,
        guestId: header(req, 'x-guest-id'),
        viaShareToken: header(req, 'x-share-token') !== null,
        clientId: header(req, 'x-client-id'),
      },
      next,
    );
  }
}

/** Copies the caller resolved by the global auth guard into the context. */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = storage.getStore();
    if (ctx && context.getType() === 'http') {
      const req = context.switchToHttp().getRequest<Request & { user?: { id?: string } | null }>();
      ctx.userId = req.user?.id ?? null;
    }
    return next.handle();
  }
}
