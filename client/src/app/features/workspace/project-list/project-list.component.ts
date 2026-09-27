import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PROJECT_TYPES, type ProjectSummary, type ProjectType } from '@dbdesigner/shared';
import { AutofocusDirective } from '../../../core/directives/autofocus.directive';
import { ProjectsStore, type ProjectTypeFilter } from '../../../stores/projects.store';
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

  /** Type filter chips: All plus one per project type. */
  protected readonly typeFilters: readonly ProjectTypeFilter[] = ['ALL', ...PROJECT_TYPES];

  /** Human label for a project type (or the All filter). */
  protected typeLabel(type: ProjectTypeFilter): string {
    switch (type) {
      case 'ALL':
        return 'All';
      case 'FLOW':
        return 'Flow';
      case 'SCRATCH':
        return 'Scratch';
      default:
        return 'ERD';
    }
  }

  /** Card thumbnail accents — a stable, tasteful color per project (hashed from id). */
  private static readonly ACCENTS = [
    '#6f8bff',
    '#34d0c0',
    '#f0b45e',
    '#e06b8b',
    '#8b7bff',
    '#7ac98a',
  ];

  /** Deterministic accent for a project's thumbnail, so a card keeps its color. */
  protected accent(id: string): string {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    }
    return ProjectListComponent.ACCENTS[hash % ProjectListComponent.ACCENTS.length];
  }

  protected onSearch(event: Event): void {
    this.store.setSearch((event.target as HTMLInputElement).value);
  }

  protected select(project: ProjectSummary): void {
    this.store.select(project.id);
  }

  /** Create a project and immediately open its name for inline editing. */
  protected async addProject(): Promise<void> {
    try {
      // New projects inherit the active type filter (so filtering to Flow and
      // pressing New makes a Flow project); 'ALL' falls back to the ERD default.
      const filter = this.store.typeFilter();
      const type: ProjectType | undefined = filter === 'ALL' ? undefined : filter;
      const created = await this.store.create({ name: 'Untitled', type });
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
