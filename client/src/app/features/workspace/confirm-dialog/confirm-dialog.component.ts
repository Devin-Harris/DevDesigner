import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { A11yModule } from '@angular/cdk/a11y';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';

export interface ConfirmDialogData {
   title: string;
   message: string;
   confirmLabel?: string;
}

/** Generic confirm/cancel dialog. Closes with true when confirmed. */
@Component({
   selector: 'app-confirm-dialog',
   standalone: true,
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [MatDialogModule, A11yModule],
   templateUrl: './confirm-dialog.component.html',
   styleUrl: './confirm-dialog.component.scss',
})
export class ConfirmDialogComponent {
   protected readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
}
