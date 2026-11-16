import { ErrorHandler } from '@angular/core';
import * as Sentry from '@sentry/angular';
import { environment } from '../../../environments/environment';

const SCRUBBED_HEADERS = ['authorization', 'cookie', 'x-share-token', 'x-guest-id'];

/** Starts Sentry before bootstrap. No-op unless environment.sentryDsn is set; no tracing or replay. */
export function initSentry(): void {
   if (!environment.sentryDsn) return;
   Sentry.init({
      dsn: environment.sentryDsn,
      environment: environment.production ? 'production' : 'development',
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
}

/** Sentry's ErrorHandler when Sentry is configured; Angular's default otherwise. */
export function sentryErrorHandler(): ErrorHandler {
   return environment.sentryDsn ? Sentry.createErrorHandler({ showDialog: false }) : new ErrorHandler();
}
