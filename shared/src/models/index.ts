// The schema model: the canonical, render-agnostic data structure that describes
// tables, columns, relationships, and notes. Validation and SQL export consume
// this; the client store is typed against it. Keep this decoupled from any
// rendering layer (see BUILD_INSTRUCTIONS.md section 4.2).

import type {
  ArrowheadType,
  ElementType,
  FillStyle,
  RelationshipType,
  StrokeStyle,
  TextAlign,
  VerticalAlign,
} from '../enums';

/** A 2D point in canvas world coordinates. */
export interface PointModel {
  x: number;
  y: number;
}

/** A column's data type. `length` covers VARCHAR(n); `args` covers ENUM(...) / DECIMAL(p,s). */
export interface DataType {
  name: string;
  length?: number;
  args?: string[];
}

export interface ColumnModel {
  id: string;
  name: string;
  dataType: DataType;
  isPrimaryKey: boolean;
  isNullable: boolean;
  isUnique: boolean;
  isAutoIncrement: boolean;
  defaultValue?: string;
  note?: string;
}

export interface TableModel {
  id: string;
  name: string;
  columns: ColumnModel[];
  x: number;
  y: number;
  color?: string;
  note?: string;
}

export interface RelationshipModel {
  id: string;
  sourceColumnId: string;
  targetColumnId: string;
  type: RelationshipType;
  onDelete?: string;
  onUpdate?: string;
  /** Optional bend points (world coords) for manual line routing. */
  waypoints?: PointModel[];
}

export interface NoteModel {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  color?: string;
}

/**
 * A line/arrow endpoint bound to a shape or ERD table. When set, the endpoint
 * resolves to the target's current boundary at render time, so the connector
 * re-routes automatically as the target moves. When the target is gone, the
 * endpoint falls back to its stored point in `points`.
 */
export interface ElementBinding {
  targetKind: 'element' | 'table';
  targetId: string;
}

/**
 * A free-form drawing element on the canvas: a shape (rectangle/ellipse/diamond),
 * a line/arrow, a freehand (pen) stroke, or a text block. This is the
 * excalidraw-style layer that sits alongside the ERD. It is decorative: the SQL
 * generator and schema validation ignore it. Variable-length geometry (freehand
 * strokes, multi-point lines/arrows) lives in `points`; everything else is a flat
 * field so it stores as real columns (see BUILD_INSTRUCTIONS.md section 4.1).
 */
export interface CanvasElementModel {
  id: string;
  type: ElementType;
  /** Top-left of the bounding box, or the origin for a freehand/line stroke. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Rotation in radians (default 0). */
  angle: number;
  strokeColor: string;
  backgroundColor?: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  /** Opacity 0..100. */
  opacity: number;
  /** Stacking order within the element layer. */
  zIndex: number;
  /** Vertices for line/arrow/freedraw, relative to `x`/`y`. */
  points?: PointModel[];
  /** Text content for a text element, or a label on a shape. */
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  textAlign?: TextAlign;
  verticalAlign?: VerticalAlign;
  /** Line/arrow only: bound endpoints that re-route as their target moves. */
  startBinding?: ElementBinding;
  endBinding?: ElementBinding;
  /** Line/arrow only: arrowhead style at each end (default: none at start, arrow at end). */
  startArrowhead?: ArrowheadType;
  endArrowhead?: ArrowheadType;
}

export interface ViewportModel {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Read/assembly shape for a whole project (e.g. initial load or export).
 * This is NOT what individual write endpoints accept; writes are granular.
 */
export interface SchemaModel {
  tables: TableModel[];
  relationships: RelationshipModel[];
  notes: NoteModel[];
  /** Free-form drawing elements (shapes, arrows, freehand strokes, text). */
  elements: CanvasElementModel[];
  viewport: ViewportModel;
}
