import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';

/**
 * SQLite backups of the desktop database. Copies are only taken while the server
 * is not running (the main DB file plus its -wal/-shm, so they are consistent);
 * live backups go through the server's VACUUM INTO endpoint instead.
 */
const SIDE_FILES = ['', '-wal', '-shm'];
export const KEEP_BACKUPS = 5;

export interface BackupInfo {
  dir: string;
  label: string;
  createdAt: number;
}

export function backupsDir(dataDir: string): string {
  return join(dataDir, 'backups');
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

/** Copies the (closed) database into backups/<label>-<time>/; null when there is no database yet. */
export function backupClosedDatabase(
  databasePath: string,
  dataDir: string,
  label: string,
  now = new Date(),
): string | null {
  if (!existsSync(databasePath)) return null;
  const dir = join(backupsDir(dataDir), `${label}-${stamp(now)}`);
  mkdirSync(dir, { recursive: true });
  for (const suffix of SIDE_FILES) {
    const from = databasePath + suffix;
    if (existsSync(from)) copyFileSync(from, join(dir, basename(databasePath) + suffix));
  }
  writeFileSync(join(dir, 'backup.json'), JSON.stringify({ label, createdAt: now.getTime() }));
  pruneBackups(dataDir);
  return dir;
}

export function listBackups(dataDir: string): BackupInfo[] {
  const root = backupsDir(dataDir);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((name) => join(root, name))
    .filter((dir) => statSync(dir).isDirectory())
    .map((dir) => {
      try {
        const meta = JSON.parse(readFileSync(join(dir, 'backup.json'), 'utf8')) as {
          label: string;
          createdAt: number;
        };
        return { dir, label: meta.label, createdAt: meta.createdAt };
      } catch {
        return { dir, label: basename(dir), createdAt: statSync(dir).mtimeMs };
      }
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Keeps the newest KEEP_BACKUPS automatic backups. */
export function pruneBackups(dataDir: string, keep = KEEP_BACKUPS): void {
  for (const old of listBackups(dataDir).slice(keep))
    rmSync(old.dir, { recursive: true, force: true });
}

/** Replaces the (closed) database with a backup's files. */
export function restoreBackup(backup: BackupInfo, databasePath: string): void {
  for (const suffix of SIDE_FILES) {
    const target = databasePath + suffix;
    const source = join(backup.dir, basename(databasePath) + suffix);
    if (existsSync(source)) copyFileSync(source, target);
    else rmSync(target, { force: true });
  }
}

/**
 * Version-change bookkeeping: returns the previous version when this launch runs a
 * different app version than the last one (an upgrade or downgrade), else null.
 */
export function previousVersionIfChanged(dataDir: string, current: string): string | null {
  const file = join(dataDir, 'last-version');
  const previous = existsSync(file) ? readFileSync(file, 'utf8').trim() : null;
  return previous && previous !== current ? previous : null;
}

export function recordVersion(dataDir: string, current: string): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'last-version'), current);
}
