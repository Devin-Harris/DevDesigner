import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { ProjectSummary } from '@dbdesigner/shared';
import { AutofocusDirective } from '../../../core/directives/autofocus.directive';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { InputComponent } from '../../../shared/ui/input/input.component';
import { PopoverTriggerDirective } from '../../../shared/ui/popover/popover-trigger.directive';
import { ToggleComponent } from '../../../shared/ui/toggle/toggle.component';
import { ProjectsStore } from '../../../stores/projects.store';
import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from '../confirm-dialog/confirm-dialog.component';
import { PROJECT_TEMPLATES, type ProjectTemplate } from '../templates/project-templates';
import { TemplatesService } from '../templates/templates.service';

type OverlayView = 'projects' | 'templates';

/**
 * The full-screen projects browser, opened from the breadcrumb (or the empty
 * state) as a Material dialog. Replaces the old left sidebar panel. Hosts two
 * views: the project grid (search / new / cards / show-archived) and the
 * templates gallery. Selecting or creating a project closes the overlay so the
 * editor takes over. No type-filter pills (removed by request).
 */
@Component({
  selector: 'app-projects-overlay',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    AutofocusDirective,
    IconComponent,
    InputComponent,
    ToggleComponent,
    PopoverTriggerDirective,
  ],
  templateUrl: './projects-overlay.component.html',
  styleUrl: './projects-overlay.component.scss',
})
export class ProjectsOverlayComponent {
  protected readonly store = inject(ProjectsStore);
  private readonly templates = inject(TemplatesService);
  private readonly dialog = inject(MatDialog);
  private readonly dialogRef = inject(MatDialogRef<ProjectsOverlayComponent>);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly view = signal<OverlayView>('projects');
  protected readonly editingId = signal<string | null>(null);
  protected readonly editName = signal('');
  protected readonly busy = signal(false);
  protected readonly templateDefs: ProjectTemplate[] = PROJECT_TEMPLATES;

  /** Deterministic accent per project so a card keeps its thumbnail color. */
  private static readonly ACCENTS = ['#6f8bff', '#34d0c0', '#f0b45e', '#e06b8b', '#8b7bff', '#7ac98a'];
  protected accent(id: string): string {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    return ProjectsOverlayComponent.ACCENTS[hash % ProjectsOverlayComponent.ACCENTS.length];
  }

  /** "Edited 3h ago" style relative time from an ISO timestamp. */
  protected edited(iso: string): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const s = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (s < 60) return 'Edited just now';
    const m = Math.round(s / 60);
    if (m < 60) return `Edited ${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `Edited ${h}h ago`;
    const d = Math.round(h / 24);
    if (d < 30) return `Edited ${d}d ago`;
    return `Edited ${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  }

  protected setSearch(value: string | number): void {
    this.store.setSearch(String(value));
  }

  protected select(project: ProjectSummary): void {
    if (this.editingId() === project.id) return;
    this.store.select(project.id);
    this.dialogRef.close();
  }

  /** Create a blank project (the server assigns the default type). */
  protected async addProject(): Promise<void> {
    try {
      const created = await this.store.create({ name: 'Untitled' });
      this.store.select(created.id);
      this.dialogRef.close();
    } catch (err) {
      this.notifyError('Could not add project', err);
    }
  }

  protected async useTemplate(template: ProjectTemplate): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.templates.createFromTemplate(template);
      this.dialogRef.close();
    } catch (err) {
      this.notifyError('Could not create from template', err);
    } finally {
      this.busy.set(false);
    }
  }

  protected startRename(project: ProjectSummary): void {
    this.editingId.set(project.id);
    this.editName.set(project.name);
  }
  protected cancelRename(): void {
    this.editingId.set(null);
  }
  protected async commitRename(project: ProjectSummary): Promise<void> {
    if (this.editingId() !== project.id) return;
    const name = this.editName().trim();
    this.editingId.set(null);
    if (!name || name === project.name) return;
    try {
      await this.store.rename(project.id, { name });
    } catch (err) {
      this.notifyError('Could not rename project', err);
    }
  }

  protected async duplicate(project: ProjectSummary): Promise<void> {
    try {
      await this.store.duplicate(project.id);
      this.notify('Project duplicated');
    } catch (err) {
      this.notifyError('Could not duplicate project', err);
    }
  }

  protected async toggleArchive(project: ProjectSummary): Promise<void> {
    try {
      await this.store.setArchived(project.id, !project.archived);
      this.notify(project.archived ? 'Project unarchived' : 'Project archived');
    } catch (err) {
      this.notifyError('Could not update project', err);
    }
  }

  protected remove(project: ProjectSummary): void {
    const data: ConfirmDialogData = {
      title: 'Delete project',
      message: `Delete "${project.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
    };
    this.dialog
      .open(ConfirmDialogComponent, { data, width: '420px' })
      .afterClosed()
      .subscribe(async (confirmed) => {
        if (!confirmed) return;
        try {
          await this.store.remove(project.id);
          this.notify('Project deleted');
        } catch (err) {
          this.notifyError('Could not delete project', err);
        }
      });
  }

  protected close(): void {
    this.dialogRef.close();
  }

  private notify(message: string): void {
    this.snackBar.open(message, undefined, { duration: 2500 });
  }
  private notifyError(message: string, err: unknown): void {
    // eslint-disable-next-line no-console
    console.error(message, err);
    this.snackBar.open(message, 'Dismiss', { duration: 5000 });
  }
}
