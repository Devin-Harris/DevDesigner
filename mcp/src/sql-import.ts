// A forgiving SQL DDL reader: CREATE TABLE / ALTER TABLE ... ADD (column | FOREIGN KEY)
// from PostgreSQL, MySQL, SQLite or SQL Server dumps, turned into a DiagramSpec. It
// only needs to understand structure (tables, columns, keys, references), so anything
// else (indexes, views, CHECKs, storage options) is skipped and counted.

import type { DiagramSpec, SpecColumn, SpecRelationship, SpecTable } from '@dbdesigner/shared';

export interface ParsedSql {
  spec: Required<Pick<DiagramSpec, 'tables' | 'relationships'>>;
  /** Statements that were not CREATE TABLE / ALTER TABLE ADD (first words). */
  skipped: string[];
  warnings: string[];
}

type Tok = { t: 'word' | 'ident' | 'str' | 'num' | 'sym'; v: string };

/** Split into tokens; quoted identifiers ("x", `x`, [x]) keep their exact text. */
function tokenize(sql: string): Tok[] {
  const out: Tok[] = [];
  const re =
    /\s+|--[^\n]*|\/\*[\s\S]*?\*\/|"((?:[^"]|"")*)"|`((?:[^`]|``)*)`|\[([^\]]*)\]|'((?:[^']|'')*)'|(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_$]*)|(::|[(),;.=+\-*/<>!%])|(\S)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    if (m[1] !== undefined) out.push({ t: 'ident', v: m[1].replace(/""/g, '"') });
    else if (m[2] !== undefined) out.push({ t: 'ident', v: m[2].replace(/``/g, '`') });
    else if (m[3] !== undefined) out.push({ t: 'ident', v: m[3] });
    else if (m[4] !== undefined) out.push({ t: 'str', v: m[4].replace(/''/g, "'") });
    else if (m[5] !== undefined) out.push({ t: 'num', v: m[5] });
    else if (m[6] !== undefined) out.push({ t: 'word', v: m[6] });
    else if (m[7] !== undefined) out.push({ t: 'sym', v: m[7] });
    else if (m[8] !== undefined) out.push({ t: 'sym', v: m[8] });
  }
  return out;
}

const up = (t: Tok | undefined): string => (t && t.t === 'word' ? t.v.toUpperCase() : '');
const isName = (t: Tok | undefined): boolean => !!t && (t.t === 'word' || t.t === 'ident');

/** Split a token list on a symbol at paren depth 0. */
function splitTop(toks: Tok[], sym: string): Tok[][] {
  const parts: Tok[][] = [];
  let cur: Tok[] = [];
  let depth = 0;
  for (const tk of toks) {
    if (tk.t === 'sym' && tk.v === '(') depth += 1;
    if (tk.t === 'sym' && tk.v === ')') depth -= 1;
    if (depth === 0 && tk.t === 'sym' && tk.v === sym) {
      if (cur.length) parts.push(cur);
      cur = [];
    } else cur.push(tk);
  }
  if (cur.length) parts.push(cur);
  return parts;
}

/** Read a possibly schema-qualified name at `i`; returns the last part. */
function readName(toks: Tok[], i: number): { name: string; next: number } | null {
  if (!isName(toks[i])) return null;
  let name = toks[i].v;
  let j = i + 1;
  while (toks[j]?.t === 'sym' && toks[j].v === '.' && isName(toks[j + 1])) {
    name = toks[j + 1].v;
    j += 2;
  }
  return { name, next: j };
}

/** Index of the matching ')' for the '(' at `i`. */
function closeParen(toks: Tok[], i: number): number {
  let depth = 0;
  for (let j = i; j < toks.length; j += 1) {
    if (toks[j].t === 'sym' && toks[j].v === '(') depth += 1;
    if (toks[j].t === 'sym' && toks[j].v === ')') {
      depth -= 1;
      if (depth === 0) return j;
    }
  }
  return toks.length - 1;
}

/** Names inside "( a, b )" starting at the '(' at `i`. */
function nameList(toks: Tok[], i: number): { names: string[]; next: number } {
  if (!(toks[i]?.t === 'sym' && toks[i].v === '(')) return { names: [], next: i };
  const end = closeParen(toks, i);
  const names = splitTop(toks.slice(i + 1, end), ',')
    .map((p) => p.find(isName)?.v)
    .filter((v): v is string => !!v);
  return { names, next: end + 1 };
}

