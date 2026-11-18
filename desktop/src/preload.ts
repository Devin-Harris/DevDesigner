import { contextBridge, ipcRenderer } from 'electron';

/**
 * Exposes the desktop bridge the Angular client reads at startup
 * (client/src/app/core/config/runtime-config.ts). Synchronous so it exists
 * before the app bundle runs. Nothing else from Node/Electron reaches the page.
 */
const config = ipcRenderer.sendSync('dd:config') as {
  origin: string;
  version: string;
  mcp: { command: string; args: string[]; env: Record<string, string> };
};

contextBridge.exposeInMainWorld('devdesigner', {
  desktop: true,
  apiBaseUrl: `${config.origin}/api`,
  wsBaseUrl: config.origin,
  version: config.version,
  mcp: config.mcp,
  /** The page draws the window's title bar (see core/desktop/title-bar). */
  window: {
    platform: process.platform,
    showMenu: (x: number, y: number) => ipcRenderer.send('dd:show-menu', { x, y }),
    setTitleBarColors: (background: string, text: string) =>
      ipcRenderer.send('dd:title-bar-colors', { background, text }),
  },
  /** The Settings page: preferences, backups and folders (desktop/src/settings.ts). */
  settings: {
    get: () => ipcRenderer.invoke('dd:settings:get'),
    set: (patch: unknown) => ipcRenderer.invoke('dd:settings:set', patch),
    action: (action: { type: string; id?: string }) =>
      ipcRenderer.invoke('dd:settings:action', action),
  },
  /** Menu commands, opened files and devdesigner:// links from the main process. */
  events: {
    onMessage: (listener: (message: unknown) => void) => {
      ipcRenderer.on('dd:message', (_event, message: unknown) => listener(message));
    },
    ready: () => ipcRenderer.send('dd:renderer-ready'),
  },
});
