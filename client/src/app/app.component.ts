import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ThemeService } from './core/services/theme.service';
import { AuthService } from './core/services/auth.service';
import { EditorActionsService } from './core/services/editor-actions.service';
import { ProjectFileService } from './core/services/project-file.service';
import { RealtimeService } from './core/services/realtime.service';
import { ProjectsStore } from './stores/projects.store';
import { ProjectStore } from './stores/project.store';
import { AuthDialogComponent } from './features/auth/auth-dialog.component';
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
  protected exportProjectFile(): void {
    const id = this.editorStore.projectId();
    if (id) {
      void this.projectFile.download(id, this.projects.selected()?.name ?? 'project');
    }
  }
  protected share(): void {
    this.editorActions.share();
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

  private refreshForIdentity(): void {
    this.projects.select(null);
    this.projects.loadProjects();
  }
}
