import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { SentryModule } from '@sentry/nestjs/setup';
import { LoggerModule } from 'nestjs-pino';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DatabaseModule } from './platform/database/database.module';
import { HealthModule } from './platform/health/health.module';
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
import { AdminModule } from './admin/admin.module';
import { ThrottleModule } from './platform/throttle/throttle.module';
import { QuotasModule } from './platform/quotas/quotas.module';
import { GraphCacheModule } from './platform/graph-cache/graph-cache.module';
import { validateEnv } from './platform/config/env.validation';
import { AllExceptionsFilter } from './platform/http/all-exceptions.filter';
import { RequestContextInterceptor, RequestContextMiddleware } from './platform/http/request-context';
import { loggerParams } from './platform/http/logger.config';

/**
 * Root module. Feature modules follow the layering in BUILD_INSTRUCTIONS.md
 * section 7: controller (routing + DTO validation only), policy/access layer
 * (authorization), service (business logic + rules), repository (data access).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env', validate: validateEnv }),
    SentryModule.forRoot(),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => loggerParams(config),
    }),
    EventEmitterModule.forRoot(),
    DatabaseModule,
    AccessModule,
    HealthModule,
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
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
