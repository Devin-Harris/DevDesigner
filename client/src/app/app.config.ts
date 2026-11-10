import { ApplicationConfig, inject, provideAppInitializer, provideZonelessChangeDetection } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { withCredentialsInterceptor } from './core/interceptors/with-credentials.interceptor';
import { shareTokenInterceptor } from './core/interceptors/share-token.interceptor';
import { sandboxInterceptor } from './core/sandbox/sandbox.interceptor';
import { provideSentry } from './core/sentry';
import { FontMetricsService } from './features/editor/services/font-metrics.service';

/**
 * Application providers. Zoneless change detection is the default in Angular 22,
 * so there is no zone.js polyfill (see angular.json). HttpClient is used for all
 * API calls; the share-token and auth interceptors (core/interceptors) are
 * registered here as they land.
 */
export const appConfig: ApplicationConfig = {
   providers: [
      provideZonelessChangeDetection(),
      provideRouter(routes),
      provideAnimationsAsync(),
      provideHttpClient(withInterceptors([sandboxInterceptor, withCredentialsInterceptor, shareTokenInterceptor])),
      ...provideSentry(),
      // Listens for web fonts from the start, so text measured early is re-measured once they load.
      provideAppInitializer(() => void inject(FontMetricsService)),
   ],
};
