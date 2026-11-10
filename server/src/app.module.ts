import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { SentryModule } from '@sentry/nestjs/setup';
import { LoggerModule } from 'nestjs-pino';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AccessModule } from './access/access.module';
import { AuthModule } from './auth/auth.module';
import { ProjectsModule } from './projects/projects.module';
import { TablesModule } from './tables/tables.module';
import { ColumnsModule } from './columns/columns.module';
import { IndexesModule } from './indexes/indexes.module';
import { RelationshipsModule } from './relationships/relationships.module';
import { ElementsModule } from './elements/elements.module';
import { ImagesModule } from './images/images.module';
import { SequenceModule } from './sequence/sequence.module';
import { NotesModule } from './notes/notes.module';
import { SharingModule } from './sharing/sharing.module';
import { ExportModule } from './export/export.module';
import { RealtimeModule } from './realtime/realtime.module';
import { BatchModule } from './batch/batch.module';
import { UserThemesModule } from './user-themes/user-themes.module';
import { validateEnv } from './config/env.validation';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { RequestContextInterceptor, RequestContextMiddleware } from './common/request-context';
import { loggerParams } from './common/logger.config';

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
    ProjectsModule,
    BatchModule,
    TablesModule,
    ColumnsModule,
    IndexesModule,
    RelationshipsModule,
    ElementsModule,
    ImagesModule,
    SequenceModule,
    NotesModule,
    SharingModule,
    ExportModule,
    RealtimeModule,
    UserThemesModule,
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
