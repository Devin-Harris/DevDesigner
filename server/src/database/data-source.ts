import { DataSource, DataSourceOptions } from 'typeorm';

/**
 * TypeORM datasource options for the SQLite application database.
 *
 * Entities and migrations are registered here as feature modules land (User,
 * Project, Table, Column, Relationship, Note, ShareLink). Prefer real columns
 * over JSON blobs and configure cascading deletes at the entity relations
 * (see BUILD_INSTRUCTIONS.md section 4.1).
 */
export function buildDataSourceOptions(env: NodeJS.ProcessEnv = process.env): DataSourceOptions {
  return {
    type: 'better-sqlite3',
    database: env.DATABASE_PATH ?? 'devdesigner.sqlite',
    // Entities are added per feature module; glob keeps registration automatic.
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    migrations: [__dirname + '/../../migrations/*{.ts,.js}'],
    synchronize: env.DATABASE_SYNCHRONIZE === 'true',
    logging: false,
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
