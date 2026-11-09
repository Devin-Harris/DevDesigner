import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

/**
 * Export: generates SQL via the shared pure generator (@devdesigner/shared/sql)
 * and returns it as text for the selected dialect.
 *
 * Layers (section 7): ExportController (routing + DTO validation only) ->
 * ExportService (business logic, reuses ProjectsService for schema assembly and
 * will call the policy layer once auth/sharing land). Imports ProjectsModule so
 * graph-assembly is not duplicated.
 */
@Module({
  imports: [ProjectsModule],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
