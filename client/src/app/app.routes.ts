import { Routes } from '@angular/router';
import { adminGuard } from './core/guards/admin.guard';

/**
 * Top-level routes (BUILD_INSTRUCTIONS.md section 8). The workspace shell hosts
 * both the empty state (/) and a selected project (/projects/:projectId) so the
 * collapsible project list persists across selection. The shared-link entry
 * route reuses the editor in shared mode.
 */
export const routes: Routes = [
   {
      path: '',
      loadComponent: () => import('./features/workspace/workspace.component').then((m) => m.WorkspaceComponent),
   },
   {
      path: 'projects/:projectId',
      loadComponent: () => import('./features/workspace/workspace.component').then((m) => m.WorkspaceComponent),
   },
   {
      path: 'guide',
      redirectTo: 'guide/select',
      pathMatch: 'full',
   },
   {
      path: 'guide/:tool',
      loadComponent: () => import('./features/guide/guide.component').then((m) => m.GuideComponent),
   },
   {
      path: 'shared/:token',
      loadComponent: () => import('./features/share/share.component').then((m) => m.ShareComponent),
   },
   {
      // canMatch keeps non-admins from even downloading the chunk (they fall through to **).
      path: 'admin',
      canMatch: [adminGuard],
      canActivate: [adminGuard],
      loadChildren: () => import('./features/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
   },
   { path: '**', redirectTo: '' },
];
