// Dialect-aware SQL generator. Pure and environment-agnostic so the server uses
// it canonically for export and the client calls the exact same code for instant
// previews (see BUILD_INSTRUCTIONS.md section 9). One implementation, no drift.
//
// Only MySQL is implemented today. The signature is designed so generatePostgres
// / generateSQLite can be added behind the `dialect` switch.

export * from './data-type';

import type { SqlDialect } from '../enums';
import type {
  ColumnModel,
  DataType,
  RelationshipModel,
  SchemaModel,
  TableModel,
} from '../models';

export interface GenerateSqlOptions {
  dialect: SqlDialect;
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

// --- Internal shapes used only while generating ------------------------------

/** A resolved foreign key: a column in one table pointing at a column in another. */
interface ForeignKey {
  name: string;
  fkTableId: string;
  fkColumnId: string;
  refTableId: string;
  refColumnId: string;
  onDelete?: string;
  onUpdate?: string;
}

/** Lookup of a column plus the table that owns it. */
interface ColumnLocation {
  table: TableModel;
  column: ColumnModel;
}

// --- Identifier + literal helpers --------------------------------------------

/** Backtick-quote an identifier, escaping embedded backticks by doubling them. */
function quoteIdent(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`';
}

/** Single-quote a string literal, escaping backslashes and single quotes. */
function quoteString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

// Defaults that must be emitted verbatim rather than quoted as strings.
const RAW_DEFAULT_KEYWORDS = new Set([
  'CURRENT_TIMESTAMP',
  'CURRENT_TIMESTAMP()',
  'NOW()',
  'NULL',
  'TRUE',
  'FALSE',
]);

/**
 * Render a column default. Numeric literals and known SQL keywords are emitted
 * verbatim; everything else is treated as a string literal and quoted.
 */
function renderDefault(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    return quoteString('');
  }
  if (RAW_DEFAULT_KEYWORDS.has(trimmed.toUpperCase())) {
    return trimmed.toUpperCase();
  }
  // Plain integer or decimal literal.
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return trimmed;
  }
  return quoteString(trimmed);
}

// --- Data type mapping -------------------------------------------------------

/** Map a shared DataType onto its MySQL column type. */
function mapDataType(dataType: DataType): string {
  const name = (dataType.name ?? '').toUpperCase();
  switch (name) {
    case 'INT':
    case 'BIGINT':
    case 'TEXT':
    case 'DATE':
    case 'DATETIME':
    case 'TIMESTAMP':
    case 'FLOAT':
    case 'JSON':
      return name;
    case 'BOOLEAN':
      return 'TINYINT(1)';
    case 'VARCHAR':
      return `VARCHAR(${dataType.length ?? 255})`;
    case 'DECIMAL': {
      const [precision, scale] = dataType.args ?? [];
      if (precision !== undefined && scale !== undefined) {
        return `DECIMAL(${precision}, ${scale})`;
      }
      if (dataType.length !== undefined) {
        return `DECIMAL(${dataType.length})`;
      }
      return 'DECIMAL(10, 0)';
    }
    case 'ENUM': {
      const members = (dataType.args ?? []).map((member) => quoteString(member));
      // An ENUM with no members is invalid MySQL; leave a hint rather than emit
      // broken DDL the user cannot run.
      return members.length ? `ENUM(${members.join(', ')})` : 'ENUM() /* TODO: add ENUM values */';
    }
    default: {
      // Unknown type: pass the name through, applying a length if one was set.
      const upper = name || 'VARCHAR';
      return dataType.length !== undefined ? `${upper}(${dataType.length})` : upper;
    }
  }
}

/** Numeric types MySQL accepts the UNSIGNED modifier on. */
const NUMERIC_TYPES = new Set(['INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'MEDIUMINT', 'DECIMAL', 'FLOAT', 'DOUBLE']);

/** True for a type name that can be UNSIGNED. */
export function isNumericType(name: string | undefined): boolean {
  return NUMERIC_TYPES.has((name ?? '').toUpperCase());
}

// --- Column + table rendering ------------------------------------------------

/** Render a single column definition line (without trailing comma). */
function renderColumn(column: ColumnModel): string {
  const parts: string[] = [quoteIdent(column.name), mapDataType(column.dataType)];
  if (column.isUnsigned && isNumericType(column.dataType.name)) {
    parts.push('UNSIGNED');
  }

  // Primary-key columns are implicitly NOT NULL in MySQL; make it explicit.
  const notNull = column.isPrimaryKey || !column.isNullable;
  if (notNull) {
    parts.push('NOT NULL');
  }
  if (column.isAutoIncrement) {
    parts.push('AUTO_INCREMENT');
  }
  if (column.defaultValue !== undefined && column.defaultValue !== '') {
    parts.push(`DEFAULT ${renderDefault(column.defaultValue)}`);
  }
  // A UNIQUE clause on a PK column is redundant with PRIMARY KEY, so skip it.
  if (column.isUnique && !column.isPrimaryKey) {
    parts.push('UNIQUE');
  }
  return parts.join(' ');
}

/** Build a `CONSTRAINT ... FOREIGN KEY ...` clause body for a resolved FK. */
function renderForeignKey(
  fk: ForeignKey,
  locate: (columnId: string) => ColumnLocation | undefined,
  tablesById: Map<string, TableModel>,
): string | null {
  const fkCol = locate(fk.fkColumnId);
  const refLoc = locate(fk.refColumnId);
  const refTable = tablesById.get(fk.refTableId);
  if (!fkCol || !refLoc || !refTable) {
    return null;
  }
  const clause =
    `CONSTRAINT ${quoteIdent(fk.name)} FOREIGN KEY (${quoteIdent(fkCol.column.name)}) ` +
    `REFERENCES ${quoteIdent(refTable.name)} (${quoteIdent(refLoc.column.name)})`;
  const actions: string[] = [];
  if (fk.onDelete) {
    actions.push(`ON DELETE ${fk.onDelete.toUpperCase()}`);
  }
  if (fk.onUpdate) {
    actions.push(`ON UPDATE ${fk.onUpdate.toUpperCase()}`);
  }
  return actions.length ? `${clause} ${actions.join(' ')}` : clause;
}

/** Render one CREATE TABLE statement, optionally embedding inline foreign keys. */
function renderCreateTable(
  table: TableModel,
  inlineForeignKeys: ForeignKey[],
  locate: (columnId: string) => ColumnLocation | undefined,
  tablesById: Map<string, TableModel>,
): string {
  const lines: string[] = table.columns.map((column) => `  ${renderColumn(column)}`);

  const pkColumns = table.columns.filter((column) => column.isPrimaryKey);
  if (pkColumns.length) {
    const pkList = pkColumns.map((column) => quoteIdent(column.name)).join(', ');
    lines.push(`  PRIMARY KEY (${pkList})`);
  }

  for (const fk of inlineForeignKeys) {
    const clause = renderForeignKey(fk, locate, tablesById);
    if (clause) {
      lines.push(`  ${clause}`);
    }
  }

  return `CREATE TABLE ${quoteIdent(table.name)} (\n${lines.join(',\n')}\n);`;
}

/**
 * Render a table's secondary indexes as standalone CREATE INDEX / CREATE UNIQUE
 * INDEX statements. Indexes covering no (still-present) column are skipped.
 */
function renderCreateIndexes(table: TableModel): string[] {
  if (!table.indexes?.length) {
    return [];
  }
  const columnById = new Map(table.columns.map((c) => [c.id, c]));
  const statements: string[] = [];
  for (const index of [...table.indexes].sort((a, b) => a.name.localeCompare(b.name))) {
    const cols = index.columnIds
      .map((id) => columnById.get(id))
      .filter((c): c is ColumnModel => Boolean(c));
    if (!cols.length) {
      continue;
    }
    const unique = index.isUnique ? 'UNIQUE ' : '';
    const colList = cols.map((c) => quoteIdent(c.name)).join(', ');
    statements.push(
      `CREATE ${unique}INDEX ${quoteIdent(index.name)} ON ${quoteIdent(table.name)} (${colList});`,
    );
  }
  return statements;
}

/** Render a deferred foreign key as a standalone ALTER TABLE statement. */
function renderAlterTableForeignKey(
  fk: ForeignKey,
  locate: (columnId: string) => ColumnLocation | undefined,
  tablesById: Map<string, TableModel>,
): string | null {
  const fkTable = tablesById.get(fk.fkTableId);
  if (!fkTable) {
    return null;
  }
  const clause = renderForeignKey(fk, locate, tablesById);
  if (!clause) {
    return null;
  }
  return `ALTER TABLE ${quoteIdent(fkTable.name)} ADD ${clause};`;
}

// --- Relationship resolution -------------------------------------------------

/**
 * Turn relationships into concrete foreign keys, and synthesize junction tables
 * for MANY_TO_MANY. UI convention (see connectors.helper): for ONE_TO_MANY the
 * source is the "one" side and the target is the "many" side, so the FK lives on
 * the target and references the source. ONE_TO_ONE places the FK on the target
 * as well. MANY_TO_MANY cannot be a single FK, so a junction table is generated.
 */
function resolveRelationships(
  relationships: RelationshipModel[],
  locate: (columnId: string) => ColumnLocation | undefined,
): { foreignKeys: ForeignKey[]; junctionTables: TableModel[] } {
  const foreignKeys: ForeignKey[] = [];
  const junctionTables: TableModel[] = [];
  const usedNames = new Set<string>();

  const uniqueFkName = (base: string): string => {
    let name = base;
    let n = 2;
    while (usedNames.has(name)) {
      name = `${base}_${n++}`;
    }
    usedNames.add(name);
    return name;
  };

  // Deterministic order so output diffs cleanly.
  const ordered = [...relationships].sort((a, b) => a.id.localeCompare(b.id));

  for (const rel of ordered) {
    const source = locate(rel.sourceColumnId);
    const target = locate(rel.targetColumnId);
    if (!source || !target) {
      continue; // dangling endpoint; skip rather than emit invalid SQL
    }

    if (rel.type === 'MANY_TO_MANY') {
      junctionTables.push(buildJunctionTable(rel, source, target));
      continue;
    }

    // FK on the target (many / dependent) side referencing the source (one) side.
    const base = `fk_${target.table.name}_${target.column.name}`;
    foreignKeys.push({
      name: uniqueFkName(base),
      fkTableId: target.table.id,
      fkColumnId: target.column.id,
      refTableId: source.table.id,
      refColumnId: source.column.id,
      onDelete: rel.onDelete,
      onUpdate: rel.onUpdate,
    });
  }

  return { foreignKeys, junctionTables };
}

/** Build a junction table model for a MANY_TO_MANY relationship. */
function buildJunctionTable(
  rel: RelationshipModel,
  source: ColumnLocation,
  target: ColumnLocation,
): TableModel {
  const tableName = `${source.table.name}_${target.table.name}`;
  const sourceCol: ColumnModel = {
    id: `${rel.id}__src`,
    name: `${source.table.name}_${source.column.name}`,
    dataType: { ...source.column.dataType },
    isPrimaryKey: true,
    isNullable: false,
    isUnique: false,
    isAutoIncrement: false,
  };
  const targetCol: ColumnModel = {
    id: `${rel.id}__tgt`,
    name: `${target.table.name}_${target.column.name}`,
    dataType: { ...target.column.dataType },
    isPrimaryKey: true,
    isNullable: false,
    isUnique: false,
    isAutoIncrement: false,
  };
  return {
    id: `__junction__${rel.id}`,
    name: tableName,
    columns: [sourceCol, targetCol],
    x: 0,
    y: 0,
  };
}

// --- Topological ordering ----------------------------------------------------

/**
 * Order tables so a referenced table precedes the tables that depend on it.
 * Uses Kahn's algorithm with alphabetical tie-breaking for deterministic output.
 * Tables left over from a dependency cycle are appended alphabetically; callers
 * decide per-FK whether it can be inline (referenced table comes first) or must
 * be deferred to an ALTER TABLE.
 */
function orderTables(tables: TableModel[], foreignKeys: ForeignKey[]): TableModel[] {
  const byId = new Map(tables.map((t) => [t.id, t]));
  const inDegree = new Map<string, number>(tables.map((t) => [t.id, 0]));
  const dependents = new Map<string, string[]>(tables.map((t) => [t.id, []]));

  for (const fk of foreignKeys) {
    // Edge: referenced table -> dependent (FK) table. Ignore self-references
    // (they never constrain ordering) and edges to unknown tables.
    if (
      fk.refTableId === fk.fkTableId ||
      !byId.has(fk.refTableId) ||
      !byId.has(fk.fkTableId)
    ) {
      continue;
    }
    dependents.get(fk.refTableId)!.push(fk.fkTableId);
    inDegree.set(fk.fkTableId, (inDegree.get(fk.fkTableId) ?? 0) + 1);
  }

  const ready = tables
    .filter((t) => (inDegree.get(t.id) ?? 0) === 0)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => t.id);

  const order: string[] = [];
  const seen = new Set<string>();
  while (ready.length) {
    const id = ready.shift()!;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    order.push(id);
    const next = [...dependents.get(id)!].sort((a, b) =>
      byId.get(a)!.name.localeCompare(byId.get(b)!.name),
    );
    for (const dep of next) {
      inDegree.set(dep, (inDegree.get(dep) ?? 0) - 1);
      if ((inDegree.get(dep) ?? 0) === 0) {
        ready.push(dep);
      }
    }
  }

  // Any tables still unseen are part of a cycle; append them alphabetically.
  const leftovers = tables
    .filter((t) => !seen.has(t.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => t.id);

  return [...order, ...leftovers].map((id) => byId.get(id)!);
}

// --- Public generator --------------------------------------------------------

/**
 * Generate MySQL DDL from a schema model. Deterministic: table order is a stable
 * topological sort and every list is sorted, so exports diff cleanly.
 */
export function generateMySQL(schema: SchemaModel): string {
  const baseTables = schema.tables;
  const columnIndex = new Map<string, ColumnLocation>();
  for (const table of baseTables) {
    for (const column of table.columns) {
      columnIndex.set(column.id, { table, column });
    }
  }

  const { foreignKeys, junctionTables } = resolveRelationships(
    schema.relationships,
    (id) => columnIndex.get(id),
  );

  // Junction tables contribute their own columns to the location index and their
  // own foreign keys back to the two endpoints.
  const junctionForeignKeys: ForeignKey[] = [];
  for (const junction of junctionTables) {
    for (const column of junction.columns) {
      columnIndex.set(column.id, { table: junction, column });
    }
  }

  const allTables = [...baseTables, ...junctionTables];
  const tablesById = new Map(allTables.map((t) => [t.id, t]));

  // Build junction FKs now that all tables are known. Each junction column
  // references the endpoint column it was derived from.
  for (const junction of junctionTables) {
    const relId = junction.id.replace('__junction__', '');
    const [srcCol, tgtCol] = junction.columns;
    const rel = schema.relationships.find((r) => r.id === relId);
    if (!rel) {
      continue;
    }
    const src = columnIndex.get(rel.sourceColumnId);
    const tgt = columnIndex.get(rel.targetColumnId);
    if (src) {
      junctionForeignKeys.push({
        name: `fk_${junction.name}_${srcCol.name}`,
        fkTableId: junction.id,
        fkColumnId: srcCol.id,
        refTableId: src.table.id,
        refColumnId: src.column.id,
        onDelete: rel.onDelete,
        onUpdate: rel.onUpdate,
      });
    }
    if (tgt) {
      junctionForeignKeys.push({
        name: `fk_${junction.name}_${tgtCol.name}`,
        fkTableId: junction.id,
        fkColumnId: tgtCol.id,
        refTableId: tgt.table.id,
        refColumnId: tgt.column.id,
        onDelete: rel.onDelete,
        onUpdate: rel.onUpdate,
      });
    }
  }

  const allForeignKeys = [...foreignKeys, ...junctionForeignKeys];
  const ordered = orderTables(allTables, allForeignKeys);
  const position = new Map(ordered.map((t, i) => [t.id, i]));

  // Decide inline vs deferred per FK. An FK is inline-safe when its referenced
  // table is created before (or is) its own table; otherwise defer to ALTER.
  const inlineByTable = new Map<string, ForeignKey[]>();
  const deferred: ForeignKey[] = [];
  for (const fk of allForeignKeys) {
    const fkPos = position.get(fk.fkTableId);
    const refPos = position.get(fk.refTableId);
    if (fkPos === undefined || refPos === undefined) {
      continue;
    }
    const inlineSafe = fk.refTableId === fk.fkTableId || refPos < fkPos;
    if (inlineSafe) {
      const list = inlineByTable.get(fk.fkTableId) ?? [];
      list.push(fk);
      inlineByTable.set(fk.fkTableId, list);
    } else {
      deferred.push(fk);
    }
  }

  const locate = (id: string) => columnIndex.get(id);
  const statements: string[] = [];

  for (const table of ordered) {
    const inline = (inlineByTable.get(table.id) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    statements.push(renderCreateTable(table, inline, locate, tablesById));
    statements.push(...renderCreateIndexes(table));
  }

  if (deferred.length) {
    statements.push('-- Foreign keys deferred to break dependency cycles.');
    for (const fk of deferred.sort((a, b) => a.name.localeCompare(b.name))) {
      const stmt = renderAlterTableForeignKey(fk, locate, tablesById);
      if (stmt) {
        statements.push(stmt);
      }
    }
  }

  return statements.join('\n\n') + '\n';
}
