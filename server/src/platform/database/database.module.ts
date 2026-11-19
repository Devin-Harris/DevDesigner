import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { adoptSynchronizedDatabase } from './adopt-synchronized-database';
import { buildDataSourceOptions } from './data-source';

/**
 * Wires TypeORM to the SQLite application database. Feature modules register
 * their own entities via TypeOrmModule.forFeature([...]).
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        buildDataSourceOptions({
          DATABASE_PATH: config.get<string>('DATABASE_PATH', 'devdesigner.sqlite'),
          // Synchronize (default) or migrations: see docs/database-migrations.md.
          DATABASE_SYNCHRONIZE: config.get<string>('DATABASE_SYNCHRONIZE', 'true'),
          DATABASE_MIGRATIONS_RUN: config.get<string>('DATABASE_MIGRATIONS_RUN', 'false'),
          SLOW_QUERY_MS: String(config.get<number>('SLOW_QUERY_MS', 200)),
        } as NodeJS.ProcessEnv),
      // With migrations on, a database created by synchronize is adopted first (its
      // migrations recorded as applied) so the baseline never re-creates existing tables.
      dataSourceFactory: async (options?: DataSourceOptions) => {
        if (!options) throw new Error('No data source options');
        const dataSource = new DataSource({ ...options, migrationsRun: false });
        await dataSource.initialize();
        if (options.migrationsRun) {
          await adoptSynchronizedDatabase(dataSource);
          await dataSource.runMigrations({ transaction: 'each' });
        }
        return dataSource;
      },
    }),
  ],
})
export class DatabaseModule {}
