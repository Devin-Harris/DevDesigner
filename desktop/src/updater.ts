import { app, dialog, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateMode } from './settings';

/**
 * Updates from GitHub Releases (electron-builder.yml `publish`). On launch the app
 * checks quietly and downloads in the background; when an update is ready the user
 * picks "Restart now" or "Later" (later = installed on the next quit). Offline or
 * failed checks are silent unless the user asked via Help > Check for Updates.
 * The pre-upgrade database backup happens on the next launch (see backup.ts).
 */
export class Updater {
  private manualCheck = false;
  private prompted = false;

  constructor(
    private readonly window: () => BrowserWindow | null,
    /** Settings > Updates, read each time so a change applies at once. */
    private readonly mode: () => UpdateMode = () => 'ask',
  ) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;

    autoUpdater.on('update-not-available', () => {
      if (this.manualCheck) {
        this.manualCheck = false;
        void this.message(
          'info',
          'You are up to date',
          `DevDesigner ${app.getVersion()} is the latest version.`,
        );
      }
    });
    autoUpdater.on('error', (err) => {
      if (this.manualCheck) {
        this.manualCheck = false;
        void this.message('warning', 'Could not check for updates', offlineHint(err));
      }
    });
    autoUpdater.on('update-downloaded', (info) => {
      const manual = this.manualCheck;
      this.manualCheck = false;
      // "Install on quit": no prompt for background updates (a manual check still asks).
      if (!manual && this.mode() !== 'ask') return;
      if (this.prompted) return;
      this.prompted = true;
      void this.promptRestart(info.version);
    });
  }

  /** Background check on launch; packaged builds only (dev has no update feed). */
  checkQuietly(): void {
    if (!app.isPackaged || this.mode() === 'off') return;
    autoUpdater.checkForUpdates().catch(() => undefined);
  }

  /** Help > Check for Updates. */
  async checkManually(): Promise<void> {
    if (!app.isPackaged) {
      await this.message('info', 'Updates', 'Updates are only available in installed builds.');
      return;
    }
    this.manualCheck = true;
    this.prompted = false;
    await autoUpdater.checkForUpdates().catch(() => undefined);
  }

  private async promptRestart(version: string): Promise<void> {
    const { response } = await this.box({
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `DevDesigner ${version} is ready to install.`,
      detail:
        'Restart now to update, or it will be installed the next time you quit. Your data is backed up before the new version opens it.',
    });
    if (response === 0) autoUpdater.quitAndInstall();
  }

  private async message(type: 'info' | 'warning', message: string, detail: string): Promise<void> {
    await this.box({ type, message, detail, buttons: ['OK'] });
  }

  private box(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
    const win = this.window();
    return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
  }
}

function offlineHint(err: Error): string {
  const text = err?.message ?? String(err);
  if (/app-update\.yml/.test(text))
    return 'This copy of DevDesigner was installed without update settings. Reinstall it from the installer to get automatic updates.';
  if (/404|No published versions|Unable to find latest version|latest\.yml/i.test(text))
    return 'No update has been published yet. You have the newest version available.';
  return /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|net::/.test(text)
    ? 'You appear to be offline. DevDesigner works fully offline; try again when you are connected.'
    : text.split('\n')[0];
}
