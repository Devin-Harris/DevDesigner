// Electron shell: runs the NestJS server in-process on a fixed local port, serves the
// built Angular client from it, and shows it in a window. Peer-to-peer sharing is the
// same share-link system as the web app, except the host's own machine is the server:
// with "Share on Local Network" on, the server binds all interfaces and share links
// carry the host's LAN address, so a peer opens them in a browser or via
// "Open Shared Link from Clipboard" in their own copy of the app.
const { app, BrowserWindow, Menu, clipboard, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = Number(process.env.DBDESIGNER_PORT) || 38427;
// Packaged: server/ and client/ sit in resources/. Dev: they are built in the repo.
const SERVER_DIR = app.isPackaged ? path.join(process.resourcesPath, 'server') : path.resolve(__dirname, '..', 'server');
const CLIENT_DIR = app.isPackaged ? path.join(process.resourcesPath, 'client') : path.resolve(__dirname, '..', 'client', 'dist', 'client', 'browser');
const LOCAL_URL = `http://127.0.0.1:${PORT}`;

let win = null;
let server = null;
let settings = { shareOnNetwork: false, jwtSecret: '' };
let settingsFile = '';

function loadSettings() {
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) };
  } catch {
    /* first run */
  }
  if (!settings.jwtSecret) settings.jwtSecret = crypto.randomBytes(48).toString('hex');
  saveSettings();
}

function saveSettings() {
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}

/** First private IPv4 address, preferring typical LAN ranges. */
function lanAddress() {
  const all = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  return all.find((a) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a)) ?? all[0] ?? null;
}

function publicUrl() {
  const lan = settings.shareOnNetwork ? lanAddress() : null;
  return `http://${lan ?? '127.0.0.1'}:${PORT}`;
}

function configureEnv() {
  Object.assign(process.env, {
    PORT: String(PORT),
    DATABASE_PATH: path.join(app.getPath('userData'), 'dbdesigner.sqlite'),
    DATABASE_SYNCHRONIZE: 'true',
    JWT_SECRET: settings.jwtSecret,
    COOKIE_SECURE: 'false',
    STATIC_DIR: CLIENT_DIR,
    SQLITE_DRIVER_PATH: require.resolve('better-sqlite3'),
  });
}

async function startServer() {
  // Read when share links are built, so it follows the sharing toggle.
  process.env.PUBLIC_APP_URL = publicUrl();
  const { startServer: start } = require(path.join(SERVER_DIR, 'dist', 'src', 'bootstrap.js'));
  server = await start({ host: settings.shareOnNetwork ? '0.0.0.0' : '127.0.0.1', port: PORT });
}

async function restartServer() {
  await server?.close();
  server = null;
  await startServer();
  if (win && win.webContents.getURL().startsWith(LOCAL_URL)) win.reload();
  buildMenu();
}

async function setShareOnNetwork(enabled) {
  if (enabled && !lanAddress()) {
    dialog.showErrorBox('No network', 'No local network connection was found to share on.');
    buildMenu();
    return;
  }
  settings.shareOnNetwork = enabled;
  saveSettings();
  await restartServer();
  if (enabled) {
    dialog.showMessageBox(win, {
      type: 'info',
      message: `Sharing on ${publicUrl()}`,
      detail:
        'Share links now use this address. Peers on your network can open them in a browser. ' +
        'Windows may ask you to allow DBDesigner through the firewall. Anyone on your network can ' +
        'reach this server, but only people with a share link can open your projects.',
    });
  }
}

function openSharedLinkFromClipboard() {
  const text = clipboard.readText().trim();
  let url = null;
  try {
    const u = new URL(text);
    if ((u.protocol === 'http:' || u.protocol === 'https:') && /^\/shared\/[\w-]+$/.test(u.pathname)) {
      url = u.toString();
    }
  } catch {
    /* not a URL */
  }
  if (!url) {
    dialog.showErrorBox('No share link', 'Copy a DBDesigner share link first, then try again.');
    return;
  }
  win?.loadURL(url);
}

/** Checks GitHub Releases; downloads in the background and offers a restart when ready. */
function setupAutoUpdate() {
  if (!app.isPackaged) return;
  autoUpdater.on('update-downloaded', async (info) => {
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      message: `DBDesigner ${info.version} is ready to install.`,
      detail: 'Your projects are kept. It will also install the next time you quit.',
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', (err) => console.error('Update check failed:', err?.message ?? err));
  autoUpdater.checkForUpdates().catch(() => {});
}

async function checkForUpdatesManually() {
  if (!app.isPackaged) {
    dialog.showMessageBox(win, { message: 'Updates only apply to the installed app.' });
    return;
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result?.isUpdateAvailable) {
      dialog.showMessageBox(win, { message: `You're up to date (v${app.getVersion()}).` });
    }
  } catch (err) {
    dialog.showErrorBox('Update check failed', String(err?.message ?? err));
  }
}

function buildMenu() {
  const sharing = settings.shareOnNetwork;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          { label: 'My Projects', accelerator: 'CmdOrCtrl+Shift+H', click: () => win?.loadURL(LOCAL_URL) },
          { label: 'Open Shared Link from Clipboard', click: openSharedLinkFromClipboard },
          { type: 'separator' },
          {
            label: 'Share on Local Network',
            type: 'checkbox',
            checked: sharing,
            click: (item) => setShareOnNetwork(item.checked),
          },
          {
            label: 'Copy Network Address',
            enabled: sharing,
            click: () => clipboard.writeText(publicUrl()),
          },
          { label: 'Check for Updates...', click: checkForUpdatesManually },
          { label: 'Open Data Folder', click: () => shell.openPath(app.getPath('userData')) },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  );
}

function createWindow() {
  win = new BrowserWindow({ width: 1440, height: 900, backgroundColor: '#ffffff', show: false });
  win.once('ready-to-show', () => win.show());
  // External pages open in the system browser, never in this window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => (win = null));
  win.loadURL(LOCAL_URL);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(async () => {
    loadSettings();
    configureEnv();
    try {
      await startServer();
    } catch (err) {
      dialog.showErrorBox('DBDesigner failed to start', String(err?.stack ?? err));
      app.quit();
      return;
    }
    buildMenu();
    createWindow();
    setupAutoUpdate();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => server?.close());
}