/** Render tokens back to compact SQL text (for types and defaults). */
function text(toks: Tok[]): string {
  let s = '';
  for (const tk of toks) {
    const v = tk.t === 'str' ? `'${tk.v.replace(/'/g, "''")}'` : tk.v;
    const tight = tk.t === 'sym' && (tk.v === '(' || tk.v === ')' || tk.v === ',' || tk.v === '.' || tk.v === '::');
    const prevTight = s.endsWith('(') || s.endsWith('.') || s.endsWith('::') || s.endsWith(',');
    s += !s || tight || prevTight ? v : ` ${v}`;
  }
  return s;
}

const CONSTRAINT_WORDS = new Set([
  'NOT', 'NULL', 'PRIMARY', 'UNIQUE', 'DEFAULT', 'REFERENCES', 'CHECK', 'CONSTRAINT', 'AUTO_INCREMENT',
  'AUTOINCREMENT', 'IDENTITY', 'GENERATED', 'COMMENT', 'COLLATE', 'ON', 'CHARACTER', 'CHARSET', 'UNSIGNED',
]);

/** Normalise a raw SQL type to what DBDesigner's parseDataType understands. */
function normalizeType(raw: string): { type: string; serial: boolean } {
  let t = raw.trim().replace(/\s+/g, ' ');
  const upper = t.toUpperCase();
  const serial = /^(SMALL|BIG)?SERIAL\d?$/.test(upper);
  if (serial) t = upper.startsWith('BIG') ? 'BIGINT' : upper.startsWith('SMALL') ? 'SMALLINT' : 'INT';
  t = t
    .replace(/^CHARACTER VARYING/i, 'VARCHAR')
    .replace(/^DOUBLE PRECISION$/i, 'DOUBLE')
    .replace(/^INTEGER$/i, 'INT')
    .replace(/ WITH(OUT)? TIME ZONE$/i, '')
    .replace(/^TIMESTAMPTZ$/i, 'TIMESTAMP');
  return { type: t || 'VARCHAR(255)', serial };
}

interface Fk {
  table: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
  onDelete?: string;
  onUpdate?: string;
}

/** Parse "REFERENCES t (c) [ON DELETE x] [ON UPDATE y]" starting at the REFERENCES token. */
function readReferences(toks: Tok[], i: number): { refTable: string; refColumns: string[]; onDelete?: string; onUpdate?: string; next: number } | null {
  const n = readName(toks, i + 1);
  if (!n) return null;
  const list = nameList(toks, n.next);
  let j = list.next;
  let onDelete: string | undefined;
  let onUpdate: string | undefined;
  while (up(toks[j]) === 'ON' || up(toks[j]) === 'MATCH' || up(toks[j]) === 'DEFERRABLE' || up(toks[j]) === 'INITIALLY') {
    if (up(toks[j]) === 'ON') {
      const which = up(toks[j + 1]);
      let k = j + 2;
      const words: string[] = [];
      while (k < toks.length && ['CASCADE', 'RESTRICT', 'SET', 'NULL', 'DEFAULT', 'NO', 'ACTION'].includes(up(toks[k]))) {
        words.push(up(toks[k]));
        k += 1;
      }
      if (which === 'DELETE') onDelete = words.join(' ');
      if (which === 'UPDATE') onUpdate = words.join(' ');
      j = k;
    } else j += 2;
  }
  return { refTable: n.name, refColumns: list.names, onDelete, onUpdate, next: j };
}

