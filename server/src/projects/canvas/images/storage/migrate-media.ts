import { createHash } from 'node:crypto';
import type { MediaStore } from './media-store';

/** The better-sqlite3 calls this needs (kept narrow so tests can pass an in-memory db). */
export interface SqliteLike {
  prepare(sql: string): {
    all(...args: unknown[]): unknown[];
    get(...args: unknown[]): unknown;
    run(...args: unknown[]): { changes: number };
  };
  exec(sql: string): unknown;
}

export interface MigrateReport {
  moved: number;
  failed: number;
  bytes: number;
  removedFiles?: number;
}

/**
 * Move every legacy blob in `project_images` into the media store (perf P4.5). Each
 * row is written, read back and re-hashed by `store.put` first; only then is its blob
 * cleared, in an UPDATE guarded by `location = 'db'` so a row moved meanwhile (lazy
 * move on read) is left alone. Safe to stop and re-run at any point.
 */
export async function migrateMedia(
  db: SqliteLike,
  store: MediaStore,
  log: (line: string) => void = () => undefined,
  batchSize = 50,
): Promise<MigrateReport> {
  const report: MigrateReport = { moved: 0, failed: 0, bytes: 0 };
  const failed = new Set<string>();
  const select = db.prepare(
    "SELECT id, data FROM project_images WHERE location = 'db' AND data IS NOT NULL AND id NOT IN (SELECT value FROM json_each(?)) LIMIT ?",
  );
  const clear = db.prepare(
    "UPDATE project_images SET data = NULL, location = 'media', sha256 = ?, byteSize = ? WHERE id = ? AND location = 'db'",
  );
  for (;;) {
    const rows = select.all(JSON.stringify([...failed]), batchSize) as Array<{ id: string; data: Buffer }>;
    if (rows.length === 0) break;
    for (const row of rows) {
      const sha256 = createHash('sha256').update(row.data).digest('hex');
      try {
        await store.put(sha256, row.data);
      } catch (err) {
        failed.add(row.id);
        report.failed++;
        log(`! ${row.id}: ${(err as Error).message} (blob kept)`);
        continue;
      }
      clear.run(sha256, row.data.length, row.id);
      report.moved++;
      report.bytes += row.data.length;
    }
    log(`moved ${report.moved} file(s), ${(report.bytes / 1024 / 1024).toFixed(1)} MB so far`);
  }
  return report;
}

/**
 * Remove stored files that no `project_images` row references and that are older
 * than `graceMs` (a file being uploaded right now has no row yet).
 */
export async function collectMediaGarbage(db: SqliteLike, store: MediaStore, graceMs = 24 * 60 * 60 * 1000): Promise<number> {
  const used = db.prepare("SELECT 1 FROM project_images WHERE sha256 = ? AND location = 'media' LIMIT 1");
  const cutoff = Date.now() - graceMs;
  let removed = 0;
  for await (const file of store.list()) {
    if (file.modifiedAt.getTime() > cutoff || used.get(file.sha256)) continue;
    await store.delete(file.sha256);
    removed++;
  }
  return removed;
}
