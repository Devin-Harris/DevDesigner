import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AccessModule } from './access/access.module';
import { AuthModule } from './auth/auth.module';
import { ProjectsModule } from './projects/projects.module';
import { TablesModule } from './tables/tables.module';
import { ColumnsModule } from './columns/columns.module';
import { RelationshipsModule } from './relationships/relationships.module';
import { NotesModule } from './notes/notes.module';
import { SharingModule } from './sharing/sharing.module';
import { ExportModule } from './export/export.module';

/**
 * Root module. Feature modules follow the layering in BUILD_INSTRUCTIONS.md
 * section 7: controller (routing + DTO validation only), policy/access layer
 * (authorization), service (business logic + rules), repository (data access).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    DatabaseModule,
    AccessModule,
    HealthModule,
    AuthModule,
    ProjectsModule,
    TablesModule,
    ColumnsModule,
    RelationshipsModule,
    NotesModule,
    SharingModule,
    ExportModule,
  ],
})
export class AppModule {}
