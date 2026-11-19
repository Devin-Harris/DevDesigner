import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  app,
  BrowserWindow,
  crashReporter,
  dialog,
  ipcMain,
  Menu,
  safeStorage,
  shell,
  type MenuItemConstructorOptions,
} from 'electron';
import {
  hostedServerUrl,
  isAppUrl,
  loadOrCreateSecret,
  loadOrCreateTokenKey,
  parseLaunchArg,
  pickPort,
  PROTOCOL,
  resolvePaths,
  serverEnv,
  type LaunchRequest,
} from './config';
import { ServerHost } from './server-host';
import { Updater } from './updater';
import { loadSettings, saveSettings } from './settings';
import {
  backupClosedDatabase,
  backupsDir,
  listBackups,
  previousVersionIfChanged,
  recordVersion,
  restoreBackup,
} from './backup';

/**
 * Electron main process: starts the local server on loopback, then opens the
 * client it serves. All data lives under the user's app-data folder.
 */
crashReporter.start({ uploadToServer: false });

const APP_ROOT = app.isPackaged ? app.getAppPath() : join(__dirname, '..', '..');
const paths = resolvePaths(APP_ROOT, app.getPath('userData'));

let server: ServerHost | null = null;
let mainWindow: BrowserWindow | null = null;
let origin = '';
let quitting = false;
let ready = false;
/** Per-launch secret for the server's /api/desktop control routes. */
const controlToken = randomBytes(32).toString('base64url');
const updater = new Updater(
  () => mainWindow,
  () => loadSettings(paths.dataDir).updates,
  (status) => mainWindow?.webContents.send('dd:update-status', status),
);

// The title bar's update button and the Settings spinner (client core/desktop).
ipcMain.handle('dd:update:get', (event) => (fromPage(event) ? updater.status() : null));
ipcMain.on('dd:update:install', (event) => {
  if (event.sender === mainWindow?.webContents) updater.installNow();
});

// --- Messages to the page (DesktopShellService), queued until it says it is ready ---

type DesktopMessage =
  | { type: 'open-file'; name: string; text: string }
  | { type: 'open-project'; projectId: string }
  | { type: 'export-project' }
  | { type: 'open-settings' }
  | { type: 'navigate'; path: string };

const MAX_PROJECT_FILE_BYTES = 250 * 1024 * 1024;
let rendererReady = false;
const outbox: DesktopMessage[] = [];

function sendToPage(message: DesktopMessage): void {
  if (rendererReady && mainWindow) mainWindow.webContents.send('dd:message', message);
  else outbox.push(message);
}

// The title bar's menu button: the application menu as a popup under it.
ipcMain.on('dd:show-menu', (event, pos: { x: number; y: number }) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  Menu.getApplicationMenu()?.popup({
    window: mainWindow,
    x: Math.round(Number(pos?.x) || 0),
    y: Math.round(Number(pos?.y) || 0),
  });
});

// Keep the OS window buttons in the app's light/dark colors.
ipcMain.on('dd:title-bar-colors', (event, colors: { background: string; text: string }) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || process.platform === 'darwin')
    return;
  const hex = /^#[0-9a-f]{6}$/i;
  if (!hex.test(colors?.background) || !hex.test(colors?.text)) return;
  mainWindow.setTitleBarOverlay({
    color: colors.background,
    symbolColor: colors.text,
    height: TITLE_BAR_HEIGHT - 1, // leave the title bar's 1px bottom border visible
  });
});

// --- Settings page (client core/desktop/settings) ---

function fromPage(event: Electron.IpcMainInvokeEvent): boolean {
  return !!mainWindow && event.sender === mainWindow.webContents;
}

function settingsState() {
  return {
    settings: loadSettings(paths.dataDir),
    version: app.getVersion(),
    dataDir: paths.dataDir,
    backups: listBackups(paths.dataDir).map((b) => ({
      id: basename(b.dir),
      label: b.label,
      createdAt: b.createdAt,
    })),
  };
}

ipcMain.handle('dd:settings:get', (event) => (fromPage(event) ? settingsState() : null));

ipcMain.handle('dd:settings:set', (event, patch: unknown) => {
  if (!fromPage(event)) return null;
  saveSettings(paths.dataDir, patch);
  return settingsState();
});

ipcMain.handle('dd:settings:action', async (event, action: { type?: string; id?: string }) => {
  if (!fromPage(event)) return null;
  switch (action?.type) {
    case 'open-data-folder':
      await shell.openPath(paths.dataDir);
      break;
    case 'open-backups-folder':
      mkdirSync(backupsDir(paths.dataDir), { recursive: true });
      await shell.openPath(backupsDir(paths.dataDir));
      break;
    case 'open-crash-folder':
      await shell.openPath(app.getPath('crashDumps'));
      break;
    case 'open-server-log':
      if (server) await shell.openPath(server.logFile);
      break;
    case 'backup-now':
      await backupNow();
      break;
    case 'check-updates':
      await updater.checkManually();
      break;
    case 'restore':
      await restoreFromSettings(String(action.id ?? ''));
      break;
  }
  return settingsState();
});

