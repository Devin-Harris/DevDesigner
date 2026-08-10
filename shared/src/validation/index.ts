// Pure schema validation shared by client (inline warnings) and server (enforced
// before export or mutation). See BUILD_INSTRUCTIONS.md section 10. Returns
// structured issues so both sides can surface them against a target entity.

import type { SchemaModel } from '../models';

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: ValidationSeverity;
  message: string;
  /** Id of the offending entity (table, column, or relationship). */
  targetId: string;
}

/**
 * Validate a schema model and return structured issues.
 *
 * Implemented in Phase 7. Rules: every table has a name and >= 1 column; table
 * names unique per project and valid identifiers; column names unique per table;
 * warn when a table has no primary key; relationship endpoints exist and are
 * type-compatible; no duplicate relationships between the same column pair.
 */
export function validateSchema(_schema: SchemaModel): ValidationIssue[] {
  return [];
}
