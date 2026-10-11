// Pure schema validation shared by client (inline warnings), server and the MCP
// server. See BUILD_INSTRUCTIONS.md section 10. Returns structured issues so
// callers can surface them against a target entity.

import type { SchemaModel } from '../models';

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: ValidationSeverity;
  message: string;
  /** Id of the offending entity (table, column, relationship, lifeline or message). */
  targetId: string;
}

/** Letters, digits and underscore, not starting with a digit. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Type names that count as compatible across a foreign key (integers with integers, etc.). */
const TYPE_FAMILY: Record<string, string> = {
  INT: 'int',
  INTEGER: 'int',
  BIGINT: 'int',
  SMALLINT: 'int',
  TINYINT: 'int',
  VARCHAR: 'text',
  CHAR: 'text',
  TEXT: 'text',
  DECIMAL: 'num',
  FLOAT: 'num',
  DOUBLE: 'num',
  DATE: 'time',
  DATETIME: 'time',
  TIMESTAMP: 'time',
};

function family(typeName: string): string {
  const name = typeName.toUpperCase();
  return TYPE_FAMILY[name] ?? name;
}

/**
 * Validate a schema model and return structured issues.
 *
 * Rules: every table has a name and at least one column; table names are unique
 * (case-insensitive) and valid identifiers; column names are unique per table;
 * warn when a table has no primary key; relationship endpoints exist, are not a
 * column related to itself, are type-compatible, and are not duplicated; indexes
 * only reference the table's own columns; sequence messages reference lifelines
 * in their own diagram.
 */
export function validateSchema(schema: SchemaModel): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (severity: ValidationSeverity, targetId: string, message: string): void => {
    issues.push({ severity, targetId, message });
  };

  const columnById = new Map<string, { tableName: string; name: string; type: string }>();
  const tableNames = new Map<string, string>();

  for (const table of schema.tables) {
    const label = table.name.trim() || '(unnamed table)';
    if (!table.name.trim()) {
      add('error', table.id, 'A table has no name.');
    } else {
      if (!IDENTIFIER.test(table.name)) {
        add('warning', table.id, `Table "${table.name}" is not a plain SQL identifier.`);
      }
      const key = table.name.trim().toLowerCase();
      if (tableNames.has(key)) {
        add('error', table.id, `Table name "${table.name}" is used more than once.`);
      }
      tableNames.set(key, table.id);
    }
    if (table.columns.length === 0) {
      add('error', table.id, `Table "${label}" has no columns.`);
    } else if (!table.columns.some((c) => c.isPrimaryKey)) {
      add('warning', table.id, `Table "${label}" has no primary key.`);
    }
    const seen = new Set<string>();
    for (const column of table.columns) {
      columnById.set(column.id, {
        tableName: label,
        name: column.name,
        type: column.dataType.name,
      });
      if (!column.name.trim()) {
        add('error', column.id, `A column in "${label}" has no name.`);
        continue;
      }
      if (!IDENTIFIER.test(column.name)) {
        add('warning', column.id, `Column "${label}.${column.name}" is not a plain SQL identifier.`);
      }
      const key = column.name.toLowerCase();
      if (seen.has(key)) {
        add('error', column.id, `Column "${label}.${column.name}" is defined more than once.`);
      }
      seen.add(key);
    }
    const ownColumns = new Set(table.columns.map((c) => c.id));
    for (const index of table.indexes ?? []) {
      if (index.columnIds.length === 0) {
        add('warning', index.id, `Index "${index.name}" on "${label}" covers no columns.`);
      }
      if (index.columnIds.some((id) => !ownColumns.has(id))) {
        add('error', index.id, `Index "${index.name}" on "${label}" references a missing column.`);
      }
    }
  }

  const pairs = new Set<string>();
  for (const rel of schema.relationships) {
    const source = columnById.get(rel.sourceColumnId);
    const target = columnById.get(rel.targetColumnId);
    if (!source || !target) {
      add('error', rel.id, 'A relationship points at a column that no longer exists.');
      continue;
    }
    const name = `${source.tableName}.${source.name} -> ${target.tableName}.${target.name}`;
    if (rel.sourceColumnId === rel.targetColumnId) {
      add('error', rel.id, `Relationship ${name} connects a column to itself.`);
    }
    const pair = `${rel.sourceColumnId}>${rel.targetColumnId}`;
    if (pairs.has(pair)) {
      add('warning', rel.id, `Relationship ${name} is duplicated.`);
    }
    pairs.add(pair);
    if (family(source.type) !== family(target.type)) {
      add(
        'warning',
        rel.id,
        `Relationship ${name} joins different types (${source.type} vs ${target.type}).`,
      );
    }
  }

  const lifelineDiagram = new Map(schema.lifelines.map((l) => [l.id, l.diagramId]));
  for (const message of schema.sequenceMessages) {
    const from = lifelineDiagram.get(message.fromLifelineId);
    const to = lifelineDiagram.get(message.toLifelineId);
    if (from === undefined || to === undefined) {
      add('error', message.id, `Message "${message.label ?? ''}" references a missing participant.`);
    } else if (
      message.style !== 'break' &&
      message.fromLifelineId === message.toLifelineId
    ) {
      add('error', message.id, `Message "${message.label ?? ''}" starts and ends on the same participant.`);
    } else if (from !== message.diagramId || to !== message.diagramId) {
      add('error', message.id, `Message "${message.label ?? ''}" crosses sequence diagrams.`);
    }
  }

  return issues;
}
