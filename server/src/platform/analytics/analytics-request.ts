import { performance } from 'node:perf_hooks';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  NestMiddleware,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { Observable } from 'rxjs';
import type { AccessLevel } from '@devdesigner/shared';
import { guestOwnerId } from '../../identity/auth/guest-id';
import type { AuthUser } from '../../identity/auth/auth.types';
import { requestContext, resolveRequestId } from '../http/request-context';
import { clientIp } from '../throttle/rate-limit';
import { ActivityTouchService } from './activity-touch.service';
import { TouchThrottle } from './touch-throttle';
import { AnalyticsService } from './analytics.service';
import type { AnalyticsActor, AnalyticsSource, RequestAnalytics } from './analytics.types';
import { mcpToolOf, uaFamily } from './privacy';

type AnalyticsRequest = Request & {
  user?: Pick<AuthUser, 'id' | 'viaToken'> | null;
  projectAccess?: { projectId: string; accessLevel: AccessLevel };
};

const header = (req: Request, name: string): string | null => {
  const value = req.headers[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

/** Never recorded as api.request: liveness probes and the beacon (recorded as its own events). */
const SKIPPED_PATHS = /^\/api\/(health|telemetry)(\/|\?|$)/;
const OPEN_ROUTE = 'GET /api/projects/:projectId';
const OPENED_INTERVAL_MS = 30 * 60_000;

/** Route template of a matched route (`PATCH /api/projects/:projectId/batch`), never the concrete URL. */
export function routeTemplate(req: Request): string {
  const path = (req.route as { path?: unknown } | undefined)?.path;
  return `${req.method} ${typeof path === 'string' ? `${req.baseUrl ?? ''}${path}` : '(unmatched)'}`.slice(0, 96);
}

export function sourceOf(req: Request, mcpTool: string | null): AnalyticsSource {
  if (mcpTool || header(req, 'x-client-id') === 'mcp-server') return 'mcp';
  return /^Bearer\s+\S/i.test(header(req, 'authorization') ?? '') ? 'api' : 'web';
}

/**
 * Captures one `api.request` per HTTP request (audit 04 §4.5), recorded when the
 * response finishes so the final status is known (errors from guards and filters
 * included). Nothing here touches a database:
 *
 * - always recorded: non-GET requests, status >= 400, requests slower than
 *   SLOW_REQUEST_MS, and API-token / MCP calls;
 * - other successful GETs are sampled at ANALYTICS_GET_SAMPLE (`props.sample`);
 * - 304s are only counted per minute and route (`api.not_modified`).
 *
 * Also derives `project.opened` (GET /projects/:id with a 200, never a 304) and the
 * throttled activity touches (users.lastSeenAt, projects.lastOpenedAt).
 */
@Injectable()
export class AnalyticsRequestRecorder {
  private readonly opened = new TouchThrottle(OPENED_INTERVAL_MS);

  constructor(
    private readonly analytics: AnalyticsService,
    private readonly activity: ActivityTouchService,
  ) {}

  /** Request facts known before the auth guard (actor refined by the interceptor). */
  begin(req: Request): RequestAnalytics {
    const mcpTool = mcpToolOf(req.headers['x-mcp-tool']);
    return {
      startedAt: performance.now(),
      source: sourceOf(req, mcpTool),
      mcpTool,
      ipHash: this.analytics.privacy.ipHash(clientIp(req)),
      ua: uaFamily(header(req, 'user-agent')),
      requestId: resolveRequestId(req),
      ...this.actorOf(req),
      resolved: false,
    };
  }

  /** The caller as resolved by the auth guard (or from headers if it never ran). */
  actorOf(req: AnalyticsRequest): AnalyticsActor {
    const user = req.user;
    const shareToken =
      header(req, 'x-share-token') ??
      (typeof req.params?.['token'] === 'string' && /\/shared\//.test(req.path) ? req.params['token'] : null);
    const guest = guestOwnerId(req.headers['x-guest-id']);
    return this.analytics.actorOf({
      userId: user?.id ?? null,
      tokenId: user?.viaToken?.id ?? null,
      shareToken,
      guestId: guest ? guest.slice('guest:'.length) : null,
    });
  }

  finish(req: AnalyticsRequest, res: Response, meta: RequestAnalytics): void {
    if (req.method === 'OPTIONS' || SKIPPED_PATHS.test(req.originalUrl)) return;
    if (!meta.resolved) Object.assign(meta, this.actorOf(req));
    const route = routeTemplate(req);
    const status = res.statusCode;
    const durationMs = performance.now() - meta.startedAt;
    const projectId = req.projectAccess?.projectId ?? null;

    if (meta.actorType === 'user' || meta.actorType === 'token') this.activity.userSeen(meta.actorId!);

    if (status === 304) {
      this.analytics.count({ name: 'api.not_modified', route, status, projectId, request: meta });
      return;
    }

    const read = req.method === 'GET' || req.method === 'HEAD';
    const slow = durationMs >= this.analytics.config.slowRequestMs;
    const always = !read || status >= 400 || slow || meta.source !== 'web';
    const sample = this.analytics.config.getSample;
    if (always || (sample > 0 && Math.random() < sample)) {
      this.analytics.track({
        name: 'api.request',
        props: { method: req.method, sample: always ? 1 : sample, ...(slow ? { slow: true } : {}) },
        route,
        status,
        durationMs,
        projectId,
        request: meta,
      });
    }

    if (route === OPEN_ROUTE && status === 200 && projectId) {
      this.activity.projectOpened(projectId);
      if (this.opened.take(`${meta.actorType}:${meta.actorId ?? meta.ipHash}:${projectId}`)) {
        this.analytics.track({
          name: 'project.opened',
          props: { access: req.projectAccess?.accessLevel },
          projectId,
          request: meta,
        });
      }
    }
  }
}

/**
 * Opens the request's analytics facts on the shared RequestContext (ALS) and
 * records the request when the response finishes. Registered right after
 * RequestContextMiddleware, so the context exists.
 */
@Injectable()
export class AnalyticsMiddleware implements NestMiddleware {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly recorder: AnalyticsRequestRecorder,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    if (!this.analytics.enabled) return next();
    const meta = this.recorder.begin(req);
    const ctx = requestContext();
    if (ctx) ctx.analytics = meta;
    res.once('finish', () => {
      try {
        this.recorder.finish(req, res, meta);
      } catch {
        // analytics must never affect a response
      }
    });
    next();
  }
}

/**
 * Global interceptor: runs after the auth guard, so it pins the resolved actor
 * (user / API token / share / guest, ids hashed) on the request's analytics facts
 * that bus listeners read during the handler.
 */
@Injectable()
export class AnalyticsInterceptor implements NestInterceptor {
  constructor(private readonly recorder: AnalyticsRequestRecorder) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const meta = requestContext()?.analytics;
      if (meta) {
        Object.assign(meta, this.recorder.actorOf(context.switchToHttp().getRequest<AnalyticsRequest>()));
        meta.resolved = true;
      }
    }
    return next.handle();
  }
}
