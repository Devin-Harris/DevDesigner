import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ThemeService } from './core/services/theme.service';
import { AuthService } from './core/services/auth.service';
import { EditorActionsService } from './core/services/editor-actions.service';
import { ProjectsService } from './core/services/projects.service';
import { ProjectFileService } from './core/services/project-file.service';
import { RealtimeService } from './core/services/realtime.service';
import { ProjectsStore } from './stores/projects.store';
import { ProjectStore } from './stores/project.store';
import { AuthDialogComponent } from './features/auth/auth-dialog.component';
import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from './features/workspace/confirm-dialog/confirm-dialog.component';
import { ApiTokensDialogComponent } from './features/auth/api-tokens-dialog.component';
import { ProjectsOverlayService } from './features/workspace/projects-overlay/projects-overlay.service';
import { IconComponent } from './shared/ui/icon/icon.component';
import { PopoverTriggerDirective } from './shared/ui/popover/popover-trigger.directive';
import type { ExportImageFormat } from './features/editor/canvas/models/toolbar-actions';

/**
 * Application shell: a single unified top bar (brand, breadcrumb → projects
 * overlay, and — while an editor is mounted — undo/redo, Export, Share and
 * presence avatars, plus account + theme) over the routed view.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, MatToolbarModule, MatTooltipModule, IconComponent, PopoverTriggerDirective],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  protected readonly theme = inject(ThemeService);
  protected readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  protected readonly projects = inject(ProjectsStore);
  protected readonly editorStore = inject(ProjectStore);
  protected readonly editorActions = inject(EditorActionsService);
  protected readonly realtime = inject(RealtimeService);
  private readonly overlay = inject(ProjectsOverlayService);
  private readonly projectFile = inject(ProjectFileService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly projectsApi = inject(ProjectsService);

  constructor() {
    void this.auth.loadMe();
  }

  protected openProjects(): void {
    this.overlay.open();
  }

  // ---- editor actions bridged to the top bar ----
  protected undo(): void {
    this.editorStore.undoElement();
  }
  protected redo(): void {
    this.editorStore.redoElement();
  }
  protected exportSql(): void {
    this.editorActions.exportSql();
  }
  protected exportImage(format: ExportImageFormat): void {
    this.editorActions.exportImage(format);
  }
  protected exportFramesPdf(): void {
    this.editorActions.exportFramesPdf();
  }
  protected exportSlidesPdf(): void {
    this.editorActions.exportSlidesPdf();
  }
  protected exportProjectFile(): void {
    const id = this.editorStore.projectId();
    if (id) {
      void this.projectFile.download(id, this.projects.selected()?.name ?? 'project');
    }
  }
  /** Merge a chosen `.dbdesigner.json` file into the open project. */
  protected async importProjectFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file
    if (!file) return;
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new Error('That file is not valid JSON.');
      }
      const count = await this.editorActions.importFile(parsed);
      this.snackBar.open(`Imported ${count} item${count === 1 ? '' : 's'}`, undefined, {
        duration: 2500,
      });
    } catch (err) {
      const detail = err instanceof HttpErrorResponse ? err.error?.message : (err as Error).message;
      // eslint-disable-next-line no-console
      console.error('Could not import file', err);
      this.snackBar.open(`Could not import file${detail ? `: ${detail}` : ''}`, 'Dismiss', {
        duration: 5000,
      });
    }
  }
  protected exportSelectionFile(): void {
    this.editorActions.exportSelectionFile();
  }
  protected share(): void {
    this.editorActions.share();
  }

  protected openAuth(): void {
    const ref = this.dialog.open(AuthDialogComponent, { width: '420px', maxWidth: '92vw' });
    ref.afterClosed().subscribe(async (signedIn) => {
      if (signedIn) {
        await this.offerGuestProjectClaim();
        this.refreshForIdentity();
      }
    });
  }

  /** After sign-in, offer to move this browser's guest projects into the account. */
  private async offerGuestProjectClaim(): Promise<void> {
    try {
      const { count } = await firstValueFrom(this.projectsApi.guestCount());
      if (count === 0) {
        return;
      }
      const plural = count === 1 ? 'project' : 'projects';
      const data: ConfirmDialogData = {
        title: 'Move guest projects?',
        message:
          `You have ${count} ${plural} made in this browser without an account. ` +
          `Move ${count === 1 ? 'it' : 'them'} into your account? If you don't, ` +
          `${count === 1 ? 'it stays' : 'they stay'} available here only while signed out.`,
        confirmLabel: `Move ${plural}`,
      };
      const confirmed = await firstValueFrom(
        this.dialog.open(ConfirmDialogComponent, { data, width: '420px' }).afterClosed(),
      );
      if (!confirmed) {
        return;
      }
      const moved = await firstValueFrom(this.projectsApi.claimGuest());
      this.snackBar.open(
        `Moved ${moved.count} ${moved.count === 1 ? 'project' : 'projects'} to your account`,
        undefined,
        { duration: 3000 },
      );
    } catch (err) {
      console.error('Could not move guest projects', err);
      this.snackBar.open('Could not move guest projects', 'Dismiss', { duration: 5000 });
    }
  }

  protected openApiTokens(): void {
    this.dialog.open(ApiTokensDialogComponent, { width: '560px', maxWidth: '94vw' });
  }

  protected async signOut(): Promise<void> {
    await this.auth.logout();
    this.refreshForIdentity();
  }

  private refreshForIdentity(): void {
    this.projects.select(null);
    this.projects.loadProjects();
  }
}
