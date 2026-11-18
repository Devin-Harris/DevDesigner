import {
  HttpException,
  Injectable,
  NotFoundException,
  StreamableFile,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { catchError, from, mergeMap, of, type Observable } from 'rxjs';
import type { RequestWithProjectAccess } from '../../collaboration/access/access-policy.types';
import { RemoteUnreachableError, type RemoteClient } from './remote-client';
import { SyncService } from './sync.service';

/** DELETE /api/projects/:id stays local: removing it here never deletes the server's project. */
const LOCAL_ONLY = [{ method: 'DELETE', path: /^\/api\/projects\/[^/]+$/ }];
/** Media streams (the handler owns the response); served from the mirror, the server as fallback. */
const IMAGE_FILE = /^\/api\/images\/[^/]+$/;

/**
 * Desktop sync: a request for a live server-backed project is sent to the server
 * instead of being handled here, and the server's answer is passed back. If the server
 * turns out to be unreachable the project goes offline and the request is handled
 * locally after all (the edit lands in the mirror and is sent later).
 */
@Injectable()
export class SyncForwardInterceptor implements NestInterceptor {
  constructor(private readonly sync: SyncService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.sync.enabled || context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<Request & RequestWithProjectAccess>();
    const projectId = req.projectAccess?.projectId;
    if (!projectId) return next.handle();
    if (LOCAL_ONLY.some((r) => r.method === req.method && r.path.test(req.path)))
      return next.handle();
    const target = this.sync.forwardTarget(projectId);
    if (!target) return next.handle();

    if (req.method === 'GET' && IMAGE_FILE.test(req.path)) {
      // Local mirror first; an image uploaded on the server moments ago comes from there.
      return next.handle().pipe(
        catchError((err: unknown) => {
          if (!(err instanceof NotFoundException)) throw err;
          return from(this.streamFromServer(req, http.getResponse<Response>(), target.client));
        }),
      );
    }

    return from(this.forward(req, projectId, target)).pipe(
      mergeMap((result) => (result === LOCAL ? next.handle() : of(result))),
    );
  }

  private async forward(
    req: Request,
    projectId: string,
    target: { client: RemoteClient; clientId: string | null },
  ): Promise<StreamableFile | typeof LOCAL> {
    let res;
    try {
      res = await target.client.forward({
        method: req.method,
        path: req.originalUrl.replace(/^\/api/, ''),
        body: requestBody(req),
        contentType: req.headers['content-type'],
        clientId: target.clientId,
      });
    } catch (err) {
      if (err instanceof RemoteUnreachableError) {
        await this.sync.forwardFailed(projectId);
        return LOCAL;
      }
      throw err;
    }
    if (res.status >= 400) {
      let body: unknown = res.body.toString('utf8');
      try {
        body = JSON.parse(body as string);
      } catch {
        // Plain-text error.
      }
      throw new HttpException(body as Record<string, unknown>, res.status);
    }
    if (req.method !== 'GET') this.sync.afterForwardedWrite(projectId);
    // The route's own status code applies (both servers run the same routes).
    return new StreamableFile(res.body, {
      type: res.headers['content-type'] ?? 'application/json',
    });
  }

  private async streamFromServer(req: Request, res: Response, client: RemoteClient): Promise<void> {
    const remote = await client.forward({
      method: 'GET',
      path: req.originalUrl.replace(/^\/api/, ''),
    });
    if (remote.status >= 400) throw new NotFoundException('Image not found.');
    res.status(remote.status).set(remote.headers).end(remote.body);
  }
}

/** Marker: handle the request locally after all. */
const LOCAL = Symbol('local');

function requestBody(req: Request): Buffer | string | undefined {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  if (Buffer.isBuffer(req.body)) return req.body;
  if (req.body === undefined) return undefined;
  return JSON.stringify(req.body);
}
