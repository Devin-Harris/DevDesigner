import { ErrorHandler } from '@angular/core';
import { runtimeConfig } from '../config/runtime-config';

const SCRUBBED_HEADERS = ['authorization', 'cookie', 'x-share-token', 'x-guest-id'];

type SentryModule = typeof import('@sentry/angular');

/** The SDK is loaded on demand so it stays out of the initial bundle (and isn't fetched at all without a DSN). */
let sentry: Promise<SentryModule> | null = null;

/** Starts Sentry before bootstrap. No-op unless runtimeConfig.sentryDsn is set; no tracing or replay. */
export function initSentry(): void {
   if (!runtimeConfig.sentryDsn) return;
   sentry = import('@sentry/angular').then((Sentry) => {
      Sentry.init({
         dsn: runtimeConfig.sentryDsn,
         environment: runtimeConfig.production ? 'production' : 'development',
         // v11's replacement for sendDefaultPii: false (no user info, cookies, bodies or credential headers).
         dataCollection: {
            userInfo: false,
            cookies: false,
            httpBodies: [],
            httpHeaders: { request: { deny: SCRUBBED_HEADERS }, response: { deny: ['set-cookie'] } },
         },
         tracesSampleRate: 0,
         beforeSend(event) {
            const headers = event.request?.headers;
            if (headers) {
               for (const name of Object.keys(headers)) {
                  if (SCRUBBED_HEADERS.includes(name.toLowerCase())) delete headers[name];
               }
            }
            if (event.request) delete event.request.cookies;
            return event;
         },
      });
      return Sentry;
   });
}

/** Logs like Angular's default, then forwards to Sentry once its SDK has loaded. */
class LazySentryErrorHandler extends ErrorHandler {
   private handler: ErrorHandler | null = null;

   constructor(loaded: Promise<SentryModule>) {
      super();
      loaded
         .then((Sentry) => (this.handler = Sentry.createErrorHandler({ showDialog: false })))
         .catch(() => undefined);
   }

   override handleError(error: unknown): void {
      if (this.handler) this.handler.handleError(error);
      else {
         super.handleError(error);
         void sentry?.then((Sentry) => Sentry.captureException(error)).catch(() => undefined);
      }
   }
}

/** Sentry's ErrorHandler when Sentry is configured; Angular's default otherwise. */
export function sentryErrorHandler(): ErrorHandler {
   return sentry ? new LazySentryErrorHandler(sentry) : new ErrorHandler();
}
