import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Desktop preferences, kept in `<data>/settings.json` and edited from the app's
 * Settings page (IPC dd:settings:*). Unknown or invalid values fall back to defaults.
 */
export type UpdateMode = 'ask' | 'install-on-quit' | 'off';

export interface DesktopSettings {
  /** ask = download in the background and offer a restart; install-on-quit = no prompt; off = never check on launch. */
  updates: UpdateMode;
  /** How many automatic database backups to keep (taken before each upgrade). */
  backupsToKeep: number;
}

export const DEFAULT_SETTINGS: DesktopSettings = { updates: 'ask', backupsToKeep: 5 };

const UPDATE_MODES: readonly UpdateMode[] = ['ask', 'install-on-quit', 'off'];

export function sanitizeSettings(raw: unknown, base = DEFAULT_SETTINGS): DesktopSettings {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const updates = UPDATE_MODES.includes(input.updates as UpdateMode)
    ? (input.updates as UpdateMode)
    : base.updates;
  const keep = Number(input.backupsToKeep);
  const backupsToKeep = Number.isInteger(keep) && keep >= 1 && keep <= 50 ? keep : base.backupsToKeep;
  return { updates, backupsToKeep };
}

function file(dataDir: string): string {
  return join(dataDir, 'settings.json');
}

export function loadSettings(dataDir: string): DesktopSettings {
  try {
    if (existsSync(file(dataDir)))
      return sanitizeSettings(JSON.parse(readFileSync(file(dataDir), 'utf8')));
  } catch {
    // Corrupt file: defaults (rewritten on the next change).
  }
  return { ...DEFAULT_SETTINGS };
}

/** Applies a partial change and saves; returns the full settings. */
export function saveSettings(dataDir: string, patch: unknown): DesktopSettings {
  const current = loadSettings(dataDir);
  const next = sanitizeSettings({ ...current, ...(patch as object) }, current);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file(dataDir), JSON.stringify(next, null, 2));
  return next;
}
