import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';

/** Entry of the admin feature: left rail plus the active admin page. */
@Component({
   selector: 'dd-admin-shell',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [IconComponent, RouterLink, RouterLinkActive, RouterOutlet],
   templateUrl: './admin-shell.component.html',
   styleUrl: './admin-shell.component.scss',
})
export class AdminShellComponent {
   private readonly auth = inject(AuthService);

   protected readonly userLabel$ = this.auth.displayLabel;
}
