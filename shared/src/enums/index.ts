// Shared enums and string unions imported by both client and server.
// SQLite has no native enum type, so these are modeled as string unions and
// stored in varchar columns that are typed against these values in code.

/** Effective access a caller has to a project (see BUILD_INSTRUCTIONS.md section 6). */
export type AccessLevel = 'OWNER' | 'EDIT' | 'VIEW';
export const ACCESS_LEVELS: readonly AccessLevel[] = ['OWNER', 'EDIT', 'VIEW'] as const;

/** Access level a share link grants. Owner access is never granted by a link. */
export type ShareAccessLevel = 'EDIT' | 'VIEW';

/** Relationship cardinality between two columns. */
export type RelationshipType = 'ONE_TO_ONE' | 'ONE_TO_MANY' | 'MANY_TO_MANY';
export const RELATIONSHIP_TYPES: readonly RelationshipType[] = [
  'ONE_TO_ONE',
  'ONE_TO_MANY',
  'MANY_TO_MANY',
] as const;

/** Referential action for a foreign key's ON DELETE / ON UPDATE clause. */
export type ReferentialAction = 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'NO ACTION' | 'SET DEFAULT';

/** Known base data-type names supported by the MySQL generator (section 9). */
export type DataTypeName =
  | 'INT'
  | 'BIGINT'
  | 'VARCHAR'
  | 'TEXT'
  | 'BOOLEAN'
  | 'DATE'
  | 'DATETIME'
  | 'TIMESTAMP'
  | 'DECIMAL'
  | 'FLOAT'
  | 'JSON'
  | 'ENUM';

export const DATA_TYPE_NAMES: readonly DataTypeName[] = [
  'INT',
  'BIGINT',
  'VARCHAR',
  'TEXT',
  'BOOLEAN',
  'DATE',
  'DATETIME',
  'TIMESTAMP',
  'DECIMAL',
  'FLOAT',
  'JSON',
  'ENUM',
] as const;

/** SQL dialects the generator is designed to grow into (only MySQL now). */
export type SqlDialect = 'mysql' | 'postgres' | 'sqlite';
