import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import type { ProjectSummary, SyncRemoteResponse } from '@devdesigner/shared';
import { SyncService } from '../../../../../core/sync/sync.service';
import { IconComponent } from '../../../../ui/components/icon/icon.component';
import { InputComponent } from '../../../../ui/components/input/input.component';

/**
 * Desktop "Sync" view of the projects browser: the remote servers this install
 * syncs with (added with an API token made on that server) and, per remote, its
 * projects that can be downloaded and kept in sync.
 */
@Component({
   selector: 'dd-sync-panel',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [ReactiveFormsModule, IconComponent, InputComponent],
   templateUrl: './sync-panel.component.html',
   styleUrl: './sync-panel.component.scss',
})
export class SyncPanelComponent {
   protected readonly sync = inject(SyncService);
   /** A remote project was downloaded: open it (local id). */
   readonly opened = output<string>();

   protected readonly adding = signal(false);
   protected readonly busy = signal(false);
   protected readonly error = signal<string | null>(null);
   protected readonly form = new FormGroup({
      name: new FormControl('', { nonNullable: true }),
      url: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
      token: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
   });
   /** Token for the built-in hosted server (only the token is needed). */
   protected readonly cloudForm = new FormGroup({
      token: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
   });

   /** Remote id whose project list is shown. */
   protected readonly browsing = signal<string | null>(null);
   protected readonly remoteProjects = signal<ProjectSummary[] | null>(null);

   constructor() {
      void this.sync.refresh();
   }

   protected async addRemote(): Promise<void> {
      if (this.form.invalid || this.busy()) return;
      await this.run(async () => {
         await this.sync.addRemote(this.form.getRawValue());
         this.form.reset();
         this.adding.set(false);
      });
   }

   protected async connectCloud(): Promise<void> {
      const cloud = this.sync.defaultRemote();
      if (!cloud || this.cloudForm.invalid || this.busy()) return;
      await this.run(async () => {
         await this.sync.addRemote({ name: cloud.name, url: cloud.url, token: this.cloudForm.getRawValue().token });
         this.cloudForm.reset();
      });
   }

   protected async removeRemote(remote: SyncRemoteResponse): Promise<void> {
      await this.run(() => this.sync.removeRemote(remote.id));
      if (this.browsing() === remote.id) this.browsing.set(null);
   }

   protected async browse(remote: SyncRemoteResponse): Promise<void> {
      if (this.browsing() === remote.id) {
         this.browsing.set(null);
         return;
      }
      this.browsing.set(remote.id);
      this.remoteProjects.set(null);
      await this.run(async () => this.remoteProjects.set(await this.sync.remoteProjects(remote.id)));
   }

   /** Server projects already on this computer (same project id on both). */
   protected isLinked(remoteId: string, remoteProjectId: string): boolean {
      return this.sync.links().get(remoteProjectId)?.remoteId === remoteId;
   }

   protected async download(remoteId: string, project: ProjectSummary): Promise<void> {
      await this.run(async () => this.opened.emit(await this.sync.clone(remoteId, project.id)));
   }

   private async run(work: () => Promise<void>): Promise<void> {
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
