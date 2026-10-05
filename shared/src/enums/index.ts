// Shared enums and string unions imported by both client and server.
// SQLite has no native enum type, so these are modeled as string unions and
// stored in varchar columns that are typed against these values in code.

/** Effective access a caller has to a project (see BUILD_INSTRUCTIONS.md section 6). */
export type AccessLevel = 'OWNER' | 'EDIT' | 'VIEW';
export const ACCESS_LEVELS: readonly AccessLevel[] = ['OWNER', 'EDIT', 'VIEW'] as const;

/** Access level a share link grants. Owner access is never granted by a link. */
export type ShareAccessLevel = 'EDIT' | 'VIEW';

/**
 * What kind of diagram a project holds. Drives the workspace type filter, the
 * project card tag, and the editor breadcrumb chip. Purely organizational — it
 * does not change canvas behavior. New projects default to 'ERD'.
 */
export type ProjectType = 'ERD' | 'FLOW' | 'SCRATCH';
export const PROJECT_TYPES: readonly ProjectType[] = ['ERD', 'FLOW', 'SCRATCH'] as const;

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

/**
 * Kinds of free-form drawing element on the canvas (the excalidraw-style layer
 * that lives alongside the ERD). These are decorative and are ignored by the SQL
 * generator and schema validation.
 */
export type ElementType =
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'line'
  | 'arrow'
  | 'freedraw'
  | 'text'
  | 'frame';

export const ELEMENT_TYPES: readonly ElementType[] = [
  'rectangle',
  'ellipse',
  'diamond',
  'line',
  'arrow',
  'freedraw',
  'text',
  'frame',
] as const;

/** How a shape's interior is filled. */
export type FillStyle = 'none' | 'solid' | 'hachure';
export const FILL_STYLES: readonly FillStyle[] = ['none', 'solid', 'hachure'] as const;

/** How a shape's outline (or a line/arrow) is stroked. */
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
export const STROKE_STYLES: readonly StrokeStyle[] = ['solid', 'dashed', 'dotted'] as const;

/** Horizontal alignment for text elements and shape labels. */
export type TextAlign = 'left' | 'center' | 'right';
export const TEXT_ALIGNS: readonly TextAlign[] = ['left', 'center', 'right'] as const;

/** Vertical alignment for text elements and shape labels. */
export type VerticalAlign = 'top' | 'middle' | 'bottom';
export const VERTICAL_ALIGNS: readonly VerticalAlign[] = ['top', 'middle', 'bottom'] as const;

/** Font family presets for text elements (Excalidraw-style). */
export type FontFamily = 'hand' | 'normal' | 'code';
export const FONT_FAMILIES: readonly FontFamily[] = ['hand', 'normal', 'code'] as const;

/** Arrowhead style at a line/arrow endpoint. */
export type ArrowheadType = 'none' | 'arrow' | 'triangle' | 'dot' | 'bar';
export const ARROWHEAD_TYPES: readonly ArrowheadType[] = [
  'none',
  'arrow',
  'triangle',
  'dot',
  'bar',
] as const;
