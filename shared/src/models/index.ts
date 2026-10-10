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

/** A named index on a table, over one or more of its columns. */
export interface IndexModel {
  id: string;
  name: string;
  /** Ids of the table's columns the index covers, in order. */
  columnIds: string[];
  isUnique: boolean;
}

export interface TableModel {
  id: string;
  name: string;
  columns: ColumnModel[];
  /** Named indexes over this table's columns (optional; omitted when empty). */
  indexes?: IndexModel[];
  x: number;
  y: number;
  color?: string;
  note?: string;
  /** Manual width override in px (stretched/squeezed by the user); absent = auto-fit. */
  width?: number;
  /** Group this table belongs to; absent = ungrouped. */
  groupId?: string;
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
  targetKind: 'element' | 'table' | 'message';
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
  /** Corner radius (px) for rectangles. Undefined = auto (min(12, 15% of side)). */
  cornerRadius?: number;
  /** Vertices for line/arrow/freedraw, relative to `x`/`y`. */
  points?: PointModel[];
  /** Text content for a text element, or a label on a shape. */
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  /** Text weight/style toggles for a text element or shape label. */
  bold?: boolean;
  italic?: boolean;
  textAlign?: TextAlign;
  verticalAlign?: VerticalAlign;
  /** Line/arrow only: bound endpoints that re-route as their target moves. */
  startBinding?: ElementBinding;
  endBinding?: ElementBinding;
  /** Line/arrow only: arrowhead style at each end (default: none at start, arrow at end). */
  startArrowhead?: ArrowheadType;
  endArrowhead?: ArrowheadType;
  /** Line/arrow only: perpendicular offset (px) of the curve's midpoint from the straight chord; 0/absent = straight. */
  curvature?: number;
  /** Shared by every member of a group (tables, elements, sequence diagrams); absent = ungrouped. */
  groupId?: string;
}

export interface ViewportModel {
  x: number;
  y: number;
  zoom: number;
}

/** A named vertical participant (column) in a sequence diagram. */
export interface LifelineModel {
  id: string;
  /** The sequence diagram this participant belongs to. */
  diagramId: string;
  /** Display label in the header box. */
  label: string;
  /** Header box fill color (hex). */
  color?: string;
  /** Color of the dashed spine below the header (hex); absent = theme connector color. */
  lineColor?: string;
  /** World-space X center of this lifeline's spine. */
  x: number;
  /** Header box width in px. */
  width: number;
  /** Creation order (ties broken left-to-right by x). */
  order: number;
}

/** A horizontal message (row) between two lifelines in a sequence diagram. */
export interface SequenceMessageModel {
  id: string;
  /** The sequence diagram this message belongs to. */
  diagramId: string;
  fromLifelineId: string;
  toLifelineId: string;
  /** Optional label shown above the arrow (or on its own for a break). */
  label?: string;
  /** World-space Y of this message row (messages render sorted by y). */
  y: number;
  /** solid = synchronous call; dashed = return/async; break = a label-only divider, no arrow. */
  style: 'solid' | 'dashed' | 'break';
  /** Which end carries the arrowhead. */
  direction: 'forward' | 'reverse';
  arrowhead: 'arrow' | 'open' | 'none';
  /** Line + arrowhead color (hex); absent = theme connector color. */
  color?: string;
}

/**
 * One sequence diagram on the canvas: a group of lifelines + messages with its
 * own origin and spacing. A project may hold several, each positioned separately.
 */
export interface SequenceDiagramModel {
  id: string;
  /** Default horizontal gap between new lifeline centers (px). */
  lifelineSpacing: number;
  /** Default vertical gap between consecutive message rows (px). */
  rowSpacing: number;
  /** Height of each lifeline header box (px). */
  headerHeight: number;
  /** World-space Y where this diagram's lifeline spines begin. */
  originY: number;
  /** Group this diagram belongs to; absent = ungrouped. */
  groupId?: string;
  /** Background fill of the diagram box (hex); absent = theme surface. */
  backgroundColor?: string;
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
  /** Sequence diagrams (groups), each with its own origin + spacing. */
  sequenceDiagrams: SequenceDiagramModel[];
  /** Sequence diagram participant columns (each tagged with its diagramId). */
  lifelines: LifelineModel[];
  /** Sequence diagram message rows (each tagged with its diagramId). */
  sequenceMessages: SequenceMessageModel[];
  viewport: ViewportModel;
  /** User-defined "home" view that reset-view returns to; null/absent = default. */
  home?: ViewportModel | null;
}
