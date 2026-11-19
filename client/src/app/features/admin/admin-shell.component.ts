import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { IconComponent } from '../../shared/ui/components/icon/icon.component';
import { LogoComponent } from '../../shared/ui/components/logo/logo.component';

interface RailLink {
   path: string;
   label: string;
   icon: string;
   exact: boolean;
}

const LINKS: readonly RailLink[] = [
   { path: '.', label: 'Overview', icon: 'grid_view', exact: true },
   { path: 'usage', label: 'Usage', icon: 'timeline', exact: false },
   { path: 'users', label: 'Users', icon: 'account_circle', exact: false },
   { path: 'projects', label: 'Projects', icon: 'table_chart', exact: false },
   { path: 'storage', label: 'Storage', icon: 'data_object', exact: false },
   { path: 'api', label: 'API & MCP', icon: 'key', exact: false },
   { path: 'errors', label: 'Errors', icon: 'warning', exact: false },
   { path: 'realtime', label: 'Realtime', icon: 'share', exact: false },
   { path: 'events', label: 'Events', icon: 'notes', exact: false },
];

/** Entry of the admin feature: left rail (top bar under 720px) plus the active admin page. */
@Component({
   selector: 'dd-admin-shell',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [IconComponent, LogoComponent, RouterLink, RouterLinkActive, RouterOutlet],
   templateUrl: './admin-shell.component.html',
   styleUrl: './admin-shell.component.scss',
})
export class AdminShellComponent {
   private readonly auth = inject(AuthService);

   protected readonly links = LINKS;
   protected readonly userLabel$ = this.auth.displayLabel;
}
