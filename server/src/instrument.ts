import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import * as Sentry from '@sentry/nestjs';

/**
 * Sentry bootstrap; imported first in main.ts so its instrumentation patches
 * modules before they load. Runs before ConfigModule, so SENTRY_* are also read
 * from a local .env here. A no-op unless SENTRY_DSN is set.
 */
function sentryEnv(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  try {
    return parseEnv(readFileSync(resolve(process.cwd(), '.env'), 'utf8'))[key];
  } catch {
    return undefined;
  }
}

const SCRUBBED_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-share-token', 'x-guest-id'];

const dsn = sentryEnv('SENTRY_DSN');
if (dsn) {
  const rate = Number(sentryEnv('SENTRY_TRACES_SAMPLE_RATE') ?? 0);
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    // v11's replacement for sendDefaultPii: false (no user info, cookies, bodies or credential headers).
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpBodies: [],
      httpHeaders: { request: { deny: SCRUBBED_HEADERS }, response: { deny: ['set-cookie'] } },
    },
    tracesSampleRate: Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 0,
    beforeSend(event) {
      const request = event.request;
      if (request) {
        delete request.cookies;
        delete request.data;
        if (request.headers) {
          for (const name of Object.keys(request.headers)) {
            if (SCRUBBED_HEADERS.includes(name.toLowerCase())) delete request.headers[name];
          }
        }
      }
      return event;
    },
  });
}
