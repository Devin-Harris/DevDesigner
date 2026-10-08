import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
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
          DATABASE_PATH: config.get<string>('DATABASE_PATH', 'dbdesigner.sqlite'),
          SQLITE_DRIVER_PATH: config.get<string>('SQLITE_DRIVER_PATH'),
          // Default on for the current dev phase so the schema auto-creates with
          // no migrations. Set DATABASE_SYNCHRONIZE=false and use migrations
          // before any real deployment.
          DATABASE_SYNCHRONIZE: config.get<string>('DATABASE_SYNCHRONIZE', 'true'),
        } as NodeJS.ProcessEnv),
    }),
  ],
})
export class DatabaseModule {}
