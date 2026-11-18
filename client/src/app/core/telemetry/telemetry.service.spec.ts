import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, type ActivatedRouteSnapshot } from '@angular/router';
import { runtimeConfig } from '../config/runtime-config';
import { clientRouteOf, routeTemplateOf } from './route-template.helper';
import { TELEMETRY_FLUSH_MS, TelemetryService } from './telemetry.service';

@Component({ selector: 'dd-test-page', template: '' })
class PageComponent {}

describe('route templates', () => {
   const node = (path: string | undefined, child: ActivatedRouteSnapshot | null = null) =>
      ({ routeConfig: path === undefined ? null : { path }, firstChild: child }) as unknown as ActivatedRouteSnapshot;

   it('joins config paths along the active branch, never the URL', () => {
      expect(routeTemplateOf(node(undefined, node('projects/:projectId')))).toBe('/projects/:projectId');
      expect(routeTemplateOf(node(undefined, node('admin', node('', node('users/:userId')))))).toBe(
         '/admin/users/:userId'
      );
      expect(routeTemplateOf(node(undefined, node('')))).toBe('/');
   });

   it.each([
      ['/', '/'],
      ['/shared/:token', '/shared/:token'],
      ['/admin/users/:userId', '/admin'],
      ['/somewhere', 'other'],
   ])('%s counts as %s', (template, expected) => {
      expect(clientRouteOf(template)).toBe(expected);
   });
});

describe('TelemetryService', () => {
   const sendBeacon = jest.fn(() => true);
   const original = runtimeConfig.telemetry;

   function setup(enabled = true) {
      runtimeConfig.telemetry = enabled;
      Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: sendBeacon });
      TestBed.configureTestingModule({
         providers: [
            provideRouter([
               { path: '', component: PageComponent },
               { path: 'projects/:projectId', component: PageComponent },
            ]),
         ],
      });
      return TestBed.inject(TelemetryService);
   }

   const sent = (call = 0): Promise<unknown> =>
      new Promise((resolve) => {
         const reader = new FileReader();
         reader.onload = () => resolve(JSON.parse(String(reader.result)));
         reader.readAsText((sendBeacon.mock.calls[call] as unknown[])[1] as Blob);
      });

   beforeEach(() => {
      sendBeacon.mockClear();
      jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
   });

   afterEach(() => {
      TestBed.inject(TelemetryService).stop();
      jest.useRealTimers();
      runtimeConfig.telemetry = original;
   });

   it('drops undeclared props and unknown names, then beacons text/plain JSON', async () => {
      const telemetry = setup();
      telemetry.track('client.export_image', { format: 'png', scope: 'slide', text: 'secret' } as never);
      telemetry.track('auth.login' as never);
      telemetry.flush();
      expect(sendBeacon).toHaveBeenCalledTimes(1);
      const [url, blob] = sendBeacon.mock.calls[0] as unknown as [string, Blob];
      expect(url).toBe(`${runtimeConfig.apiBaseUrl}/telemetry`);
      expect(blob.type).toBe('text/plain');
      expect(await sent()).toEqual({
         events: [{ name: 'client.export_image', props: { format: 'png', scope: 'slide' } }],
      });
   });

   it('flushes at 20 events, on a timer and when the tab is hidden', () => {
      const telemetry = setup();
      telemetry.start();
      for (let i = 0; i < 20; i++) telemetry.track('client.laser', { action: 'on' });
      expect(sendBeacon).toHaveBeenCalledTimes(1);
      telemetry.track('client.laser', { action: 'off' });
      jest.advanceTimersByTime(TELEMETRY_FLUSH_MS);
      expect(sendBeacon).toHaveBeenCalledTimes(2);
      telemetry.track('client.laser', { action: 'on' });
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(sendBeacon).toHaveBeenCalledTimes(3);
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
   });

   it('sends a page view with the route template, not the project id', async () => {
      const telemetry = setup();
      telemetry.start();
      await TestBed.inject(Router).navigateByUrl('/projects/0b7d6c5e-secret');
      telemetry.flush();
      expect(await sent()).toEqual({ events: [{ name: 'client.pageview', props: { route: '/projects/:projectId' } }] });
   });

   it('does nothing when telemetry is off', () => {
      const telemetry = setup(false);
      telemetry.start();
      telemetry.track('client.laser', { action: 'on' });
      telemetry.flush();
      expect(sendBeacon).not.toHaveBeenCalled();
   });
});