/** Settings > Backups > Restore: confirm, then swap the database and restart. */
async function restoreFromSettings(id: string): Promise<void> {
  const backup = listBackups(paths.dataDir).find((b) => basename(b.dir) === id);
  if (!backup || !mainWindow) return;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Restore backup',
    message: `Restore the backup from ${new Date(backup.createdAt).toLocaleString()}?`,
    detail:
      'DevDesigner restarts with the data as it was then. Your current data is backed up first, so this can be undone from the same list.',
    buttons: ['Restore and restart', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  });
  if (response !== 0) return;
  quitting = true;
  server?.stop();
  // Give the server a moment to release the database file.
  await new Promise((r) => setTimeout(r, 1000));
  const keep = loadSettings(paths.dataDir).backupsToKeep;
  backupClosedDatabase(paths.databasePath, paths.dataDir, 'before-restore', new Date(), keep + 1);
  restoreBackup(backup, paths.databasePath);
  app.relaunch();
  app.exit(0);
}

ipcMain.on('dd:renderer-ready', (event) => {
  if (event.sender !== mainWindow?.webContents) return;
  rendererReady = true;
  for (const message of outbox.splice(0)) mainWindow.webContents.send('dd:message', message);
});

function handleLaunch(request: LaunchRequest | null): void {
  if (!request) return;
  if (request.kind === 'project') {
    sendToPage({ type: 'open-project', projectId: request.projectId });
  } else {
    openProjectFile(request.path);
  }
  focusWindow();
}

