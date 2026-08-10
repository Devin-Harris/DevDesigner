import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';

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
    provideHttpClient(withInterceptorsFromDi()),
  ],
};
