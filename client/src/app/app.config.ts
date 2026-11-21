import { ApplicationConfig, inject, provideAppInitializer, provideZonelessChangeDetection } from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { withCredentialsInterceptor } from './core/http/interceptors/with-credentials.interceptor';
import { shareTokenInterceptor } from './core/http/interceptors/share-token.interceptor';
import { sandboxInterceptor } from './core/sandbox/sandbox.interceptor';
import { provideErrorTelemetry } from './core/telemetry/error-telemetry';
import { FontMetricsService } from './features/editor/services/font-metrics.service';
import { EditorProjectPictureRenderer } from './features/editor/services/editor-project-picture-renderer.service';
import { ProjectPictureRenderer } from './shared/features/projects-overlay/services/project-picture-renderer';
import { CodeBlockSizer } from './core/sandbox/code-block-sizer';
import { EditorCodeBlockSizer } from './features/editor/services/editor-code-block-sizer.service';

/**
 * Application providers. Zoneless change detection is the default in Angular 22,
 * so there is no zone.js polyfill (see angular.json). HttpClient is used for all
 * API calls; the share-token and auth interceptors (core/interceptors) are
 * registered here as they land.
 */
export const appConfig: ApplicationConfig = {
   providers: [
      // Project thumbnails are drawn by the editor's renderer (shared/ only knows the abstraction).
      { provide: ProjectPictureRenderer, useExisting: EditorProjectPictureRenderer },
      // The sandbox (guide/home examples) sizes code blocks with the editor's measurement.
      { provide: CodeBlockSizer, useExisting: EditorCodeBlockSizer },
      provideZonelessChangeDetection(),
      provideRouter(routes),
      provideAnimationsAsync(),
      provideHttpClient(withInterceptors([sandboxInterceptor, withCredentialsInterceptor, shareTokenInterceptor])),
      provideErrorTelemetry(),
      // Listens for web fonts from the start, so text measured early is re-measured once they load.
      provideAppInitializer(() => void inject(FontMetricsService)),
   ],
};
