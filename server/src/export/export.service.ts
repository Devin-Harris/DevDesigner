import { BadRequestException, Injectable } from '@nestjs/common';
import { generateSql } from '@devdesigner/shared';
import type { SchemaModel, SqlDialect } from '@devdesigner/shared';
import { ProjectsService } from '../projects/projects.service';

/** Dialects the generator currently supports. Grows as generators are added. */
const SUPPORTED_DIALECTS: readonly SqlDialect[] = ['mysql'];

/**
 * Export business logic. Assembles the project's schema (reusing the projects
 * service so graph-assembly lives in one place) and runs the shared, pure SQL
 * generator so server and client emit identical output (BUILD_INSTRUCTIONS.md
 * sections 7 and 9). Access control is deferred to the policy layer with the
 * rest of the app (anonymous phase).
 */
@Injectable()
export class ExportService {
  constructor(private readonly projects: ProjectsService) {}

  async exportSql(
    projectId: string,
    userId: string | null,
    dialectInput?: string,
  ): Promise<string> {
    const dialect = (dialectInput ?? 'mysql').toLowerCase() as SqlDialect;
    if (!SUPPORTED_DIALECTS.includes(dialect)) {
      throw new BadRequestException(
        `Unsupported SQL dialect "${dialectInput}". Supported: ${SUPPORTED_DIALECTS.join(', ')}.`,
      );
    }
    // Authorizes the read; loads only what DDL needs (tables + relationships).
    const { tables, relationships } = await this.projects.getDatabaseSchema(projectId, userId);
    const schema: SchemaModel = {
      tables,
      relationships,
      notes: [],
      elements: [],
      sequenceDiagrams: [],
      lifelines: [],
      sequenceMessages: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    return generateSql(schema, { dialect });
  }
}
