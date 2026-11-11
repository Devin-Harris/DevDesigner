// Column data types as text: parse "VARCHAR(255)" / "DECIMAL(10,2)" into a DataType
// and format one back. Shared by the import parser, the MCP and the diagram specs.

import type { DataType } from '../models';

const UNSIGNED_SUFFIX = /\s+(UN)?SIGNED(\s+ZEROFILL)?\s*$/i;

/** True when a raw SQL type carries the UNSIGNED modifier ("INT UNSIGNED", "BIGINT(20) unsigned"). */
export function isUnsignedType(input: string | undefined): boolean {
  return /\s+UNSIGNED(\s+ZEROFILL)?\s*$/i.test(input ?? '');
}

/**
 * Parse "VARCHAR(255)" / "DECIMAL(10,2)" / "ENUM('a','b')" into a DataType. A
 * trailing SIGNED/UNSIGNED modifier is dropped: it is a column flag
 * (`isUnsigned`, see isUnsignedType), not part of the type name.
 */
export function parseDataType(input: string | undefined): DataType {
  const raw = (input ?? 'VARCHAR(255)').trim().replace(UNSIGNED_SUFFIX, '');
  const m = /^([A-Za-z_ ]+?)\s*(?:\((.*)\))?$/.exec(raw);
  if (!m) {
    return { name: raw.toUpperCase() };
  }
  const name = m[1].trim().toUpperCase();
  const inner = m[2]?.trim();
  if (!inner) {
    return name === 'VARCHAR' ? { name, length: 255 } : { name };
  }
  const parts = inner
    .split(',')
    .map((p) => p.trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1'))
    .filter((p) => p.length > 0);
  if (name === 'VARCHAR' || name === 'CHAR') {
    const n = Number(parts[0]);
    return Number.isInteger(n) && n > 0 ? { name: 'VARCHAR', length: n } : { name: 'VARCHAR', length: 255 };
  }
  return { name, args: parts };
}

/** "VARCHAR(255)", "DECIMAL(10,2)", "ENUM(a,b)": a DataType as display / SQL-ish text. */
export function formatDataType(type: DataType): string {
  if (type.length) return `${type.name}(${type.length})`;
  if (type.args?.length) return `${type.name}(${type.args.join(',')})`;
  return type.name;
}
