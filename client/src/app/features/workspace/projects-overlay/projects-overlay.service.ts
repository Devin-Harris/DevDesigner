import { inject, Injectable } from '@angular/core';
import { MatDialog, type MatDialogRef } from '@angular/material/dialog';
import { ProjectsOverlayComponent } from './projects-overlay.component';

/** Opens the projects browser overlay (from the breadcrumb or the empty state),
 *  de-duplicating so only one instance is ever open. */
@Injectable({ providedIn: 'root' })
export class ProjectsOverlayService {
  private readonly dialog = inject(MatDialog);
  private ref: MatDialogRef<ProjectsOverlayComponent> | null = null;

  open(): void {
    if (this.ref) return;
    this.ref = this.dialog.open(ProjectsOverlayComponent, {
      panelClass: 'dd-projects-dialog',
      width: '640px',
      maxWidth: '94vw',
      autoFocus: false,
      restoreFocus: false,
    });
    this.ref.afterClosed().subscribe(() => (this.ref = null));
  }

  get isOpen(): boolean {
    return !!this.ref;
  }
}
