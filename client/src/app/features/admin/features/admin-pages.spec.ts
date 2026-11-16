import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AdminApiService } from '../services/admin-api.service';
import { AdminStore } from '../state/admin/admin.store';
import { fakeAdminApi } from '../testing/admin-fixtures';
import { ApiTokensComponent } from './api-tokens/api-tokens.component';
import { ErrorsComponent } from './errors/errors.component';
import { EventsComponent } from './events/events.component';
import { OverviewComponent } from './overview/overview.component';
import { ProjectsComponent } from './projects/projects.component';
import { RealtimeComponent } from './realtime/realtime.component';
import { StorageComponent } from './storage/storage.component';
import { UsageComponent } from './usage/usage.component';
import { UserDetailComponent } from './user-detail/user-detail.component';
import { UsersComponent } from './users/users.component';

/** Every admin page renders its data from the store (API answered from fixtures). */
describe('admin pages', () => {
   function renderPage(page: Type<unknown>) {
      const api = fakeAdminApi();
      TestBed.configureTestingModule({
         providers: [
            provideRouter([]),
            AdminStore,
            { provide: AdminApiService, useValue: api },
            { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ userId: 'u1' })) } },
         ],
      });
      const fixture = TestBed.createComponent(page);
      TestBed.tick();
      fixture.detectChanges();
      return { el: fixture.nativeElement as HTMLElement, api };
   }

   it.each([
      ['overview', OverviewComponent, ['Overview', 'Active users', 'Weekly retention', '50%']],
      ['usage', UsageComponent, ['Writes by kind', 'Element created', '50% of users', 'PNG']],
      ['users', UsersComponent, ['ada@example.com', '4.0 KB']],
      ['user detail', UserDetailComponent, ['Ada', 'Schema', 'Table created']],
      ['projects', ProjectsComponent, ['Schema', 'Guest', '2.1 KB']],
      ['storage', StorageComponent, ['App database', 'Largest projects', 'image/png']],
      ['api tokens', ApiTokensComponent, ['add_table', 'ada@example.com', 'p95 40 ms']],
      ['errors', ErrorsComponent, ['POST /api/projects/import', 'GET /api/projects/:projectId', '0.30%']],
      ['realtime', RealtimeComponent, ['Schema', 'Open rooms', '1.0 min']],
      ['events', EventsComponent, ['api.request', 'GET /api/projects']],
   ] as const)('%s', (_name, page, texts) => {
      const { el } = renderPage(page);
      for (const text of texts) expect(el.textContent).toContain(text);
      expect(el.querySelector('.page-notice.is-error')).toBeNull();
   });

   it('the user detail page loads the user from the route', () => {
      const { api } = renderPage(UserDetailComponent);
      expect(api.fetch).toHaveBeenCalledWith(expect.objectContaining({ key: 'users/u1' }));
   });
});
