import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, throwError } from 'rxjs';
import { AdminApiService } from '../../services/admin-api.service';
import { ADMIN_FIXTURES, fakeAdminApi } from '../../testing/admin-fixtures';
import type { AdminRequest, AdminResource } from '../../models/admin.models';
import { needsFetch } from './features/admin-methods.feature';
import { AdminStore } from './admin.store';

let hosts = 0;

/** A page that keeps `resources` connected for as long as it lives. */
function host(...resources: AdminResource[]) {
   @Component({ selector: `dd-test-host-${++hosts}`, template: '' })
   class HostComponent {
      readonly store = inject(AdminStore);
      constructor() {
         resources.forEach((r) => this.store.connect(r));
      }
   }
   return HostComponent;
}

function setup(api = fakeAdminApi()) {
   TestBed.configureTestingModule({ providers: [AdminStore, { provide: AdminApiService, useValue: api }] });
   const store = TestBed.inject(AdminStore);
   const keys = (): string[] => api.fetch.mock.calls.map(([r]) => (r as AdminRequest).key);
   return { store, api, keys };
}

describe('AdminStore', () => {
   it('loads a connected resource and exposes it as a view', () => {
      const { store } = setup();
      TestBed.createComponent(host('overview'));
      TestBed.tick();
      expect(store.overviewView()).toEqual({
         value: ADMIN_FIXTURES.overview,
         loading: false,
         error: null,
         stale: false,
      });
   });

   it('refetches only the resources that depend on a changed filter', () => {
      const { store, keys } = setup();
      TestBed.createComponent(host('overview', 'storage'));
      TestBed.tick();
      store.setRange('90d');
      TestBed.tick();
      expect(keys()).toEqual(['overview?range=30d', 'storage', 'overview?range=90d']);
   });

   it('serves a fresh cached entry when a page reconnects, and reloads on demand', () => {
      const { store, keys } = setup();
      TestBed.createComponent(host('storage')).destroy();
      TestBed.createComponent(host('storage'));
      TestBed.tick();
      expect(keys()).toEqual(['storage']);
      store.reload('storage');
      expect(keys()).toEqual(['storage', 'storage']);
   });

   it('keeps showing the previous response, flagged stale, while new params load', () => {
      const pending = new Subject<unknown>();
      const { store } = setup(fakeAdminApi((r) => (r.key === 'overview?range=7d' ? pending : undefined)));
      TestBed.createComponent(host('overview'));
      TestBed.tick();
      store.setRange('7d');
      TestBed.tick();
      expect(store.overviewView()).toMatchObject({ value: ADMIN_FIXTURES.overview, loading: true, stale: true });
      pending.next({ ...ADMIN_FIXTURES.overview, range: '7d' });
      expect(store.overviewView()).toMatchObject({ loading: false, stale: false, value: { range: '7d' } });
   });

   it('records a readable error and retries it on the next load', () => {
      const failing = fakeAdminApi(() => throwError(() => new HttpErrorResponse({ status: 503 })));
      const { store } = setup(failing);
      TestBed.createComponent(host('errors'));
      TestBed.tick();
      expect(store.errorsView()).toMatchObject({ value: null, loading: false, error: 'Request failed (503).' });
      store.reload('errors');
      expect(failing.fetch).toHaveBeenCalledTimes(2);
   });

   it('flips the sort direction on the sorted column and goes back to page 1', () => {
      const { store } = setup();
      store.updateUsers({ page: 3 });
      store.sortUsers('createdAt');
      expect(store.users()).toMatchObject({ sort: 'createdAt', dir: 'asc', page: 1 });
      store.sortUsers('projects');
      expect(store.users()).toMatchObject({ sort: 'projects', dir: 'desc' });
      store.updateUsers({ page: 2 });
      expect(store.users().page).toBe(2);
      store.updateUsers({ q: 'ada' });
      expect(store.users()).toMatchObject({ q: 'ada', page: 1 });
   });

   it('pages events with a cursor stack and resets it on a new filter', () => {
      const { store } = setup();
      store.olderEvents(70);
      store.olderEvents(20);
      expect(store.hasNewerEvents()).toBe(true);
      store.newerEvents();
      expect(store.events().cursors).toEqual([70]);
      store.filterEvents('api.request');
      expect(store.events()).toEqual({ name: 'api.request', cursors: [] });
   });
});

describe('needsFetch', () => {
   const entry = (patch: object) => ({ value: {}, loading: false, error: null, loadedAt: 1_000, ...patch });

   it.each([
      ['missing', undefined, false, true],
      ['loading', entry({ loading: true }), true, false],
      ['fresh', entry({}), false, false],
      ['forced', entry({}), true, true],
      ['failed', entry({ error: 'x' }), false, true],
      ['expired', entry({ loadedAt: -60_000 }), false, true],
   ])('%s entry', (_label, value, force, expected) => {
      expect(needsFetch(value, force, 2_000)).toBe(expected);
   });
});
