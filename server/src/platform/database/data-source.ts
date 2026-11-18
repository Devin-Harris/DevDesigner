import { DataSource, DataSourceOptions } from 'typeorm';
import { TypeOrmLogger } from './typeorm-logger';

/**
 * TypeORM datasource options for the SQLite application database.
 *
 * Entities and migrations are registered here as feature modules land (User,
 * Project, Table, Column, Relationship, Note, ShareLink). Prefer real columns
 * over JSON blobs and configure cascading deletes at the entity relations
 * (see BUILD_INSTRUCTIONS.md section 4.1).
 */
export function buildDataSourceOptions(env: NodeJS.ProcessEnv = process.env): DataSourceOptions {
  const migrationsRun = env.DATABASE_MIGRATIONS_RUN === 'true';
  return {
    type: 'better-sqlite3',
    database: env.DATABASE_PATH ?? 'devdesigner.sqlite',
    // Entities are added per feature module; glob keeps registration automatic.
    entities: [__dirname + '/../../**/*.entity{.ts,.js}'],
    // DATABASE_MIGRATIONS_RUN (desktop): schema comes only from the compiled baseline +
    // follow-up migrations next to this file. Otherwise the legacy root patches (CLI only).
    migrations: migrationsRun
      ? [__dirname + '/migrations/*{.ts,.js}']
      : [__dirname + '/../../../migrations/*{.ts,.js}'],
    migrationsRun,
    synchronize: !migrationsRun && env.DATABASE_SYNCHRONIZE === 'true',
    logging: ['error', 'warn'],
    logger: new TypeOrmLogger(),
    maxQueryExecutionTime: Number(env.SLOW_QUERY_MS ?? 200) || undefined,
    // WAL lets reads run alongside a write and makes each small write transaction cheap
    // (no full fsync per commit with synchronous=NORMAL, which is still crash-safe in WAL).
    enableWAL: true,
    prepareDatabase: (db: { pragma: (sql: string) => unknown }) => {
      db.pragma('synchronous = NORMAL');
      db.pragma('busy_timeout = 5000');
      db.pragma('cache_size = -32000');
      db.pragma('temp_store = MEMORY');
    },
  };
}

/** CLI datasource for running `typeorm migration:*` commands. */
export const AppDataSource = new DataSource(buildDataSourceOptions());
