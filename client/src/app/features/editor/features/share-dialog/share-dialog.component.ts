import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import type { ShareAccessLevel, ShareLinkResponse } from '@devdesigner/shared';
import { ShareLinksApiService } from '../../services/share-links-api.service';
import { IconComponent } from '../../../../shared/ui/components/icon/icon.component';
import {
   SegmentedComponent,
   type SegmentedOption,
} from '../../../../shared/ui/components/segmented/segmented.component';

export interface ShareDialogData {
   projectId: string;
}

/**
 * Owner sharing dialog (BUILD_INSTRUCTIONS.md section 8.2): create VIEW/EDIT share
 * links, list the active ones with copy-to-clipboard of the full /shared/:token
 * URL, and revoke them. All calls go through ShareLinksApiService; access is enforced
 * server-side (owner only).
 */
@Component({
   selector: 'dd-share-dialog',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [ReactiveFormsModule, MatDialogModule, MatProgressSpinnerModule, MatTooltipModule, IconComponent, SegmentedComponent],
   templateUrl: './share-dialog.component.html',
   styleUrl: './share-dialog.component.scss',
})
export class ShareDialogComponent {
   private readonly links = inject(ShareLinksApiService);
   private readonly snackBar = inject(MatSnackBar);
   protected readonly data = inject<ShareDialogData>(MAT_DIALOG_DATA);

   protected readonly items$ = signal<ShareLinkResponse[]>([]);
   protected readonly loading$ = signal(true);
   protected readonly creating$ = signal(false);
   /** Access level for the next link. */
   protected readonly newLevel = new FormControl<ShareAccessLevel>('EDIT', { nonNullable: true });
   protected readonly levelOptions: SegmentedOption[] = [
      { value: 'EDIT', label: 'Can edit' },
      { value: 'VIEW', label: 'Can view' },
   ];

   constructor() {
      void this.refresh();
   }

   private async refresh(): Promise<void> {
      this.loading$.set(true);
      try {
         const links = await firstValueFrom(this.links.list(this.data.projectId));
         this.items$.set(links);
      } catch {
         this.snackBar.open('Could not load share links.', undefined, { duration: 3000 });
      } finally {
         this.loading$.set(false);
      }
   }

   protected async create(): Promise<void> {
      this.creating$.set(true);
      try {
         const link = await firstValueFrom(
            this.links.create(this.data.projectId, { accessLevel: this.newLevel.value })
         );
         this.items$.update((list) => [link, ...list]);
      } catch {
         this.snackBar.open('Could not create the link.', undefined, { duration: 3000 });
      } finally {
         this.creating$.set(false);
      }
   }

   protected async revoke(link: ShareLinkResponse): Promise<void> {
      try {
         await firstValueFrom(this.links.revoke(this.data.projectId, link.id));
         this.items$.update((list) => list.filter((l) => l.id !== link.id));
      } catch {
         this.snackBar.open('Could not revoke the link.', undefined, { duration: 3000 });
      }
   }

   protected async copy(link: ShareLinkResponse): Promise<void> {
      if (!link.url) return;
      try {
         await navigator.clipboard.writeText(link.url);
         this.snackBar.open('Link copied to clipboard', undefined, { duration: 2000 });
      } catch {
         this.snackBar.open('Copy failed. Select the link and copy manually.', undefined, {
            duration: 3000,
         });
      }
   }
}
