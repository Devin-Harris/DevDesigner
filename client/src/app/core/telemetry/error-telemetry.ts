import { ErrorHandler, inject, Injector, type Provider } from '@angular/core';
import { classifyError } from './error-kind.helper';
import { sentryErrorHandler } from './sentry';
import { TelemetryService } from './telemetry.service';

/** Counts each error Angular reports as `client.error`, then hands it to Sentry / the default handler. */
export class TelemetryErrorHandler extends ErrorHandler {
   constructor(
      // Resolved per error, not at construction: the ErrorHandler is created before the router.
      private readonly injector: Injector,
      private readonly inner: ErrorHandler
   ) {
      super();
   }

   override handleError(error: unknown): void {
      try {
         this.injector.get(TelemetryService).track('client.error', { kind: classifyError(error) });
      } catch {
         /* telemetry must never mask the original error */
      }
      this.inner.handleError(error);
   }
}

/** The app's ErrorHandler: `client.error` counts, then Sentry (when configured) or Angular's default. */
export function provideErrorTelemetry(): Provider {
   return {
      provide: ErrorHandler,
      useFactory: () => new TelemetryErrorHandler(inject(Injector), sentryErrorHandler()),
   };
}
