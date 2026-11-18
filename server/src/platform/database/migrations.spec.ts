import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './data-source';

/**
 * Desktop databases get their schema only from migrations (no synchronize). If this
 * fails, an entity changed without a migration in src/platform/database/migrations:
 * add one (the failure lists the SQL synchronize would have run).
 */
describe('app database migrations', () => {
  it('build exactly the entity schema on an empty database', async () => {
    const ds = new DataSource({
      ...buildDataSourceOptions({
        DATABASE_PATH: ':memory:',
        DATABASE_MIGRATIONS_RUN: 'true',
      } as NodeJS.ProcessEnv),
      entities: [__dirname + '/../../**/*.entity.ts'],
      logger: undefined,
      enableWAL: false,
    } as never);
    await ds.initialize();
    try {
      expect(await ds.showMigrations()).toBe(false);
      const pending = await ds.driver.createSchemaBuilder().log();
      expect(pending.upQueries.map((q) => q.query)).toEqual([]);
    } finally {
      await ds.destroy();
    }
  });
});
