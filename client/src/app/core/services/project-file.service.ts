import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { ProjectExportFile } from '@devdesigner/shared';
import { downloadText } from '../../features/editor/export/image-export.helper';
import { ProjectsStore } from '../../stores/projects.store';

/**
 * Saves a project to a portable `.devdesigner.json` file (re-importable on any
 * account/device from the Projects overlay). Shared by the top-bar Export menu
 * and the project card menu so both behave identically.
 */
@Injectable({ providedIn: 'root' })
export class ProjectFileService {
  private readonly store = inject(ProjectsStore);
  private readonly snackBar = inject(MatSnackBar);

  /** Save an already-built export file (e.g. a selection) under `<name>.devdesigner.json`. */
  save(file: ProjectExportFile, name: string): void {
    const safe = name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'project';
    downloadText(JSON.stringify(file, null, 2), `${safe}.devdesigner.json`, 'application/json');
  }

  async download(projectId: string, projectName: string): Promise<void> {
    try {
      const file = await this.store.exportProject(projectId);
      this.save(file, projectName);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Could not export project', err);
      this.snackBar.open('Could not export project', 'Dismiss', { duration: 5000 });
    }
  }
}
