import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ProjectsStore } from '../../stores/projects.store';
import { EditorComponent } from '../editor/editor.component';
import { HomeComponent } from '../home/home.component';
import { ProjectsOverlayService } from './projects-overlay/projects-overlay.service';

/**
 * Workspace shell (routes: / and /projects/:projectId). Full-width canvas of the
 * selected project; the projects browser now lives in a breadcrumb-triggered
 * overlay rather than a persistent left panel. Selection lives in ProjectsStore;
 * the URL mirrors it without re-creating the component. When nothing is selected,
 * the landing page (HomeComponent) shows instead.
 */
@Component({
   selector: 'app-workspace',
   standalone: true,
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [EditorComponent, HomeComponent],
   templateUrl: './workspace.component.html',
   styleUrl: './workspace.component.scss',
})
export class WorkspaceComponent {
   protected readonly store = inject(ProjectsStore);
   private readonly route = inject(ActivatedRoute);
   private readonly location = inject(Location);
   protected readonly overlay = inject(ProjectsOverlayService);

   protected readonly selectedProject = computed(
      () => this.store.projects().find((p) => p.id === this.store.selectedId()) ?? null
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

   protected openProjects(): void {
      this.overlay.open();
   }
}
