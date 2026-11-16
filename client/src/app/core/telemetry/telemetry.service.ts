import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import {
   TELEMETRY_MAX_BODY_BYTES,
   TELEMETRY_MAX_EVENTS,
   isClientAnalyticsEventName,
   sanitizeAnalyticsProps,
   type AnalyticsProps,
   type ClientAnalyticsEventName,
   type TelemetryBatch,
   type TelemetryEventInput,
} from '@devdesigner/shared';
import { environment } from '../../../environments/environment';
import { clientRouteOf, routeTemplateOf } from './route-template.helper';
import { classifyError } from './error-kind.helper';

/** Buffered events are sent at least this often. */
export const TELEMETRY_FLUSH_MS = 15_000;

/**
 * First-party client beacon (audit 04 §4.5 / §6.3): `track()` checks the name and
 * props against the shared catalog (only `client.*` events, only declared enum,
 * number and boolean props), buffers them, and sends `{ events }` as text/plain JSON
 * with `navigator.sendBeacon` every 15 s, at 20 events, and when the tab is hidden.
 * No cookies or storage of its own. Off unless `environment.telemetry` is true.
 */
@Injectable({ providedIn: 'root' })
export class TelemetryService {
   private readonly document = inject(DOCUMENT);
   private readonly router = inject(Router);
   private readonly destroyRef = inject(DestroyRef);
   private readonly url = `${environment.apiBaseUrl}/telemetry`;
   private buffer: TelemetryEventInput[] = [];
   private timer: ReturnType<typeof setInterval> | null = null;
   private started = false;

   /** Telemetry is configured on and the browser can send beacons. */
   get enabled(): boolean {
      const nav = this.document.defaultView?.navigator;
      return environment.telemetry === true && typeof nav?.sendBeacon === 'function';
   }

   /** Begin page views (route templates) and the flush triggers. Safe to call more than once. */
   start(): void {
      if (this.started || !this.enabled) return;
      this.started = true;
      this.router.events
         .pipe(
            filter((e): e is NavigationEnd => e instanceof NavigationEnd),
            takeUntilDestroyed(this.destroyRef)
         )
         .subscribe(() => {
            this.track('client.pageview', {
               route: clientRouteOf(routeTemplateOf(this.router.routerState.snapshot.root)),
            });
         });
      this.document.addEventListener('visibilitychange', () => {
         if (this.document.visibilityState === 'hidden') this.flush();
      });
      // Errors outside Angular (the ErrorHandler counts the rest): kind only, never the message.
      const win = this.document.defaultView;
      win?.addEventListener('error', (e) => this.track('client.error', { kind: classifyError(e.error) }));
      win?.addEventListener('unhandledrejection', (e) =>
         this.track('client.error', { kind: classifyError(e.reason, 'unhandled_rejection') })
      );
      this.timer = setInterval(() => this.flush(), TELEMETRY_FLUSH_MS);
   }

   track<N extends ClientAnalyticsEventName>(name: N, props?: AnalyticsProps<N>): void {
      if (!this.enabled || !isClientAnalyticsEventName(name)) return;
      const clean = sanitizeAnalyticsProps(name, props);
      if (!clean) return;
      this.buffer.push(Object.keys(clean).length > 0 ? { name, props: clean } : { name });
      if (this.buffer.length >= TELEMETRY_MAX_EVENTS) this.flush();
   }

   /** Send everything buffered now (in batches within the server's event and byte limits). */
   flush(): void {
      const nav = this.document.defaultView?.navigator;
      if (!nav?.sendBeacon) {
         this.buffer = [];
         return;
      }
      while (this.buffer.length > 0) {
         const batch = this.buffer.splice(0, TELEMETRY_MAX_EVENTS);
         let body = JSON.stringify({ events: batch } satisfies TelemetryBatch);
         while (body.length > TELEMETRY_MAX_BODY_BYTES && batch.length > 1) {
            this.buffer.unshift(...batch.splice(Math.ceil(batch.length / 2)));
            body = JSON.stringify({ events: batch } satisfies TelemetryBatch);
         }
         nav.sendBeacon(this.url, new Blob([body], { type: 'text/plain' }));
      }
   }

   /** Tests: stop the flush timer. */
   stop(): void {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
   }
}
