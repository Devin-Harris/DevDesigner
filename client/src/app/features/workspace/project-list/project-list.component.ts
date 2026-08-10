import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { ProjectSummary } from '@dbdesigner/shared';
import { AutofocusDirective } from '../../../core/directives/autofocus.directive';
import { ProjectsStore } from '../../../stores/projects.store';
import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from '../confirm-dialog/confirm-dialog.component';

/**
 * The project list in the workspace sidebar: a slim inline search, an add
 * button (creates a project and drops straight into inline rename), inline
 * rename, and per-project actions. Selection is written to the shared store.
 */
@Component({
  selector: 'app-project-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    FormsModule,
    AutofocusDirective,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    MatSnackBarModule,
    MatTooltipModule,
  ],
  templateUrl: './project-list.component.html',
  styleUrl: './project-list.component.scss',
})
export class ProjectListComponent {
  protected readonly store = inject(ProjectsStore);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly editingId = signal<string | null>(null);
  protected readonly editName = signal('');

  protected onSearch(event: Event): void {
    this.store.setSearch((event.target as HTMLInputElement).value);
  }

  protected select(project: ProjectSummary): void {
    this.store.select(project.id);
  }

  /** Create a project and immediately open its name for inline editing. */
  protected async addProject(): Promise<void> {
    try {
      const created = await this.store.create({ name: 'Untitled' });
      this.store.select(created.id);
      this.startRename(created);
    } catch (err) {
      this.notifyError('Could not add project', err);
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
    if (this.editingId() !== project.id) {
      return;
    }
    const name = this.editName().trim();
    this.editingId.set(null);
    if (!name || name === project.name) {
      return;
    }
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
        if (!confirmed) {
          return;
        }
        try {
          await this.store.remove(project.id);
          this.notify('Project deleted');
        } catch (err) {
          this.notifyError('Could not delete project', err);
        }
      });
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
