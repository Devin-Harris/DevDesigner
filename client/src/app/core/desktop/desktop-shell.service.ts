import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ProjectsStore } from '../../shared/state/projects/projects.store';
import { ProjectFileService } from '../../shared/services/project-file.service';
import { runtimeConfig } from '../config/runtime-config';

/** Messages the Electron main process sends the page (see desktop/src/main.ts). */
export type DesktopMessage =
   | { type: 'open-file'; name: string; text: string }
   | { type: 'open-project'; projectId: string }
   | { type: 'export-project' };

interface DesktopEvents {
   onMessage(listener: (message: DesktopMessage) => void): void;
   ready(): void;
}

/**
 * Desktop app glue: File > Open / double-clicked `.devdesigner` files, `devdesigner://`
 * links and File > Export arrive from the main process and run through the same
 * store / file services the in-app buttons use. Inert on the web.
 */
@Injectable({ providedIn: 'root' })
export class DesktopShellService {
   private readonly store = inject(ProjectsStore);
   private readonly projectFile = inject(ProjectFileService);
   private readonly snackBar = inject(MatSnackBar);

   start(): void {
      const events = (globalThis as { devdesigner?: { events?: DesktopEvents } }).devdesigner?.events;
      if (!runtimeConfig.desktop || !events) return;
      events.onMessage((message) => void this.handle(message));
      // Anything queued before the page loaded (e.g. the file the app was launched with) comes now.
      events.ready();
   }

   private async handle(message: DesktopMessage): Promise<void> {
      switch (message.type) {
         case 'open-file':
            return this.openFile(message.name, message.text);
         case 'open-project':
            await this.store.loadProjects();
            if (this.store.projects().some((p) => p.id === message.projectId)) {
               this.store.select(message.projectId);
            } else {
               this.snackBar.open('That project is not on this computer.', 'Dismiss', { duration: 5000 });
            }
            return;
         case 'export-project': {
            const project = this.store.selected();
            if (!project) {
               this.snackBar.open('Open a project to export it.', 'Dismiss', { duration: 4000 });
               return;
            }
            return this.projectFile.download(project.id, project.name);
         }
      }
   }

   private async openFile(name: string, text: string): Promise<void> {
      try {
         const created = await this.store.importProject(JSON.parse(text));
         this.store.select(created.id);
         this.snackBar.open(`Opened "${created.name}" from ${name}`, undefined, { duration: 3000 });
      } catch (err) {
         console.error('Could not open project file', err);
         this.snackBar.open(`Could not open ${name}: it is not a DevDesigner project file.`, 'Dismiss', {
            duration: 6000,
         });
      }
   }
}
