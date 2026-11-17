import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ProjectsStore } from '../../shared/state/projects/projects.store';
import { EditorComponent } from '../editor';
import { HomeComponent } from './features/home/home.component';
import { ProjectsOverlayService } from '../../shared/features/projects-overlay/projects-overlay.service';

/**
 * Workspace shell (routes: / and /projects/:projectId). Full-width canvas of the
 * selected project; the projects browser now lives in a breadcrumb-triggered
 * overlay rather than a persistent left panel. Selection lives in ProjectsStore;
 * the URL mirrors it without re-creating the component. When nothing is selected,
 * the landing page (HomeComponent) shows instead.
 */
const LAST_PROJECT_KEY = 'dd.lastProjectId';

function readLastProject(): string | null {
   try {
      return localStorage.getItem(LAST_PROJECT_KEY);
   } catch {
      return null;
   }
}

function writeLastProject(id: string | null): void {
   try {
      if (id) {
         localStorage.setItem(LAST_PROJECT_KEY, id);
      } else {
         localStorage.removeItem(LAST_PROJECT_KEY);
      }
   } catch {
      // Storage unavailable (private mode): nothing to remember.
   }
}

@Component({
   selector: 'dd-workspace',
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
      // A bare "/" reopens the project the user was last viewing.
      const initial = this.route.snapshot.paramMap.get('projectId') ?? readLastProject();
      if (initial) {
         this.store.select(initial);
      }
      void this.store.loadProjects();

      effect(() => {
         const id = this.store.selectedId();
         this.location.replaceState(id ? `/projects/${id}` : '/');
         writeLastProject(id);
      });

      // A remembered project that no longer exists (deleted, access revoked) falls back home.
      effect(() => {
         const id = this.store.selectedId();
         if (id && !this.store.loading() && this.store.projects().length && !this.selectedProject()) {
            if (id === readLastProject() && id !== this.route.snapshot.paramMap.get('projectId')) {
               this.store.select(null);
            }
         }
      });
   }

   protected openProjects(): void {
      this.overlay.open();
   }
}
