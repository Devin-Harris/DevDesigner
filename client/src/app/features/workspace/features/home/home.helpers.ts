/** Showcase pacing: resolves after `ms`. */
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** GitHub Releases of the desktop app (desktop/electron-builder.yml `publish`). */
export const DESKTOP_RELEASES_URL = 'https://github.com/Devin-Harris/DevDesigner/releases';

export const latest = (file: string): string => `${DESKTOP_RELEASES_URL}/latest/download/${file}`;

/** Stable file names (no version) set by electron-builder.yml `artifactName`. */
export const DESKTOP_DOWNLOADS = [
   { id: 'windows', label: 'Windows', file: 'DevDesigner-Setup.exe', url: latest('DevDesigner-Setup.exe') },
   // Built on Apple-silicon CI runners only (native modules match the build machine).
   { id: 'mac-arm', label: 'macOS (Apple silicon)', file: 'DevDesigner-arm64.dmg', url: latest('DevDesigner-arm64.dmg') },
   { id: 'linux', label: 'Linux', file: 'DevDesigner.AppImage', url: latest('DevDesigner.AppImage') },
] as const;

export function detectPlatform(ua: string): string | null {
   if (/Windows/i.test(ua)) return 'windows';
   // Browsers report Intel on Apple silicon too; Apple silicon is the common case now.
   if (/Mac OS X|Macintosh/i.test(ua)) return 'mac-arm';
   if (/Linux/i.test(ua) && !/Android/i.test(ua)) return 'linux';
   return null;
}
