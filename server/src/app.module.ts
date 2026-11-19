import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DatabaseModule } from './platform/database/database.module';
import { HealthModule } from './platform/health/health.module';
import { DesktopModule } from './platform/desktop/desktop.module';
import { SyncModule } from './platform/sync/sync.module';
import { AccessModule } from './collaboration/access/access.module';
import { AuthModule } from './identity/auth/auth.module';
import { ProjectsModule } from './projects/projects/projects.module';
import { TablesModule } from './projects/schema/tables/tables.module';
import { ColumnsModule } from './projects/schema/columns/columns.module';
import { IndexesModule } from './projects/schema/indexes/indexes.module';
import { RelationshipsModule } from './projects/schema/relationships/relationships.module';
import { ElementsModule } from './projects/canvas/elements/elements.module';
import { ImagesModule } from './projects/canvas/images/images.module';
import { SequenceModule } from './projects/canvas/sequence/sequence.module';
import { SharingModule } from './collaboration/sharing/sharing.module';
import { ExportModule } from './projects/export/export.module';
import { RealtimeModule } from './platform/realtime/realtime.module';
import { BatchModule } from './projects/batch/batch.module';
import { UserThemesModule } from './identity/user-themes/user-themes.module';
import { AdminModule } from './identity/admin/admin.module';
import { ThrottleModule } from './platform/throttle/throttle.module';
import { QuotasModule } from './platform/quotas/quotas.module';
import { GraphCacheModule } from './platform/graph-cache/graph-cache.module';
import { validateEnv } from './platform/config/env.validation';
import { AllExceptionsFilter } from './platform/http/all-exceptions.filter';
import {
  RequestContextInterceptor,
  RequestContextMiddleware,
} from './platform/http/request-context';
import { loggerParams } from './platform/http/logger.config';
import { AnalyticsModule } from './platform/analytics/analytics.module';
import { AnalyticsMiddleware } from './platform/analytics/analytics-request';
import { sentryEnabled } from './instrument';

/** Only pull in the Sentry Nest integration when the SDK was initialised (instrument.ts). */
const sentryModules = sentryEnabled
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    [
      (
        require('@sentry/nestjs/setup') as typeof import('@sentry/nestjs/setup')
      ).SentryModule.forRoot(),
    ]
  : [];

/**
 * Root module. Feature modules follow the layering in BUILD_INSTRUCTIONS.md
 * section 7: controller (routing + DTO validation only), policy/access layer
 * (authorization), service (business logic + rules), repository (data access).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env', validate: validateEnv }),
    ...sentryModules,
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => loggerParams(config),
    }),
    EventEmitterModule.forRoot(),
    DatabaseModule,
    AnalyticsModule.forRoot(),
    AccessModule,
    HealthModule,
    DesktopModule,
    SyncModule,
    AuthModule,
    ThrottleModule,
    QuotasModule,
    GraphCacheModule,
    ProjectsModule,
    BatchModule,
    TablesModule,
    ColumnsModule,
    IndexesModule,
    RelationshipsModule,
    ElementsModule,
    ImagesModule,
    SequenceModule,
    SharingModule,
    ExportModule,
    RealtimeModule,
    UserThemesModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // In this order: the analytics facts live on the request context.
    consumer.apply(RequestContextMiddleware, AnalyticsMiddleware).forRoutes('{*path}');
  }
}
