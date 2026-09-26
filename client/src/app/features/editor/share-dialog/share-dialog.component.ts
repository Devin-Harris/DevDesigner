import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import type { ShareAccessLevel, ShareLinkResponse } from '@dbdesigner/shared';
import { ShareLinksService } from '../../../core/services/share-links.service';

export interface ShareDialogData {
  projectId: string;
}

/**
 * Owner sharing dialog (BUILD_INSTRUCTIONS.md section 8.2): create VIEW/EDIT share
 * links, list the active ones with copy-to-clipboard of the full /shared/:token
 * URL, and revoke them. All calls go through ShareLinksService; access is enforced
 * server-side (owner only).
 */
@Component({
  selector: 'app-share-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  templateUrl: './share-dialog.component.html',
  styleUrl: './share-dialog.component.scss',
})
export class ShareDialogComponent {
  private readonly links = inject(ShareLinksService);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly data = inject<ShareDialogData>(MAT_DIALOG_DATA);

  protected readonly items = signal<ShareLinkResponse[]>([]);
  protected readonly loading = signal(true);
  protected readonly creating = signal(false);
  protected readonly newLevel = signal<ShareAccessLevel>('EDIT');

  constructor() {
    void this.refresh();
  }

  protected setLevel(level: ShareAccessLevel): void {
    this.newLevel.set(level);
  }

  private async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      const links = await firstValueFrom(this.links.list(this.data.projectId));
      this.items.set(links);
    } catch {
      this.snackBar.open('Could not load share links.', undefined, { duration: 3000 });
    } finally {
      this.loading.set(false);
    }
  }

  protected async create(): Promise<void> {
    this.creating.set(true);
    try {
      const link = await firstValueFrom(
        this.links.create(this.data.projectId, { accessLevel: this.newLevel() }),
      );
      this.items.update((list) => [link, ...list]);
    } catch {
      this.snackBar.open('Could not create the link.', undefined, { duration: 3000 });
    } finally {
      this.creating.set(false);
    }
  }

  protected async revoke(link: ShareLinkResponse): Promise<void> {
    try {
      await firstValueFrom(this.links.revoke(this.data.projectId, link.id));
      this.items.update((list) => list.filter((l) => l.id !== link.id));
    } catch {
      this.snackBar.open('Could not revoke the link.', undefined, { duration: 3000 });
    }
  }

  protected async copy(link: ShareLinkResponse): Promise<void> {
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
