/**
 * `npm run media:migrate -w server [-- --gc] [-- --vacuum]`
 *
 * Moves image/video blobs out of SQLite into the media store (MEDIA_DIR, default a
 * `media` folder next to DATABASE_PATH), then optionally removes unreferenced files
 * (--gc) and compacts the database file (--vacuum). Reads the same env / .env as the
 * server. Safe to run while the server is up (WAL; each row is its own update) and
 * to re-run. A blob is cleared only after its file was written and verified.
 */
import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMediaStore } from './media-config';
import { collectMediaGarbage, migrateMedia, type SqliteLike } from './migrate-media';

type Db = SqliteLike & { pragma(sql: string): unknown; close(): void };
// better-sqlite3 ships no type declarations; this is the slice of its API used here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = require('better-sqlite3') as new (path: string) => Db;

function loadDotEnv(): void {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const args = new Set(process.argv.slice(2));
  const dbPath = resolve(process.env.DATABASE_PATH?.trim() || 'devdesigner.sqlite');
  if (!existsSync(dbPath)) throw new Error(`No database at ${dbPath} (set DATABASE_PATH).`);
  const store = createMediaStore(process.env);
  const db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');
  const columns = (db.prepare("PRAGMA table_info('project_images')").all() as Array<{ name: string }>).map((c) => c.name);
  if (!columns.includes('location')) {
    throw new Error('project_images.location is missing: start the new server once (synchronize) or run the migrations first.');
  }
  console.log(`database ${dbPath}\nmedia    ${(store as { root?: string }).root ?? store.kind}`);
  const report = await migrateMedia(db, store, (l) => console.log(l));
  console.log(`done: ${report.moved} moved (${(report.bytes / 1024 / 1024).toFixed(1)} MB), ${report.failed} failed`);
  if (args.has('--gc')) console.log(`gc: removed ${await collectMediaGarbage(db, store)} unreferenced file(s)`);
  if (args.has('--vacuum')) {
    db.exec('VACUUM');
    console.log('vacuum: done');
  }
  db.close();
  if (report.failed) process.exitCode = 1;
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
