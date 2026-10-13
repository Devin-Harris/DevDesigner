// Compare a desired schema (a DiagramSpec, e.g. parsed from SQL DDL) with a project's
// tables: which tables / columns / relationships to add, change or drop. Pure, so the
// tools can show a dry run and then apply exactly what was shown.

import {
  parseDataType,
  type ColumnModel,
  type DiagramSpec,
  type SchemaModel,
  type SpecColumn,
  type SpecRelationship,
  type SpecTable,
} from '@dbdesigner/shared';
import { formatDataType } from './model';

export interface ColumnChange {
  table: string;
  column: string;
  columnId: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  /** UpdateColumnDto fields to send. */
  patch: Record<string, unknown>;
}

export interface SchemaDiff {
  addTables: SpecTable[];
  dropTables: Array<{ id: string; name: string }>;
  addColumns: Array<{ table: string; tableId: string; column: SpecColumn }>;
  dropColumns: Array<{ table: string; column: string; columnId: string }>;
  changeColumns: ColumnChange[];
  addRelationships: SpecRelationship[];
  dropRelationships: Array<{ id: string; from: string; to: string }>;
}

const low = (s: string): string => s.trim().toLowerCase();
const typeKey = (t: string | undefined): string => low(formatDataType(parseDataType(t)));

function splitRef(ref: string): { table: string; column: string } {
  const i = ref.lastIndexOf('.');
  return { table: ref.slice(0, i).trim(), column: ref.slice(i + 1).trim() };
}

/** Desired column flags with DBDesigner's defaults filled in. */
function desired(c: SpecColumn): Omit<ColumnModel, 'id' | 'note'> {
  const pk = !!c.primaryKey;
  return {
    name: c.name,
    dataType: parseDataType(c.type),
    isPrimaryKey: pk,
    isNullable: pk ? false : (c.nullable ?? true),
    isUnique: !!c.unique,
    isAutoIncrement: !!c.autoIncrement,
    ...(c.default !== undefined ? { defaultValue: c.default } : {}),
  };
}

export function diffSchema(current: SchemaModel, spec: DiagramSpec): SchemaDiff {
  const out: SchemaDiff = {
    addTables: [],
    dropTables: [],
    addColumns: [],
    dropColumns: [],
    changeColumns: [],
    addRelationships: [],
    dropRelationships: [],
  };
  const wantTables = new Map((spec.tables ?? []).map((t) => [low(t.name), t]));
  const haveTables = new Map(current.tables.map((t) => [low(t.name), t]));

  for (const [name, t] of wantTables) {
    const have = haveTables.get(name);
    if (!have) {
      out.addTables.push(t);
      continue;
    }
    const haveCols = new Map(have.columns.map((c) => [low(c.name), c]));
    for (const c of t.columns) {
      const hc = haveCols.get(low(c.name));
      if (!hc) {
        out.addColumns.push({ table: have.name, tableId: have.id, column: c });
        continue;
      }
      const want = desired(c);
      const changes: ColumnChange['changes'] = {};
      const patch: Record<string, unknown> = {};
      if (typeKey(c.type) !== low(formatDataType(hc.dataType))) {
        changes.type = { from: formatDataType(hc.dataType), to: formatDataType(want.dataType) };
        patch.dataType = want.dataType;
      }
      for (const k of ['isPrimaryKey', 'isNullable', 'isUnique', 'isAutoIncrement'] as const) {
        if (want[k] !== hc[k]) {
          changes[k] = { from: hc[k], to: want[k] };
          patch[k] = want[k];
        }
      }
      if (c.default !== undefined && c.default !== (hc.defaultValue ?? undefined)) {
        changes.default = { from: hc.defaultValue ?? null, to: c.default };
        patch.defaultValue = c.default;
      }
      if (Object.keys(patch).length) {
        out.changeColumns.push({ table: have.name, column: hc.name, columnId: hc.id, changes, patch });
      }
    }
    const wantCols = new Set(t.columns.map((c) => low(c.name)));
    for (const hc of have.columns) {
      if (!wantCols.has(low(hc.name))) out.dropColumns.push({ table: have.name, column: hc.name, columnId: hc.id });
    }
  }
  for (const [name, t] of haveTables) {
    if (!wantTables.has(name)) out.dropTables.push({ id: t.id, name: t.name });
  }

  // Relationships, keyed "from->to" on lower-cased table.column names.
  const colName = new Map<string, string>();
  for (const t of current.tables) for (const c of t.columns) colName.set(c.id, `${t.name}.${c.name}`);
  const have = new Map<string, { id: string; from: string; to: string }>();
  for (const r of current.relationships) {
    const from = colName.get(r.sourceColumnId);
    const to = colName.get(r.targetColumnId);
    if (from && to) have.set(`${low(from)}->${low(to)}`, { id: r.id, from, to });
  }
  const want: SpecRelationship[] = [...(spec.relationships ?? [])];
  for (const t of spec.tables ?? []) {
    for (const c of t.columns) {
      if (c.references) want.push({ from: c.references, to: `${t.name}.${c.name}`, type: 'ONE_TO_MANY' });
    }
  }
  const wantKeys = new Set<string>();
  for (const r of want) {
    const a = splitRef(r.from);
    const b = splitRef(r.to);
    const key = `${low(a.table)}.${low(a.column)}->${low(b.table)}.${low(b.column)}`;
    if (wantKeys.has(key)) continue;
    wantKeys.add(key);
    if (!have.has(key)) out.addRelationships.push(r);
  }
  const dropped = new Set(out.dropTables.map((t) => low(t.name)));
  for (const [key, r] of have) {
    if (wantKeys.has(key)) continue;
    // Relationships of dropped tables go with the table.
    if (dropped.has(low(splitRef(r.from).table)) || dropped.has(low(splitRef(r.to).table))) continue;
    out.dropRelationships.push(r);
  }
  return out;
}

/** Compact, readable summary of a diff (for dry runs). */
export function describeDiff(d: SchemaDiff): Record<string, unknown> {
  return {
    addTables: d.addTables.map((t) => `${t.name} (${t.columns.length} columns)`),
    addColumns: d.addColumns.map((c) => `${c.table}.${c.column.name} ${c.column.type ?? 'VARCHAR(255)'}`),
    changeColumns: d.changeColumns.map((c) => ({ column: `${c.table}.${c.column}`, changes: c.changes })),
    addRelationships: d.addRelationships.map((r) => `${r.from} -> ${r.to}`),
    dropTables: d.dropTables.map((t) => t.name),
    dropColumns: d.dropColumns.map((c) => `${c.table}.${c.column}`),
    dropRelationships: d.dropRelationships.map((r) => `${r.from} -> ${r.to}`),
  };
}