function openProjectFile(path: string): void {
  try {
    if (statSync(path).size > MAX_PROJECT_FILE_BYTES) throw new Error('The file is too large.');
    sendToPage({ type: 'open-file', name: basename(path), text: readFileSync(path, 'utf8') });
    app.addRecentDocument(path);
  } catch (err) {
    dialog.showErrorBox(
      'Could not open file',
      `${path}\n${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function focusWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Windows/Linux pass files and devdesigner:// links as arguments (to the first instance
  // at launch, or to a second launch that forwards them here and exits).
  app.on('second-instance', (_event, argv) => {
    focusWindow();
    for (const arg of argv.slice(1)) handleLaunch(parseLaunchArg(arg));
  });
  // macOS delivers them as events instead (possibly before ready: they are queued).
  app.on('open-file', (event, path) => {
    event.preventDefault();
    handleLaunch(parseLaunchArg(path));
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleLaunch(parseLaunchArg(url));
  });
  // Installed builds own the devdesigner:// scheme (the installer registers it too).
  if (app.isPackaged) app.setAsDefaultProtocolClient(PROTOCOL);
  app.whenReady().then(start).catch(fail);
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  quitting = true;
  server?.stop();
});

ipcMain.on('dd:config', (event) => {
  event.returnValue = {
    origin,
    version: app.getVersion(),
    // The bundled MCP server, run by this app's own executable in Node mode (no Node install needed).
    mcp: {
      command: process.execPath,
      args: [join(APP_ROOT, 'mcp', 'dist', 'index.js')],
      env: { ELECTRON_RUN_AS_NODE: '1', DEVDESIGNER_API_URL: `${origin}/api` },
    },
  };
});

async function start(): Promise<void> {
  for (const [label, file] of [
    ['server', paths.serverEntry],
    ['client', join(paths.clientDir, 'index.html')],
  ]) {
    if (!existsSync(file))
      throw new Error(`The ${label} build is missing (${file}). Run "npm run build:desktop".`);
  }
  // The window appears at once with a startup screen; the app loads into it once the
  // local server answers (a first launch can take several seconds while files are scanned).
  Menu.setApplicationMenu(buildMenu([]));
  createWindow();

  // A new app version may migrate the database: copy it first, while nothing has it open.
  const version = app.getVersion();
  const previous = previousVersionIfChanged(paths.dataDir, version);
  const upgradeBackup = previous
    ? backupClosedDatabase(
        paths.databasePath,
        paths.dataDir,
        `before-${version}-from-${previous}`,
        new Date(),
        loadSettings(paths.dataDir).backupsToKeep,
      )
    : null;

  try {
    await startServer();
  } catch (err) {
    if (upgradeBackup && (await offerRestore(previous!, err))) {
      app.relaunch();
      app.exit(0);
      return;
    }
    throw err;
  }
  recordVersion(paths.dataDir, version);
  ready = true;
  void mainWindow?.loadURL(`${origin}/`);
  for (const arg of process.argv.slice(1)) handleLaunch(parseLaunchArg(arg));
  void refreshMenu();
  updater.checkQuietly();
}

/** The built-in sync remote (empty unless the build or the environment sets one). */
function hostedUrl(): string {
  try {
    return hostedServerUrl(
      JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')),
    );
  } catch {
    return hostedServerUrl(null);
  }
}

async function startServer(): Promise<void> {
  const port = await pickPort();
  origin = `http://127.0.0.1:${port}`;
  server = new ServerHost(
    paths.serverEntry,
    {
      ...serverEnv(paths, port, loadOrCreateSecret(paths.dataDir), hostedUrl()),
      DESKTOP_CONTROL_TOKEN: controlToken,
      SYNC_TOKEN_KEY: loadOrCreateTokenKey(paths.dataDir, safeStorage),
    },
    paths.logDir,
    app.isPackaged,
  );
  server.start((code) => {
    // Failures while starting surface through waitUntilReady instead.
    if (ready && !quitting) {
      dialog.showErrorBox(
        'DevDesigner',
        `The local server stopped (exit code ${code}). See ${server?.logFile}.`,
      );
      app.quit();
    }
  });
  await server.waitUntilReady(origin);
}

/** The upgraded server failed to start (e.g. a migration failed): offer the pre-upgrade copy. */
async function offerRestore(previous: string, err: unknown): Promise<boolean> {
  server?.stop();
  const backup = listBackups(paths.dataDir)[0];
  if (!backup) return false;
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: 'DevDesigner could not start',
    message: `This version could not open your data (${err instanceof Error ? err.message : String(err)}).`,
    detail:
      `A backup was taken before upgrading from ${previous}. Restore it and restart? ` +
      `Then reinstall DevDesigner ${previous} or wait for a fixed update. Server log: ${server?.logFile}`,
    buttons: ['Restore backup and restart', 'Quit'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return false;
  // Back up the failed state too, then put the old database back and forget the upgrade.
  backupClosedDatabase(paths.databasePath, paths.dataDir, `failed-${app.getVersion()}`);
  restoreBackup(backup, paths.databasePath);
  recordVersion(paths.dataDir, previous);
  return true;
}

/** File > Open Project File: import a `.devdesigner` / `.devdesigner.json` file as a new project. */
async function openFileDialog(): Promise<void> {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
    title: 'Open DevDesigner project file',
    properties: ['openFile'],
    filters: [{ name: 'DevDesigner project', extensions: ['devdesigner', 'json'] }],
  });
  if (!canceled && filePaths[0]) openProjectFile(filePaths[0]);
}

interface RecentProject {
  id: string;
  name: string;
}

/** File > Open Recent: the projects last opened in the editor (server-side lastOpenedAt). */
async function recentProjects(): Promise<RecentProject[]> {
  try {
    const res = await fetch(`${origin}/api/desktop/recent-projects`, {
      headers: { 'X-Desktop-Control': controlToken },
    });
    return res.ok ? ((await res.json()) as RecentProject[]) : [];
  } catch {
    return [];
  }
}

async function refreshMenu(): Promise<void> {
  Menu.setApplicationMenu(buildMenu(await recentProjects()));
}

/** File > Back Up Database: a consistent live copy via the server (SQLite VACUUM INTO). */
async function backupNow(): Promise<void> {
  const stampText = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
    title: 'Back up DevDesigner database',
    defaultPath: join(app.getPath('documents'), `devdesigner-backup-${stampText}.sqlite`),
    filters: [{ name: 'SQLite database', extensions: ['sqlite'] }],
  });
  if (canceled || !filePath) return;
  try {
    const res = await fetch(`${origin}/api/desktop/backup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Desktop-Control': controlToken },
      body: JSON.stringify({ path: filePath }),
    });
    if (!res.ok) throw new Error(`Server answered ${res.status}`);
    await dialog.showMessageBox(mainWindow!, {
      type: 'info',
      message: 'Backup saved',
      detail: filePath,
      buttons: ['OK'],
    });
  } catch (err) {
    dialog.showErrorBox('Backup failed', err instanceof Error ? err.message : String(err));
  }
}

function fail(err: unknown): void {
  dialog.showErrorBox(
    'DevDesigner could not start',
    err instanceof Error ? err.message : String(err),
  );
  server?.stop();
  app.quit();
}

// --- Window ---

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

const stateFile = join(app.getPath('userData'), 'window-state.json');

function readWindowState(): WindowState {
  try {
    return { width: 1440, height: 900, ...JSON.parse(readFileSync(stateFile, 'utf8')) };
  } catch {
    return { width: 1440, height: 900 };
  }
}

function saveWindowState(win: BrowserWindow): void {
  try {
    const state: WindowState = { ...win.getNormalBounds(), maximized: win.isMaximized() };
    writeFileSync(stateFile, JSON.stringify(state));
  } catch {
    // Not worth failing a close over.
  }
}

/** The shared product logo (client assets/brand; see desktop/scripts/render-icon.mjs). */
const LOGO_DIR = join(paths.clientDir, 'assets', 'brand');
/** Window/taskbar icon: needed when unpackaged (dev) and on Linux; packaged Windows/macOS use build/icon.png. */
const WINDOW_ICON = join(LOGO_DIR, 'logo.png');
const LOGO_DATA_URL = (() => {
  try {
    return 'data:image/svg+xml;base64,' + readFileSync(join(LOGO_DIR, 'logo.svg')).toString('base64');
  } catch {
    return '';
  }
})();

/** Shown until the local server is ready (inline: nothing to load from the network). */
const SPLASH_URL =
  'data:text/html;charset=utf-8,' +
  encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><title>DevDesigner</title>
<style>
  html,body{height:100%;margin:0;background:#0d1117;color:#8b949e;font:13px system-ui,sans-serif;-webkit-app-region:drag}
  body{display:grid;place-items:center}
  .c{display:flex;flex-direction:column;align-items:center;gap:14px}
  .m{width:56px;height:56px}
  .bar{width:120px;height:3px;border-radius:2px;background:#21262d;overflow:hidden}
  .bar i{display:block;width:40%;height:100%;background:#6f8bff;border-radius:2px;animation:s 1.1s ease-in-out infinite}
  @keyframes s{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
</style></head><body><div class="c">
  <img class="m" src="${LOGO_DATA_URL}" alt="">
  <div>Starting DevDesigner…</div><div class="bar"><i></i></div>
</div></body></html>`);

/** Height of the app's own title bar (client: core/desktop/title-bar); the OS buttons match it. */
const TITLE_BAR_HEIGHT = 36;

function createWindow(): void {
  const state = readWindowState();
  const isMac = process.platform === 'darwin';
  const win = new BrowserWindow({
    // The page draws the title bar; the OS keeps its window buttons (overlaid on Windows/Linux,
    // traffic lights inset on macOS). The menu opens from the title bar's menu button.
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 12, y: 11 } }
      : {
          titleBarOverlay: { color: '#161a20', symbolColor: '#c9d1d9', height: TITLE_BAR_HEIGHT - 1 },
        }),
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'DevDesigner',
    ...(existsSync(WINDOW_ICON) ? { icon: WINDOW_ICON } : {}),
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
    },
  });
  // Opens maximized (not fullscreen); un-maximizing restores the last normal size.
  win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', () => saveWindowState(win));
  win.on('closed', () => (mainWindow = null));
  // A reload or navigation replaces the page: hold messages until it is ready again.
  win.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) rendererReady = false;
  });
  // Keep File > Open Recent current.
  win.on('focus', () => void refreshMenu());

  // Only the app's own pages load in the window; other links open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !isAppUrl(url, origin)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url, origin)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
  // No camera/mic/notifications/etc. for the app page.
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(permission === 'clipboard-sanitized-write' || permission === 'fullscreen'),
  );

  void win.loadURL(SPLASH_URL);
  mainWindow = win;
}

