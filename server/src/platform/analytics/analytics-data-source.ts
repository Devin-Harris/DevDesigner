import type { DataSourceOptions } from 'typeorm';
import { TypeOrmLogger } from '../database/typeorm-logger';
import { ANALYTICS_CONNECTION } from './analytics.config';
import { ANALYTICS_ENTITIES } from './analytics.entities';
import { CreateAnalytics1794500000000 } from './migrations/1794500000000-CreateAnalytics';

/**
 * Options for the separate analytics database. Its own SQLite file means its
 * writes (flushes, purges, later rollups) never take the app database's single
 * writer lock, and it can be wiped without touching user data. The schema comes
 * from its own migrations, run on connect; synchronize stays off.
 */
export function buildAnalyticsDataSourceOptions(databasePath: string): DataSourceOptions {
  return {
    name: ANALYTICS_CONNECTION,
    type: 'better-sqlite3',
    database: databasePath,
    entities: ANALYTICS_ENTITIES,
    migrations: [CreateAnalytics1794500000000],
    migrationsTableName: 'analytics_migrations',
    migrationsRun: true,
    synchronize: false,
    logging: ['error', 'warn'],
    logger: new TypeOrmLogger(),
    enableWAL: true,
    prepareDatabase: (db: { pragma: (sql: string) => unknown }) => {
      // Only takes effect on a new, empty file; lets the Phase 4 purge give space back.
      db.pragma('auto_vacuum = INCREMENTAL');
      db.pragma('synchronous = NORMAL');
      db.pragma('busy_timeout = 5000');
      db.pragma('temp_store = MEMORY');
    },
  };
}
