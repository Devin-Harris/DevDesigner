import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { SyncService } from '../../../../core/sync/sync.service';
import { IconComponent } from '../../../../shared/ui/components/icon/icon.component';
import {
   ConfirmDialogComponent,
   type ConfirmDialogData,
} from '../../../../shared/ui/components/confirm-dialog/confirm-dialog.component';

/**
 * Desktop: the state of the open project when it lives on a server and is not simply
 * live: offline (editing locally), changed in both places (choose a version), or an
 * error. Hidden while live.
 */
@Component({
   selector: 'dd-sync-banner',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [IconComponent],
   templateUrl: './sync-banner.component.html',
   styleUrl: './sync-banner.component.scss',
})
export class SyncBannerComponent {
   protected readonly sync = inject(SyncService);
   private readonly dialog = inject(MatDialog);

   readonly projectId = input.required<string>();
   /** Open the side-by-side comparison of the two versions. */
   readonly compare = output<void>();

   protected readonly link = computed(() => this.sync.links().get(this.projectId()) ?? null);
   protected readonly server = computed(() => {
      const link = this.link();
      return link ? this.sync.remoteName(link.remoteId) : '';
   });
   protected readonly busy = signal(false);
   protected readonly error = signal<string | null>(null);

   protected async retry(): Promise<void> {
      await this.run(() => this.sync.syncNow(this.projectId()));
   }

   protected async turnOn(): Promise<void> {
      await this.run(() => this.sync.setAutoSync(this.projectId(), true));
   }

   protected async useServer(): Promise<void> {
      if (
         !(await this.confirm(
            'Use the server version?',
            `Your offline changes on this computer are discarded and the project becomes the version on ${this.server()}.`,
            'Use server version'
         ))
      )
         return;
      await this.run(() => this.sync.resolve(this.projectId(), 'server'));
   }

   protected async keepMine(): Promise<void> {
      if (
         !(await this.confirm(
            'Keep your version?',
            `The changes made on ${this.server()} while you were offline are replaced by the version on this computer.`,
            'Keep mine'
         ))
      )
         return;
      await this.run(() => this.sync.resolve(this.projectId(), 'mine'));
   }

   private confirm(title: string, message: string, confirmLabel: string): Promise<boolean> {
      const ref = this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, {
         data: { title, message, confirmLabel },
      });
      return firstValueFrom(ref.afterClosed()).then((ok) => ok === true);
   }

   private async run(work: () => Promise<unknown>): Promise<void> {
      this.busy.set(true);
      this.error.set(null);
      try {
         await work();
      } catch (err) {
         this.error.set(
            err instanceof HttpErrorResponse ? (err.error?.message ?? err.message) : (err as Error).message
         );
      } finally {
         this.busy.set(false);
      }
   }
}
