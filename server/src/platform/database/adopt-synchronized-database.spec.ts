import 'reflect-metadata';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { adoptSynchronizedDatabase } from './adopt-synchronized-database';
import { buildDataSourceOptions } from './data-source';

const quiet = { log: jest.fn() } as never;

function source(path: string, mode: 'synchronize' | 'migrations'): DataSource {
  return new DataSource({
    ...buildDataSourceOptions({
      DATABASE_PATH: path,
      DATABASE_SYNCHRONIZE: mode === 'synchronize' ? 'true' : 'false',
      DATABASE_MIGRATIONS_RUN: mode === 'migrations' ? 'true' : 'false',
    } as NodeJS.ProcessEnv),
    entities: [__dirname + '/../../**/*.entity.ts'],
    migrationsRun: false,
    logger: undefined,
    enableWAL: false,
  } as never);
}

describe('adoptSynchronizedDatabase', () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'dd-adopt-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('records every migration as applied on a synchronize-created database that matches the entities', async () => {
    const path = join(dir, 'app.sqlite');
    const sync = source(path, 'synchronize');
    await sync.initialize();
    await sync.query(`INSERT INTO "projects" ("id", "name") VALUES ('p1', 'kept')`);
    await sync.destroy();

    const ds = source(path, 'migrations');
    await ds.initialize();
    try {
      expect(await adoptSynchronizedDatabase(ds, quiet)).toBe('adopted');
      expect(await ds.showMigrations()).toBe(false);
      expect(await ds.runMigrations()).toEqual([]);
      expect(await ds.query(`SELECT "name" FROM "projects"`)).toEqual([{ name: 'kept' }]);
      // A second boot sees the recorded migrations.
      expect(await adoptSynchronizedDatabase(ds, quiet)).toBe('tracked');
    } finally {
      await ds.destroy();
    }
  });

  it('leaves an empty database to the migrations', async () => {
    const ds = source(join(dir, 'empty.sqlite'), 'migrations');
    await ds.initialize();
    try {
      expect(await adoptSynchronizedDatabase(ds, quiet)).toBe('fresh');
      await ds.runMigrations();
      expect((await ds.driver.createSchemaBuilder().log()).upQueries).toEqual([]);
    } finally {
      await ds.destroy();
    }
  });

  it('refuses a synchronize-created database that does not match the entities', async () => {
    const path = join(dir, 'old.sqlite');
    const sync = source(path, 'synchronize');
    await sync.initialize();
    await sync.query('DROP INDEX "uq_users_email"');
    await sync.destroy();

    const ds = source(path, 'migrations');
    await ds.initialize();
    try {
      await expect(adoptSynchronizedDatabase(ds, quiet)).rejects.toThrow(/DATABASE_SYNCHRONIZE=true/);
      expect(await ds.query(`SELECT name FROM sqlite_master WHERE name = 'migrations'`)).toEqual([]);
    } finally {
      await ds.destroy();
    }
  });
});
