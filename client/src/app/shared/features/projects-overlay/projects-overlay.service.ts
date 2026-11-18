import { inject, Injectable } from '@angular/core';
import { MatDialog, type MatDialogRef } from '@angular/material/dialog';

/** Opens the projects browser overlay (from the breadcrumb or the empty state),
 *  de-duplicating so only one instance is ever open. The component (and its
 *  thumbnail renderer) is loaded on first open to keep it out of the initial bundle. */
@Injectable({ providedIn: 'root' })
export class ProjectsOverlayService {
   private readonly dialog = inject(MatDialog);
   private ref: MatDialogRef<unknown> | null = null;
   private opening = false;

   async open(): Promise<void> {
      if (this.ref || this.opening) return;
      this.opening = true;
      try {
         const { ProjectsOverlayComponent } = await import('./projects-overlay.component');
         this.ref = this.dialog.open(ProjectsOverlayComponent, {
            panelClass: 'dd-projects-dialog',
            width: '640px',
            maxWidth: '94vw',
            autoFocus: false,
            restoreFocus: false,
         });
         this.ref.afterClosed().subscribe(() => (this.ref = null));
      } finally {
         this.opening = false;
      }
   }

   get isOpen(): boolean {
      return !!this.ref || this.opening;
   }
}
