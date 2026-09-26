import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ThemeService } from './core/services/theme.service';
import { AuthService } from './core/services/auth.service';
import { ProjectsStore } from './stores/projects.store';
import { AuthDialogComponent } from './features/auth/auth-dialog.component';

/** Application shell: top toolbar (brand, account, theme toggle) plus the routed view. */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatToolbarModule,
    MatTooltipModule,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  protected readonly theme = inject(ThemeService);
  protected readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly projects = inject(ProjectsStore);

  constructor() {
    // Hydrate the session from the cookie so the toolbar reflects who is signed in.
    void this.auth.loadMe();
  }

  protected openAuth(): void {
    const ref = this.dialog.open(AuthDialogComponent, { width: '420px', maxWidth: '92vw' });
    ref.afterClosed().subscribe((signedIn) => {
      if (signedIn) {
        this.refreshForIdentity();
      }
    });
  }

  protected async signOut(): Promise<void> {
    await this.auth.logout();
    this.refreshForIdentity();
  }

  /**
   * After an identity change, drop the current selection (it may belong to the
   * previous identity) and reload the owner-scoped project list.
   */
  private refreshForIdentity(): void {
    this.projects.select(null);
    this.projects.loadProjects();
  }
}
