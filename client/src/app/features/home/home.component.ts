import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { PopoverTriggerDirective } from '../../shared/ui/popover/popover-trigger.directive';
import { ThemeService } from '../../core/services/theme.service';
import { AuthService } from '../../core/services/auth.service';
import { ProjectsStore } from '../../stores/projects.store';
import { ProjectsOverlayService } from '../workspace/projects-overlay/projects-overlay.service';
import { AuthDialogComponent } from '../auth/auth-dialog.component';
import { ApiTokensDialogComponent } from '../auth/api-tokens-dialog.component';

interface Feature {
  icon: string;
  tone: string;
  title: string;
  body: string;
}

/**
 * Landing page shown at `/` when no project is open: what DevDesigner is, quick
 * ways to start, and the user's most recent projects.
 */
@Component({
  selector: 'app-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, PopoverTriggerDirective, DatePipe, RouterLink],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent {
  protected readonly theme = inject(ThemeService);
  protected readonly auth = inject(AuthService);
  protected readonly projects = inject(ProjectsStore);
  private readonly overlay = inject(ProjectsOverlayService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  /** Six most recently updated projects. */
  protected readonly recent = computed(() =>
    [...this.projects.projects()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 6),
  );

  protected readonly features: Feature[] = [
    { icon: 'crop_square', tone: 'amber', title: 'Whiteboard & architecture', body: 'Shapes, arrows that stay bound to what they connect, freehand pen and rich text.' },
    { icon: 'timeline', tone: 'teal', title: 'Sequence diagrams', body: 'Participants and messages that respace themselves as the flow grows.' },
    { icon: 'code', tone: 'violet', title: 'Code that reads like an IDE', body: 'Syntax-highlighted blocks, file names, formatting and side-by-side or inline diffs.' },
    { icon: 'table_chart', tone: 'blue', title: 'Data models', body: 'Tables with types, keys and indexes. Import CREATE TABLE SQL, export it back out.' },
    { icon: 'image', tone: 'slate', title: 'Grids, images & video', body: 'Spreadsheet-style grids with merged cells, plus media you can crop and clip.' },
    { icon: 'slideshow', tone: 'red', title: 'Decks from the board', body: 'Any number of presentations per project, with layouts, themes, animations and morph.' },
  ];

  protected readonly uses = [
    { title: 'Design reviews', body: 'Proposal, diagrams and the diff in one place.' },
    { title: 'Onboarding', body: 'A living map of the system new people can click through.' },
    { title: 'Incident walkthroughs', body: 'Replay the request path step by step with the laser.' },
    { title: 'Talks & demos', body: 'Morphing slides built from the same board you designed on.' },
  ];

  protected open(id: string): void {
    this.projects.select(id);
  }

  protected openProjects(): void {
    this.overlay.open();
  }

  protected async newCanvas(): Promise<void> {
    try {
      const created = await this.projects.create({ name: 'Untitled' });
      this.projects.select(created.id);
    } catch (err) {
      console.error('Could not create project', err);
      this.snackBar.open('Could not create project', 'Dismiss', { duration: 4000 });
    }
  }

  protected openAuth(): void {
    this.dialog
      .open(AuthDialogComponent, { width: '420px', maxWidth: '92vw' })
      .afterClosed()
      .subscribe((signedIn) => {
        if (signedIn) this.projects.loadProjects();
      });
  }

  protected openApiTokens(): void {
    if (!this.auth.currentUser()) {
      this.openAuth();
      return;
    }
    this.dialog.open(ApiTokensDialogComponent, { width: '560px', maxWidth: '94vw' });
  }

  protected async signOut(): Promise<void> {
    await this.auth.logout();
    this.projects.select(null);
    this.projects.loadProjects();
  }
}
