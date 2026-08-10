// Dialect-aware SQL generator. Pure and environment-agnostic so the server uses
// it canonically for export and the client calls the exact same code for instant
// previews (see BUILD_INSTRUCTIONS.md section 9). One implementation, no drift.
//
// Only MySQL is implemented (in a later phase). The signature is designed so
// generatePostgres / generateSQLite can be added behind the `dialect` switch.

import type { SqlDialect } from '../enums';
import type { SchemaModel } from '../models';

export interface GenerateSqlOptions {
  dialect: SqlDialect;
}

/**
 * Generate MySQL DDL from a schema model.
 *
 * Implemented in Phase 4. Requirements: backtick-quoted identifiers, data-type
 * mapping, column clauses (NOT NULL / AUTO_INCREMENT / DEFAULT / UNIQUE),
 * PRIMARY KEY incl. composite, foreign keys from relationships with ON DELETE /
 * ON UPDATE, topological table ordering (ALTER TABLE fallback for cycles), and
 * deterministic output.
 */
export function generateMySQL(_schema: SchemaModel): string {
  throw new Error('generateMySQL not implemented yet (Phase 4).');
}

/** Dialect dispatch entry point. Only MySQL is wired today. */
export function generateSql(schema: SchemaModel, options: GenerateSqlOptions): string {
  switch (options.dialect) {
    case 'mysql':
      return generateMySQL(schema);
    default:
      throw new Error(`SQL dialect "${options.dialect}" is not supported yet.`);
  }
}
