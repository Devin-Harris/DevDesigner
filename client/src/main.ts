import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { initSentry } from './app/core/telemetry/sentry';
import { TelemetryService } from './app/core/telemetry/telemetry.service';
import { DesktopShellService } from './app/core/desktop/desktop-shell.service';

initSentry();

bootstrapApplication(AppComponent, appConfig)
   // Page views (route templates only); a no-op unless environment.telemetry is true.
   .then((app) => {
      app.injector.get(TelemetryService).start();
      // Desktop app: file opens, devdesigner:// links and menu commands (no-op on the web).
      app.injector.get(DesktopShellService).start();
   })
   .catch((err) => {
      console.error(err);
   });
