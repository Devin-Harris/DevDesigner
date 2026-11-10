import { BadRequestException, Injectable } from '@nestjs/common';
import { generateSql } from '@devdesigner/shared';
import type { SchemaModel, SqlDialect } from '@devdesigner/shared';
import { GraphLoaderService } from '../projects/graph-loader.service';

/** Dialects the generator currently supports. Grows as generators are added. */
const SUPPORTED_DIALECTS: readonly SqlDialect[] = ['mysql'];

/**
 * Export business logic. Reads the project's schema through GraphLoaderService
 * (graph assembly lives in one place) and runs the shared, pure SQL
 * generator so server and client emit identical output (BUILD_INSTRUCTIONS.md
 * sections 7 and 9). The route declares `@RequiresAccess('read')`.
 */
@Injectable()
export class ExportService {
  constructor(private readonly graphs: GraphLoaderService) {}

  async exportSql(projectId: string, dialectInput?: string): Promise<string> {
    const dialect = (dialectInput ?? 'mysql').toLowerCase() as SqlDialect;
    if (!SUPPORTED_DIALECTS.includes(dialect)) {
      throw new BadRequestException(
        `Unsupported SQL dialect "${dialectInput}". Supported: ${SUPPORTED_DIALECTS.join(', ')}.`,
      );
    }
    // The route guard authorized the read; load only what DDL needs (tables + relationships).
    const { tables, relationships } = await this.graphs.databaseSchema(projectId);
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
