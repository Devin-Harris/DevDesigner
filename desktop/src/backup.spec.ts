import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  backupClosedDatabase,
  listBackups,
  previousVersionIfChanged,
  pruneBackups,
  recordVersion,
  restoreBackup,
} from './backup';

function setup(): { dataDir: string; db: string } {
  const dataDir = mkdtempSync(join(tmpdir(), 'dd-data-'));
  return { dataDir, db: join(dataDir, 'devdesigner.sqlite') };
}

describe('desktop backups', () => {
  it('copies the database with its WAL and restores it', () => {
    const { dataDir, db } = setup();
    writeFileSync(db, 'v1');
    writeFileSync(db + '-wal', 'wal1');
    const dir = backupClosedDatabase(db, dataDir, 'before-0.2.0-from-0.1.0', new Date(1000));
    expect(dir).not.toBeNull();

    writeFileSync(db, 'v2-broken');
    writeFileSync(db + '-shm', 'shm2');
    restoreBackup(listBackups(dataDir)[0], db);
    expect(readFileSync(db, 'utf8')).toBe('v1');
    expect(readFileSync(db + '-wal', 'utf8')).toBe('wal1');
    // A side file the backup didn't have must not survive (it belongs to the broken state).
    expect(existsSync(db + '-shm')).toBe(false);
  });

  it('skips when there is no database yet', () => {
    const { dataDir, db } = setup();
    expect(backupClosedDatabase(db, dataDir, 'x')).toBeNull();
  });

  it('keeps only the newest backups, newest first', () => {
    const { dataDir, db } = setup();
    writeFileSync(db, 'x');
    for (let i = 0; i < 7; i++)
      backupClosedDatabase(db, dataDir, `b${i}`, new Date(1000 * (i + 1)));
    pruneBackups(dataDir, 5);
    expect(listBackups(dataDir).map((b) => b.label)).toEqual(['b6', 'b5', 'b4', 'b3', 'b2']);
  });

  it('reports the previous version only when it changed', () => {
    const { dataDir } = setup();
    expect(previousVersionIfChanged(dataDir, '0.1.0')).toBeNull();
    recordVersion(dataDir, '0.1.0');
    expect(previousVersionIfChanged(dataDir, '0.1.0')).toBeNull();
    expect(previousVersionIfChanged(dataDir, '0.2.0')).toBe('0.1.0');
  });
});
