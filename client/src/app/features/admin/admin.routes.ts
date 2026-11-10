import { Routes } from '@angular/router';
import { AdminShellComponent } from './admin-shell.component';

export const ADMIN_ROUTES: Routes = [
   {
      path: '',
      component: AdminShellComponent,
      title: 'Admin · DevDesigner',
      children: [
         {
            path: '',
            loadComponent: () => import('./features/overview/overview.component').then((m) => m.OverviewComponent),
         },
      ],
   },
];
