import type { IncomingMessage } from 'node:http';
import { RequestMethod } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Params } from 'nestjs-pino';
import { resolveRequestId } from './request-context';

/** Share tokens also appear in the path of GET /api/shared/:token. */
const scrubUrl = (url: string | undefined): string | undefined =>
  url?.replace(/(\/shared\/)[^/?#]+/, '$1[redacted]');

/**
 * nestjs-pino options: JSON in production, pino-pretty in dev. Credentials are
 * redacted and request/response bodies are never logged.
 */
export function loggerParams(config: ConfigService): Params {
  const prod = config.get<string>('NODE_ENV') === 'production';
  return {
    // Express 5 / path-to-regexp 8 syntax for "every route" (the default '*' is legacy).
    forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
    pinoHttp: {
      level: config.get<string>('LOG_LEVEL', prod ? 'info' : 'debug'),
      genReqId: (req) => resolveRequestId(req),
      customProps: (req) => ({
        userId: (req as IncomingMessage & { user?: { id?: string } | null }).user?.id,
        share: typeof req.headers['x-share-token'] === 'string' || undefined,
      }),
      autoLogging: {
        ignore: (req: IncomingMessage) => req.url?.startsWith('/api/health') ?? false,
      },
      serializers: {
        req: (req: { id: unknown; method: string; url: string; remoteAddress?: string }) => ({
          id: req.id,
          method: req.method,
          url: scrubUrl(req.url),
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-share-token"]',
          'req.headers["x-guest-id"]',
          'res.headers["set-cookie"]',
          '*.token',
          '*.password',
          '*.accessToken',
          '*.access_token',
          '*.secret',
        ],
        censor: '[redacted]',
      },
      transport: prod
        ? undefined
        : {
            target: 'pino-pretty',
            options: { singleLine: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
          },
    },
  };
}