// --- Menu ---

function buildMenu(recent: RecentProject[]): Menu {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Project File…',
          accelerator: 'CmdOrCtrl+O',
          click: () => void openFileDialog(),
        },
        {
          label: 'Open Recent',
          submenu: recent.length
            ? recent.map((p) => ({
                label: p.name.replace(/&/g, '&&'),
                click: () => sendToPage({ type: 'open-project', projectId: p.id }),
              }))
            : [{ label: 'No recent projects', enabled: false }],
        },
        {
          label: 'Export Project…',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => sendToPage({ type: 'export-project' }),
        },
        { type: 'separator' },
        { label: 'Back Up Database…', click: () => void backupNow() },
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => sendToPage({ type: 'open-settings' }),
        },
        { label: 'Open Data Folder', click: () => void shell.openPath(paths.dataDir) },
        {
          label: 'Open Backups Folder',
          click: () => {
            mkdirSync(backupsDir(paths.dataDir), { recursive: true });
            void shell.openPath(backupsDir(paths.dataDir));
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Guides', click: () => sendToPage({ type: 'navigate', path: '/guide' }) },
        { type: 'separator' },
        { label: 'Check for Updates…', click: () => void updater.checkManually() },
        { type: 'separator' },
        { label: 'Show Server Log', click: () => server && void shell.openPath(server.logFile) },
        {
          label: 'Open Crash Reports Folder',
          click: () => void shell.openPath(app.getPath('crashDumps')),
        },
        { label: `Version ${app.getVersion()}`, enabled: false },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}
