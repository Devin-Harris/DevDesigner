import { Routes } from '@angular/router';
import { AdminShellComponent } from './admin-shell.component';
import { AdminStore } from './state/admin/admin.store';

/** Admin pages, each its own lazy chunk inside the (already lazy) admin area. */
export const ADMIN_ROUTES: Routes = [
   {
      path: '',
      component: AdminShellComponent,
      providers: [AdminStore],
      title: 'Admin · DevDesigner',
      children: [
         {
            path: '',
            pathMatch: 'full',
            title: 'Overview · Admin',
            loadComponent: () => import('./features/overview/overview.component').then((m) => m.OverviewComponent),
         },
         {
            path: 'usage',
            title: 'Usage · Admin',
            loadComponent: () => import('./features/usage/usage.component').then((m) => m.UsageComponent),
         },
         {
            path: 'users',
            title: 'Users · Admin',
            loadComponent: () => import('./features/users/users.component').then((m) => m.UsersComponent),
         },
         {
            path: 'users/:userId',
            title: 'User · Admin',
            loadComponent: () =>
               import('./features/user-detail/user-detail.component').then((m) => m.UserDetailComponent),
         },
         {
            path: 'projects',
            title: 'Projects · Admin',
            loadComponent: () => import('./features/projects/projects.component').then((m) => m.ProjectsComponent),
         },
         {
            path: 'storage',
            title: 'Storage · Admin',
            loadComponent: () => import('./features/storage/storage.component').then((m) => m.StorageComponent),
         },
         {
            path: 'api',
            title: 'API and MCP · Admin',
            loadComponent: () => import('./features/api-tokens/api-tokens.component').then((m) => m.ApiTokensComponent),
         },
         {
            path: 'errors',
            title: 'Errors · Admin',
            loadComponent: () => import('./features/errors/errors.component').then((m) => m.ErrorsComponent),
         },
         {
            path: 'realtime',
            title: 'Realtime · Admin',
            loadComponent: () => import('./features/realtime/realtime.component').then((m) => m.RealtimeComponent),
         },
         {
            path: 'events',
            title: 'Events · Admin',
            loadComponent: () => import('./features/events/events.component').then((m) => m.EventsComponent),
         },
         { path: '**', redirectTo: '' },
      ],
   },
];
