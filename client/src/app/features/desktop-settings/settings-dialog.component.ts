import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { ProjectsStore } from '../../shared/state/projects/projects.store';
import { AccountDialogsService } from '../../shared/features/auth-dialogs/account-dialogs.service';
import { SyncPanelComponent } from '../../shared/features/projects-overlay/components/sync-panel/sync-panel.component';
import { UpdateService } from '../../core/desktop/update.service';
import { IconComponent } from '../../shared/ui/components/icon/icon.component';
import { SegmentedComponent } from '../../shared/ui/components/segmented/segmented.component';
import { CallPipe } from '../../shared/ui/pipes/collection.pipes';

type UpdateMode = 'ask' | 'install-on-quit' | 'off';

interface SettingsState {
   settings: { updates: UpdateMode; backupsToKeep: number };
   version: string;
   dataDir: string;
   backups: Array<{ id: string; label: string; createdAt: number }>;
}

interface SettingsBridge {
   get(): Promise<SettingsState | null>;
   set(patch: Partial<SettingsState['settings']>): Promise<SettingsState | null>;
   action(action: { type: string; id?: string }): Promise<SettingsState | null>;
}

type Tab = 'general' | 'sync' | 'data' | 'about';

/**
 * Desktop Settings (File > Settings, Ctrl+,): updates, sync servers, data folder and
 * backups, and app info. Preferences live in the main process (desktop/src/settings.ts).
 */
@Component({
   selector: 'dd-settings-dialog',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [CallPipe, DatePipe, ReactiveFormsModule, MatDialogModule, IconComponent, SegmentedComponent, SyncPanelComponent],
   templateUrl: './settings-dialog.component.html',
   styleUrl: './settings-dialog.component.scss',
})
export class SettingsDialogComponent {
   private readonly ref = inject(MatDialogRef<SettingsDialogComponent>);
   private readonly store = inject(ProjectsStore);
   private readonly accountDialogs = inject(AccountDialogsService);
   protected readonly updater = inject(UpdateService);
   private readonly bridge = (globalThis as { devdesigner?: { settings?: SettingsBridge } }).devdesigner?.settings;

   protected readonly tab$ = signal<Tab>('general');
   protected readonly state$ = signal<SettingsState | null>(null);
   protected readonly busy$ = signal(false);

   protected readonly tabs: Array<{ id: Tab; label: string; icon: string }> = [
      { id: 'general', label: 'General', icon: 'tune' },
      { id: 'sync', label: 'Sync servers', icon: 'cloud' },
      { id: 'data', label: 'Data & backups', icon: 'archive' },
      { id: 'about', label: 'About', icon: 'info' },
   ];

   protected readonly updateOptions = [
      { value: 'ask' as UpdateMode, label: 'Ask to restart' },
      { value: 'install-on-quit' as UpdateMode, label: 'Install on quit' },
      { value: 'off' as UpdateMode, label: 'Off' },
   ];
   protected readonly updates = new FormControl<UpdateMode>('ask', { nonNullable: true });
   protected readonly updatesValue$ = signal<UpdateMode>('ask');
   protected readonly backupsToKeep = new FormControl(5, { nonNullable: true });

   constructor() {
      void this.load();
      this.updates.valueChanges.subscribe((updates) => {
         this.updatesValue$.set(updates);
         void this.save({ updates });
      });
   }

   private async load(): Promise<void> {
      this.apply(await this.bridge?.get());
   }

   private apply(state: SettingsState | null | undefined): void {
      if (!state) return;
      this.state$.set(state);
      this.updates.setValue(state.settings.updates, { emitEvent: false });
      this.updatesValue$.set(state.settings.updates);
      this.backupsToKeep.setValue(state.settings.backupsToKeep, { emitEvent: false });
   }

   private async save(patch: Partial<SettingsState['settings']>): Promise<void> {
      this.apply(await this.bridge?.set(patch));
   }

   protected saveBackupsToKeep(): void {
      const n = Math.round(Number(this.backupsToKeep.value));
      void this.save({ backupsToKeep: Math.min(50, Math.max(1, Number.isFinite(n) ? n : 5)) });
   }

   protected async run(type: string, id?: string): Promise<void> {
      this.busy$.set(true);
      try {
         this.apply(await this.bridge?.action({ type, id }));
      } finally {
         this.busy$.set(false);
      }
   }

   protected openApiTokens(): void {
      void this.accountDialogs.openApiTokens();
   }

   protected openSynced(projectId: string): void {
      this.store.loadProjects();
      this.store.select(projectId);
      this.ref.close();
   }

   protected labelOf(label: string): string {
      if (label.startsWith('before-restore')) return 'Before a restore';
      const upgrade = /^before-(.+)-from-(.+)$/.exec(label);
      if (upgrade) return `Before updating ${upgrade[2]} → ${upgrade[1]}`;
      if (label.startsWith('failed-')) return `Failed update (${label.slice(7)})`;
      return label;
   }

   protected close(): void {
      this.ref.close();
   }
}
