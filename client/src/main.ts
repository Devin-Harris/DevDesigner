import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { initSentry } from './app/core/telemetry/sentry';

initSentry();

bootstrapApplication(AppComponent, appConfig).catch((err) => {
   // eslint-disable-next-line no-console
   console.error(err);
});
