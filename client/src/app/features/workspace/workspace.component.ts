import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { ProjectsStore } from '../../shared/state/projects/projects.store';
import { EditorComponent } from '../editor';
import { HomeComponent } from './features/home/home.component';
import { SyncBannerComponent } from './components/sync-banner/sync-banner.component';
import { IconComponent } from '../../shared/ui/components/icon/icon.component';
import { CompareDialogComponent, type CompareDialogData } from './features/compare/compare-dialog.component';
import { MatDialog } from '@angular/material/dialog';
import { SyncService } from '../../core/sync/sync.service';
import { runtimeConfig } from '../../core/config/runtime-config';
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
   imports: [EditorComponent, HomeComponent, SyncBannerComponent, IconComponent],
   templateUrl: './workspace.component.html',
   styleUrl: './workspace.component.scss',
})
export class WorkspaceComponent {
   protected readonly store = inject(ProjectsStore);
   private readonly route = inject(ActivatedRoute);
   private readonly location = inject(Location);
   protected readonly overlay = inject(ProjectsOverlayService);
   private readonly dialog = inject(MatDialog);
   private readonly sync = inject(SyncService);
   /** Desktop app: no home page; the projects browser is the start screen. */
   protected readonly desktop = runtimeConfig.desktop;

   protected readonly selectedProject = computed(
      () => this.store.projects().find((p) => p.id === this.store.selectedId()) ?? null
   );

   /** A project is selected but the project list has not loaded yet. */
   protected readonly resolving = computed(
      // loadProjects (called below) flips `loading` on synchronously, so this holds from the first render.
      () => !!this.store.selectedId() && this.store.loading()
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

      if (this.desktop) {
         this.openProjectsWhenIdle();
      }

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

   private openProjectsWhenIdle(): void {
      effect(() => {
         if (!this.store.selectedId() && !this.store.loading()) {
            this.overlay.open();
         }
      });
   }

   /** Conflict: compare this computer's version with the server's (visual diff). */
   protected compareWithServer(projectId: string): void {
      const link = this.sync.links().get(projectId);
      this.dialog.open<CompareDialogComponent, CompareDialogData>(CompareDialogComponent, {
         data: { projectId, serverName: link ? this.sync.remoteName(link.remoteId) : 'the server' },
         width: '96vw',
         maxWidth: '96vw',
         height: '92vh',
         panelClass: 'dd-compare-dialog',
         autoFocus: false,
      });
   }

   protected openProjects(): void {
      this.overlay.open();
   }
}