/** One column definition inside CREATE TABLE / ALTER TABLE ADD COLUMN. */
function readColumn(def: Tok[], table: string, fks: Fk[]): SpecColumn | null {
  if (!isName(def[0])) return null;
  const col: SpecColumn = { name: def[0].v };
  let i = 1;
  const typeToks: Tok[] = [];
  while (i < def.length && !CONSTRAINT_WORDS.has(up(def[i]))) {
    if (def[i].t === 'sym' && def[i].v === '(') {
      const end = closeParen(def, i);
      typeToks.push(...def.slice(i, end + 1));
      i = end + 1;
    } else {
      typeToks.push(def[i]);
      i += 1;
    }
  }
  const { type, serial } = normalizeType(text(typeToks));
  col.type = type;
  if (serial) col.autoIncrement = true;
  while (i < def.length) {
    const w = up(def[i]);
    if (w === 'NOT' && up(def[i + 1]) === 'NULL') {
      col.nullable = false;
      i += 2;
    } else if (w === 'NULL') {
      col.nullable = true;
      i += 1;
    } else if (w === 'UNSIGNED') {
      // Kept on the type string; buildSpec turns it into the column's isUnsigned flag.
      col.type = `${col.type} UNSIGNED`;
      i += 1;
    } else if (w === 'PRIMARY') {
      col.primaryKey = true;
      i += 2;
    } else if (w === 'UNIQUE') {
      col.unique = true;
      i += 1;
    } else if (w === 'AUTO_INCREMENT' || w === 'AUTOINCREMENT') {
      col.autoIncrement = true;
      i += 1;
    } else if (w === 'IDENTITY') {
      col.autoIncrement = true;
      i += 1;
      if (def[i]?.t === 'sym' && def[i].v === '(') i = closeParen(def, i) + 1;
    } else if (w === 'GENERATED') {
      // GENERATED { ALWAYS | BY DEFAULT } AS IDENTITY [(...)] | AS (expr) STORED
      let j = i + 1;
      while (j < def.length && up(def[j]) !== 'AS') j += 1;
      if (up(def[j + 1]) === 'IDENTITY') col.autoIncrement = true;
      j += 2;
      if (def[j]?.t === 'sym' && def[j].v === '(') j = closeParen(def, j) + 1;
      i = j;
    } else if (w === 'DEFAULT') {
      let j = i + 1;
      const start = j;
      if (def[j]?.t === 'sym' && def[j].v === '(') j = closeParen(def, j) + 1;
      else {
        j += 1;
        // function call / cast: now(), 'x'::text, nextval('seq')
        while (j < def.length && ((def[j].t === 'sym' && (def[j].v === '(' || def[j].v === '::')) || def[j - 1]?.v === '::')) {
          j = def[j].t === 'sym' && def[j].v === '(' ? closeParen(def, j) + 1 : j + 1;
        }
      }
      const value = text(def.slice(start, j));
      if (/^nextval\(/i.test(value)) col.autoIncrement = true;
      else col.default = value.replace(/^'(.*)'$/s, '$1');
      i = j;
    } else if (w === 'REFERENCES') {
      const r = readReferences(def, i);
      if (!r) break;
      fks.push({ table, columns: [col.name], refTable: r.refTable, refColumns: r.refColumns, onDelete: r.onDelete, onUpdate: r.onUpdate });
      i = r.next;
    } else if (w === 'COMMENT' && def[i + 1]?.t === 'str') {
      col.note = def[i + 1].v;
      i += 2;
    } else if (w === 'CHECK') {
      i = def[i + 1]?.t === 'sym' ? closeParen(def, i + 1) + 1 : i + 1;
    } else i += 1;
  }
  if (col.primaryKey) delete col.nullable;
  return col;
}

/** A table-level constraint (PRIMARY KEY / UNIQUE / FOREIGN KEY ...); false when `def` is not one. */
function readTableConstraint(def: Tok[], table: SpecTable, fks: Fk[]): boolean {
  let i = 0;
  if (up(def[0]) === 'CONSTRAINT') i = 2;
  const w = up(def[i]);
  if (w === 'PRIMARY' && up(def[i + 1]) === 'KEY') {
    for (const n of nameList(def, i + 2).names) {
      const c = table.columns.find((x) => x.name.toLowerCase() === n.toLowerCase());
      if (c) {
        c.primaryKey = true;
        delete c.nullable;
      }
    }
    return true;
  }
  if (w === 'UNIQUE') {
    // UNIQUE [KEY | INDEX] [name] (cols)
    const open = def.findIndex((tk, k) => k > i && tk.t === 'sym' && tk.v === '(');
    const names = open >= 0 ? nameList(def, open).names : [];
    if (names.length === 1) {
      const c = table.columns.find((x) => x.name.toLowerCase() === names[0].toLowerCase());
      if (c) c.unique = true;
    }
    return true;
  }
  if (w === 'FOREIGN' && up(def[i + 1]) === 'KEY') {
    const list = nameList(def, i + 2);
    if (up(def[list.next]) === 'REFERENCES') {
      const r = readReferences(def, list.next);
      if (r) fks.push({ table: table.name, columns: list.names, refTable: r.refTable, refColumns: r.refColumns, onDelete: r.onDelete, onUpdate: r.onUpdate });
    }
    return true;
  }
  return ['KEY', 'INDEX', 'CHECK', 'FULLTEXT', 'SPATIAL', 'EXCLUDE'].includes(w) || up(def[0]) === 'CONSTRAINT';
}

export function parseSqlDdl(sql: string): ParsedSql {
  const statements = splitTop(tokenize(sql), ';');
  const tables: SpecTable[] = [];
  const fks: Fk[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];
  const tableNamed = (name: string): SpecTable | undefined =>
    tables.find((t) => t.name.toLowerCase() === name.toLowerCase());

  for (const st of statements) {
    const w0 = up(st[0]);
    if (w0 === 'CREATE') {
      let i = 1;
      while (['TEMPORARY', 'TEMP', 'UNLOGGED', 'GLOBAL', 'LOCAL', 'OR', 'REPLACE'].includes(up(st[i]))) i += 1;
      if (up(st[i]) !== 'TABLE') {
        skipped.push(`CREATE ${up(st[i]) || '?'}`);
        continue;
      }
      i += 1;
      if (up(st[i]) === 'IF') i += 3;
      const n = readName(st, i);
      if (!n || !(st[n.next]?.t === 'sym' && st[n.next].v === '(')) {
        skipped.push('CREATE TABLE (unreadable)');
        continue;
      }
      const end = closeParen(st, n.next);
      const table: SpecTable = { name: n.name, columns: [] };
      const defs = splitTop(st.slice(n.next + 1, end), ',');
      const constraints: Tok[][] = [];
      for (const def of defs) {
        const first = up(def[0]);
        if (['CONSTRAINT', 'PRIMARY', 'FOREIGN', 'UNIQUE', 'KEY', 'INDEX', 'CHECK', 'FULLTEXT', 'SPATIAL', 'EXCLUDE'].includes(first) && def[0].t === 'word') {
          constraints.push(def);
          continue;
        }
        const col = readColumn(def, table.name, fks);
        if (col) table.columns.push(col);
      }
      for (const def of constraints) readTableConstraint(def, table, fks);
      // Table comment (MySQL): ... ) COMMENT='x'
      const tail = st.slice(end + 1);
      const ci = tail.findIndex((tk) => up(tk) === 'COMMENT');
      if (ci >= 0) {
        const s = tail.slice(ci + 1).find((tk) => tk.t === 'str');
        if (s) table.note = s.v;
      }
      if (tableNamed(table.name)) warnings.push(`Table "${table.name}" is defined twice; the last definition wins.`);
      const at = tables.findIndex((t) => t.name.toLowerCase() === table.name.toLowerCase());
      if (at >= 0) tables.splice(at, 1, table);
      else tables.push(table);
    } else if (w0 === 'ALTER' && up(st[1]) === 'TABLE') {
      let i = 2;
      if (up(st[i]) === 'ONLY') i += 1;
      if (up(st[i]) === 'IF') i += 2;
      const n = readName(st, i);
      const table = n ? tableNamed(n.name) : undefined;
      if (!n || !table) {
        if (n) warnings.push(`ALTER TABLE ${n.name}: table not defined in this script; skipped.`);
        continue;
      }
      for (const action of splitTop(st.slice(n.next), ',')) {
        if (up(action[0]) !== 'ADD') {
          skipped.push(`ALTER TABLE ... ${up(action[0])}`);
          continue;
        }
        let rest = action.slice(1);
        if (up(rest[0]) === 'COLUMN') rest = rest.slice(1);
        if (up(rest[0]) === 'IF') rest = rest.slice(3);
        if (!readTableConstraint(rest, table, fks)) {
          const col = readColumn(rest, table.name, fks);
          if (col) table.columns.push(col);
        }
      }
    } else if (st.length) {
      skipped.push(up(st[0]) || st[0].v);
    }
  }

  // Foreign keys become relationships (single-column; composite keys pair column by column).
  const relationships: SpecRelationship[] = [];
  for (const fk of fks) {
    const ref = tableNamed(fk.refTable);
    const refCols = fk.refColumns.length ? fk.refColumns : (ref?.columns.filter((c) => c.primaryKey).map((c) => c.name) ?? []);
    fk.columns.forEach((c, k) => {
      const rc = refCols[k];
      if (!rc) {
        warnings.push(`${fk.table}.${c} references ${fk.refTable} without a column; skipped.`);
        return;
      }
      relationships.push({
        from: `${fk.refTable}.${rc}`,
        to: `${fk.table}.${c}`,
        type: 'ONE_TO_MANY',
        ...(fk.onDelete ? { onDelete: fk.onDelete } : {}),
        ...(fk.onUpdate ? { onUpdate: fk.onUpdate } : {}),
      });
    });
  }
  return { spec: { tables, relationships }, skipped, warnings };
}
