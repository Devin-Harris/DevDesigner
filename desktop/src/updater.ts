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
/** What the page shows: the Settings spinner and the title bar's update button. */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string };

/** Background checks repeat this often while the app is open. */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

export class Updater {
  private manualCheck = false;
  private prompted = false;
  private timer: NodeJS.Timeout | null = null;
  private current: UpdateStatus = { state: 'idle' };
  private pendingVersion = '';

  constructor(
    private readonly window: () => BrowserWindow | null,
    /** Settings > Updates, read each time so a change applies at once. */
    private readonly mode: () => UpdateMode = () => 'ask',
    /** Called on every status change (main.ts forwards it to the page). */
    private readonly onStatus: (status: UpdateStatus) => void = () => undefined,
  ) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;

    autoUpdater.on('checking-for-update', () => {
      if (this.current.state !== 'ready') this.set({ state: 'checking' });
    });
    autoUpdater.on('update-available', (info) => {
      this.pendingVersion = info.version;
      this.set({ state: 'downloading', version: info.version, percent: 0 });
    });
    autoUpdater.on('download-progress', (p) => {
      this.set({
        state: 'downloading',
        version: this.pendingVersion,
        percent: Math.round(p.percent),
      });
    });
    autoUpdater.on('update-not-available', () => {
      this.set({ state: 'idle' });
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
      if (this.current.state !== 'ready') this.set({ state: 'idle' });
      if (this.manualCheck) {
        this.manualCheck = false;
        void this.message('warning', 'Could not check for updates', offlineHint(err));
      }
    });
    autoUpdater.on('update-downloaded', (info) => {
      this.set({ state: 'ready', version: info.version });
      const manual = this.manualCheck;
      this.manualCheck = false;
      // "Install on quit": no prompt for background updates (a manual check still asks).
      if (!manual && this.mode() !== 'ask') return;
      if (this.prompted) return;
      this.prompted = true;
      void this.promptRestart(info.version);
    });
  }

  status(): UpdateStatus {
    return this.current;
  }

  /**
   * Background check on launch, then every few hours (like VS Code) so a long-open
   * window still learns about new releases. Packaged builds only (dev has no feed).
   */
  checkQuietly(): void {
    this.backgroundCheck();
    this.timer ??= setInterval(() => this.backgroundCheck(), CHECK_INTERVAL_MS);
  }

  /** The title bar's "Restart to update" button. */
  installNow(): void {
    if (this.current.state === 'ready') autoUpdater.quitAndInstall();
  }

  private backgroundCheck(): void {
    if (!app.isPackaged || this.mode() === 'off') return;
    // Already downloaded or mid-download: nothing new to ask for.
    if (this.current.state === 'ready' || this.current.state === 'downloading') return;
    autoUpdater.checkForUpdates().catch(() => undefined);
  }

  private set(status: UpdateStatus): void {
    this.current = status;
    this.onStatus(status);
  }

  /** Help > Check for Updates. */
  async checkManually(): Promise<void> {
    if (!app.isPackaged) {
      await this.message('info', 'Updates', 'Updates are only available in installed builds.');
      return;
    }
    if (this.current.state === 'ready') {
      await this.promptRestart(this.current.version);
      return;
    }
    if (this.current.state === 'checking' || this.current.state === 'downloading') {
      this.manualCheck = true;
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
  return /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|net::/.test(text)
    ? 'You appear to be offline. DevDesigner works fully offline; try again when you are connected.'
    : text.split('\n')[0];
}
