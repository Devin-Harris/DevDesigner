import { Logger } from '@nestjs/common';
import { DataSource, Table } from 'typeorm';

/** A table every app database has; its presence means the schema already exists. */
const MARKER_TABLE = 'projects';

export type AdoptionResult = 'fresh' | 'tracked' | 'adopted';

/**
 * Moves a database whose schema was created by `synchronize` onto migrations.
 *
 * Call it on an initialized data source, before running migrations. A database that is
 * empty (`fresh`) or already records migrations (`tracked`) is left alone. Otherwise the
 * live schema must already equal the entities: then every known migration is recorded as
 * applied (`adopted`), so the baseline does not try to create tables that exist.
 *
 * When the schema differs (the database was synchronized by an older build), it throws
 * with the SQL that synchronize would still run. Deploy once more with
 * DATABASE_SYNCHRONIZE=true (and migrations off) so the schema catches up, then switch.
 */
export async function adoptSynchronizedDatabase(
  dataSource: DataSource,
  logger = new Logger('Migrations'),
): Promise<AdoptionResult> {
  const runner = dataSource.createQueryRunner();
  try {
    if (!(await runner.hasTable(MARKER_TABLE))) return 'fresh';
    const table = dataSource.options.migrationsTableName ?? 'migrations';
    if (await runner.hasTable(table)) {
      const rows = (await runner.query(`SELECT COUNT(*) AS n FROM "${table}"`)) as Array<{ n: number }>;
      if (Number(rows[0]?.n ?? 0) > 0) return 'tracked';
    }

    const pending = await dataSource.driver.createSchemaBuilder().log();
    if (pending.upQueries.length) {
      const sql = pending.upQueries.map((q) => `  ${q.query}`).join('\n');
      throw new Error(
        'This database was created by synchronize and does not match the current entities, so it ' +
          'cannot be moved onto migrations yet. Deploy once with DATABASE_SYNCHRONIZE=true and ' +
          `DATABASE_MIGRATIONS_RUN=false so the schema catches up, then switch. Pending changes:\n${sql}`,
      );
    }

    if (!(await runner.hasTable(table))) {
      await runner.createTable(
        new Table({
          name: table,
          columns: [
            { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
            { name: 'timestamp', type: 'bigint', isNullable: false },
            { name: 'name', type: 'varchar', isNullable: false },
          ],
        }),
      );
    }
    const migrations = dataSource.migrations.map((m) => {
      const name = m.name ?? m.constructor.name;
      const timestamp = Number(/(\d{13})/.exec(name)?.[1] ?? 0);
      return { name, timestamp };
    });
    for (const m of migrations.sort((a, b) => a.timestamp - b.timestamp)) {
      await runner.query(`INSERT INTO "${table}" ("timestamp", "name") VALUES (?, ?)`, [m.timestamp, m.name]);
    }
    logger.log(`Adopted a synchronize-created database: recorded ${migrations.length} migration(s) as applied.`);
    return 'adopted';
  } finally {
    await runner.release();
  }
}
