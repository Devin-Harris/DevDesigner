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
    database: env.DATABASE_PATH ?? 'dbdesigner.sqlite',
    // Entities are added per feature module; glob keeps registration automatic.
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    migrations: [__dirname + '/../../migrations/*{.ts,.js}'],
    synchronize: env.DATABASE_SYNCHRONIZE === 'true',
    logging: false,
  };
}

/** CLI datasource for running `typeorm migration:*` commands. */
export const AppDataSource = new DataSource(buildDataSourceOptions());
