import { Controller, Get, Header, Query } from '@nestjs/common';
import { ExportService } from './export.service';
import { ProjectAccess, RequiresAccess, type ResolvedProjectAccess } from '../access/access-policy';

/**
 * Export routes (BUILD_INSTRUCTIONS.md section 5). The controller only parses
 * input and delegates; the service assembles the schema and runs the shared SQL
 * generator. Returns the generated DDL as plain text so the client can preview,
 * copy, or download it.
 */
@Controller('projects')
export class ExportController {
  constructor(private readonly exporter: ExportService) {}

  @Get(':projectId/export')
  @RequiresAccess('read')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  exportSql(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Query('dialect') dialect?: string,
  ): Promise<string> {
    return this.exporter.exportSql(projectId, dialect);
  }
}
