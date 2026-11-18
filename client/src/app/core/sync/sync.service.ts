import { computed, DestroyRef, Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
   AddSyncRemoteDto,
   ProjectExportFile,
   ProjectSummary,
   SyncDefaultRemoteResponse,
   SyncLinkResponse,
   SyncLinkResult,
   SyncRemoteResponse,
} from '@devdesigner/shared';
import { ApiClientService } from '../http/api-client.service';
import { runtimeConfig } from '../config/runtime-config';

/** How often link states (live / offline / conflict) are re-read while the app is open. */
const POLL_MS = 5_000;

/**
 * Desktop server-backed projects: the servers this install uses and which projects
 * live on one. The local server forwards edits, relays changes and reconnects on its
 * own; this reads its state for the UI and drives the user's choices. Inert on the web.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
   private readonly api = inject(ApiClientService);

   readonly enabled = runtimeConfig.desktop;
   readonly remotes = signal<SyncRemoteResponse[]>([]);
   /** The hosted server this build offers ready-made (null when the build has none). */
   readonly defaultRemote = signal<SyncDefaultRemoteResponse | null>(null);
   private readonly linkList = signal<SyncLinkResponse[]>([]);
   readonly links = computed(() => new Map(this.linkList().map((l) => [l.projectId, l])));
   private timer: ReturnType<typeof setInterval> | null = null;

   constructor() {
      if (!this.enabled) return;
      void this.refresh().catch(() => undefined);
      this.timer = setInterval(() => void this.refresh().catch(() => undefined), POLL_MS);
      inject(DestroyRef).onDestroy(() => {
         if (this.timer) clearInterval(this.timer);
      });
   }

   async refresh(): Promise<void> {
      if (!this.enabled) return;
      const [remotes, links, defaultRemote] = await Promise.all([
         firstValueFrom(this.api.get<SyncRemoteResponse[]>('/sync/remotes')),
         firstValueFrom(this.api.get<SyncLinkResponse[]>('/sync/links')),
         firstValueFrom(this.api.get<SyncDefaultRemoteResponse | null>('/sync/default-remote')),
      ]);
      this.remotes.set(remotes);
      this.defaultRemote.set(defaultRemote);
      this.linkList.set(links);
   }

   remoteName(remoteId: string): string {
      return this.remotes().find((r) => r.id === remoteId)?.name ?? 'the server';
   }

   async addRemote(dto: AddSyncRemoteDto): Promise<void> {
      await firstValueFrom(this.api.post<SyncRemoteResponse>('/sync/remotes', dto));
      await this.refresh();
   }

   async removeRemote(remoteId: string): Promise<void> {
      await firstValueFrom(this.api.delete<void>(`/sync/remotes/${remoteId}`));
      await this.refresh();
   }

   remoteProjects(remoteId: string): Promise<ProjectSummary[]> {
      return firstValueFrom(this.api.get<ProjectSummary[]>(`/sync/remotes/${remoteId}/projects`));
   }

   /** Move a local project to a server; returns its new id (the server's). */
   async publish(projectId: string, remoteId: string): Promise<string> {
      const result = await firstValueFrom(this.api.post<SyncLinkResult>('/sync/links', { projectId, remoteId }));
      await this.refresh();
      return result.projectId;
   }

   /** Download a server project (it stays on the server); returns its id here (the same). */
   async clone(remoteId: string, remoteProjectId: string): Promise<string> {
      const result = await firstValueFrom(this.api.post<SyncLinkResult>('/sync/clone', { remoteId, remoteProjectId }));
      await this.refresh();
      return result.projectId;
   }

   async syncNow(projectId: string): Promise<SyncLinkResponse> {
      const { link } = await firstValueFrom(this.api.post<SyncLinkResult>(`/sync/links/${projectId}/sync`, {}));
      await this.refresh();
      return link;
   }

   /** The server's current version of a project, to compare with this computer's. */
   serverVersion(projectId: string): Promise<ProjectExportFile> {
      return firstValueFrom(this.api.get<ProjectExportFile>(`/sync/links/${projectId}/server-version`));
   }

   async resolve(projectId: string, keep: 'server' | 'mine'): Promise<SyncLinkResponse> {
      const { link } = await firstValueFrom(
         this.api.post<SyncLinkResult>(`/sync/links/${projectId}/resolve`, { keep })
      );
      await this.refresh();
      return link;
   }

   /** Live editing + background syncing on, or off (edits stay here until "Sync now"). */
   async setAutoSync(projectId: string, autoSync: boolean): Promise<SyncLinkResponse> {
      const { link } = await firstValueFrom(this.api.patch<SyncLinkResult>(`/sync/links/${projectId}`, { autoSync }));
      await this.refresh();
      return link;
   }

   async unlink(projectId: string): Promise<void> {
      await firstValueFrom(this.api.delete<void>(`/sync/links/${projectId}`));
      await this.refresh();
   }
}
