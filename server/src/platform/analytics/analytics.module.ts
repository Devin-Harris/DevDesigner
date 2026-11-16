import { DynamicModule, Global, Module, type Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityTouchService } from './activity-touch.service';
import { AnalyticsRollupService } from './analytics-rollup.service';
import { buildAnalyticsDataSourceOptions } from './analytics-data-source';
import { AnalyticsInterceptor, AnalyticsMiddleware, AnalyticsRequestRecorder } from './analytics-request';
import { ANALYTICS_CONNECTION, analyticsConfig, analyticsEnabled } from './analytics.config';
import { AnalyticsListeners } from './analytics.listeners';
import { ANALYTICS_CONFIG, AnalyticsService } from './analytics.service';
import { ANALYTICS_SINKS } from './analytics.types';
import { DbAnalyticsSink } from './sinks/db.sink';
import { TelemetryController } from './telemetry.controller';

/**
 * First-party analytics, Phase 1 (audit 04): request capture, mutation-bus
 * counters, domain events, activity touches and the client beacon, written to a
 * separate `analytics.sqlite` through the 'analytics' TypeORM connection.
 *
 * Feature code depends only on `track()` (./track) and the shared event catalog;
 * nothing imports this module's services. With ANALYTICS_ENABLED=false the
 * analytics connection is never opened and every capture path is a no-op.
 */
@Global()
@Module({})
export class AnalyticsModule {
  static forRoot(env: Record<string, unknown> = process.env): DynamicModule {
    const enabled = analyticsEnabled(env);
    const configProvider: Provider = {
      provide: ANALYTICS_CONFIG,
      inject: [ConfigService],
      // `enabled` is fixed here (it decides whether the analytics connection exists).
      useFactory: (config: ConfigService) => ({
        ...analyticsConfig(
          Object.fromEntries(
            [
              'ANALYTICS_ENABLED',
              'ANALYTICS_DATABASE_PATH',
              'ANALYTICS_SALT_SECRET',
              'ANALYTICS_GET_SAMPLE',
              'SLOW_REQUEST_MS',
              'ANALYTICS_RAW_RETENTION_DAYS',
              'DATABASE_PATH',
            ].map((key) => [key, config.get(key)]),
          ),
        ),
        enabled,
      }),
    };
    const sinks: Provider = enabled
      ? { provide: ANALYTICS_SINKS, inject: [DbAnalyticsSink], useFactory: (db: DbAnalyticsSink) => [db] }
      : { provide: ANALYTICS_SINKS, useValue: [] };
    return {
      module: AnalyticsModule,
      imports: enabled
        ? [
            TypeOrmModule.forRootAsync({
              name: ANALYTICS_CONNECTION,
              imports: [ConfigModule],
              inject: [ConfigService],
              useFactory: (config: ConfigService) =>
                buildAnalyticsDataSourceOptions(
                  analyticsConfig({
                    ANALYTICS_DATABASE_PATH: config.get('ANALYTICS_DATABASE_PATH'),
                    DATABASE_PATH: config.get('DATABASE_PATH'),
                  }).databasePath,
                ),
            }),
          ]
        : [],
      controllers: [TelemetryController],
      providers: [
        configProvider,
        ...(enabled ? [DbAnalyticsSink] : []),
        sinks,
        AnalyticsService,
        ActivityTouchService,
        AnalyticsRollupService,
        AnalyticsRequestRecorder,
        AnalyticsMiddleware,
        AnalyticsListeners,
        { provide: APP_INTERCEPTOR, useClass: AnalyticsInterceptor },
      ],
      exports: [AnalyticsService, ActivityTouchService, AnalyticsRollupService, AnalyticsMiddleware, AnalyticsRequestRecorder],
    };
  }
}
