import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ProjectsStore } from '../../stores/projects.store';
import { EditorComponent } from '../editor/editor.component';
import { ProjectListComponent } from './project-list/project-list.component';

/**
 * Workspace shell (routes: / and /projects/:projectId). A project list that
 * collapses to a slim icon rail, beside the canvas of the selected project.
 * Selection lives in ProjectsStore; the URL mirrors it without re-creating the
 * component.
 */
@Component({
  selector: 'app-workspace',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    EditorComponent,
    ProjectListComponent,
  ],
  templateUrl: './workspace.component.html',
  styleUrl: './workspace.component.scss',
})
export class WorkspaceComponent {
  protected readonly store = inject(ProjectsStore);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);

  protected readonly collapsed = signal(false);

  protected readonly selectedProject = computed(
    () => this.store.projects().find((p) => p.id === this.store.selectedId()) ?? null,
  );

  constructor() {
    const initial = this.route.snapshot.paramMap.get('projectId');
    if (initial) {
      this.store.select(initial);
    }
    void this.store.loadProjects();

    effect(() => {
      const id = this.store.selectedId();
      this.location.replaceState(id ? `/projects/${id}` : '/');
    });
  }

  protected toggleSidebar(): void {
    this.collapsed.update((c) => !c);
  }
}
