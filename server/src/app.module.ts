import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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

/**
 * Root module. Feature modules follow the layering in BUILD_INSTRUCTIONS.md
 * section 7: controller (routing + DTO validation only), policy/access layer
 * (authorization), service (business logic + rules), repository (data access).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    EventEmitterModule.forRoot(),
    DatabaseModule,
    AccessModule,
    HealthModule,
    AuthModule,
    ProjectsModule,
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
  ],
})
export class AppModule {}
