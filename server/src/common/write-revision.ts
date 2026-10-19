import { randomUUID } from 'node:crypto';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { finalize, type Observable } from 'rxjs';

/**
 * A process-wide counter bumped after every write request (any non-GET HTTP call).
 * Every persisted change goes through REST, so "no write since revision N" means a
 * project graph read at N is still current: the graph endpoint uses it as its ETag
 * and answers 304 without rebuilding the graph. Coarse (any write anywhere bumps it)
 * but never stale. The boot id keeps tags from a previous server process invalid.
 */
const BOOT = randomUUID().slice(0, 8);
let revision = 0;

export function writeRevisionTag(): string {
  return `W/"r-${BOOT}-${revision}"`;
}

export class WriteRevisionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const method = context.switchToHttp().getRequest<Request>().method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next.handle();
    // Bump once the write has finished (succeeded or not): a read tagged with the old
    // revision can then never be mistaken for one taken after the write.
    return next.handle().pipe(finalize(() => (revision += 1)));
  }
}
