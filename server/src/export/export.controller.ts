import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ExportService } from './export.service';
import { CurrentUserId } from '../auth/current-user.decorator';

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
  @Header('Content-Type', 'text/plain; charset=utf-8')
  exportSql(
    @Param('projectId') projectId: string,
    @CurrentUserId() userId: string | null,
    @Query('dialect') dialect?: string,
  ): Promise<string> {
    return this.exporter.exportSql(projectId, userId, dialect);
  }
}
