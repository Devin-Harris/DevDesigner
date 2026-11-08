// Request/response DTO interfaces shared by client and server. The server's
// class-validator DTO classes implement these shapes so the client sends
// exactly what the server expects (see BUILD_INSTRUCTIONS.md section 5).
//
// These are intentionally granular: each write DTO scopes to the smallest
// coherent entity. Fields are fleshed out per phase during implementation.

import type {
  AccessLevel,
  ArrowheadType,
  CodeLanguage,
  CodeDiffView,
  ElementType,
  FillStyle,
  ProjectType,
  RelationshipType,
  ShareAccessLevel,
  StrokeStyle,
  TextAlign,
  VerticalAlign,
} from '../enums';
import type {
  ConnectorSide,
  DataType,
  ElementBinding,
  PointModel,
  SchemaModel,
  SlideConfig,
  PlaceholderConfig,
  MediaConfig,
  TextRun,
} from '../models';
import type { SchemaMutation } from '../realtime';
import type { SlideTheme } from '../slides/themes';

// --- Auth ---
export interface RegisterDto {
  email: string;
  password: string;
  displayName?: string;
}
export interface LoginDto {
  email: string;
  password: string;
}
export interface AuthTokenResponse {
  token: string;
}
export interface CurrentUserResponse {
  id: string;
  email: string | null;
  displayName: string | null;
}

// --- API tokens (MCP / automation) ---
/** read = GET only; write = full access as the owning user. */
export type ApiTokenScope = 'read' | 'write';
export const API_TOKEN_SCOPES: readonly ApiTokenScope[] = ['read', 'write'] as const;
export interface CreateApiTokenDto {
  name: string;
  scope?: ApiTokenScope;
}
/** A token as listed in account settings. The secret itself is never returned again. */
export interface ApiTokenResponse {
  id: string;
  name: string;
  scope: ApiTokenScope;
  /** First characters of the token, to recognise it in a list. */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
/** Returned once, on creation: the only time the full secret is visible. */
export interface CreatedApiTokenResponse extends ApiTokenResponse {
  token: string;
}

// --- Projects ---
export interface CreateProjectDto {
  name: string;
  description?: string;
  type?: ProjectType;
}
export interface UpdateProjectDto {
  name?: string;
  description?: string;
  archived?: boolean;
  type?: ProjectType;
}
export interface UpdateViewportDto {
  viewportX: number;
  viewportY: number;
  zoom: number;
}
/** Body for PATCH /projects/:projectId/home; `home: null` clears it. */
export interface UpdateHomeDto {
  home: { x: number; y: number; zoom: number } | null;
}
/** Body for PUT /projects/:projectId/themes: the whole custom theme library. */
export interface UpdateThemesDto {
  themes: SlideTheme[];
}
export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  archived: boolean;
  type: ProjectType;
  createdAt: string;
  updatedAt: string;
}
/** Initial-load payload for a project: the assembled schema plus access context. */
export interface ProjectGraphResponse {
  project: ProjectSummary;
  schema: SchemaModel;
  accessLevel: AccessLevel;
}

/** Marker + version stamped into exported project files so import can recognise them. */
export const PROJECT_EXPORT_FORMAT = 'dbdesigner-project';
export const PROJECT_EXPORT_VERSION = 1;

/**
 * A portable, self-contained snapshot of one project (GET /projects/:id/export,
 * accepted by POST /projects/import). Ids inside `schema` are only meaningful
 * within the file; import mints fresh ids and remaps every reference.
 */
export interface ProjectExportFile {
  format: typeof PROJECT_EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  project: {
    name: string;
    description: string | null;
    type: ProjectType;
  };
  schema: SchemaModel;
  /** Image files referenced by `schema.elements[].fileId`, embedded so the file is self-contained. */
  images?: ProjectExportImage[];
}

/** One embedded image in an export file. `id` matches an element's `fileId`. */
export interface ProjectExportImage {
  id: string;
  mimeType: string;
  /** Base64-encoded file contents. */
  data: string;
}

/** Body of POST /projects/:projectId/images. */
export interface UploadImageDto {
  mimeType: string;
  /** Base64-encoded file contents (no data: prefix). */
  data: string;
}

/** Response of an image upload: the id to put in an image element's `fileId`. */
export interface UploadImageResponse {
  id: string;
}

/** Body of POST /projects/:id/import-content: merge an export file into an existing project. */
export interface ImportIntoProjectDto {
  /** The parsed contents of a `.dbdesigner.json` file. */
  file: ProjectExportFile;
  /** World point to place the content's top-left corner at (e.g. the visible canvas). */
  anchor?: { x: number; y: number };
  /**
   * Keep slide ownership and arrow bindings that point at items already in this
   * project (normally they are dropped). For duplicating content in place.
   */
  linkExisting?: boolean;
}
/**
 * What the merge added, as the same mutations broadcast to collaborators. The
 * caller applies them locally (its own echo is filtered out of the broadcast).
 */
export interface ImportIntoProjectResponse {
  mutations: SchemaMutation[];
}

// --- Tables ---
export interface CreateTableDto {
  name: string;
  x: number;
  y: number;
  color?: string;
  /** The slide (frame id) the table is created on. */
  slideId?: string;
  /** Morph tag (`tag:<name>`), e.g. kept by a copied slide. */
  morphId?: string;
}
export interface UpdateTableDto {
  name?: string;
  color?: string;
  note?: string;
  /** Manual width in px; 0 clears the override back to auto-fit. */
  width?: number;
  /** Uniform display scale; 1 (or 0) resets to natural size. */
  scale?: number;
  /** Group membership; null clears it. */
  groupId?: string | null;
  /** Owning slide (frame id); null clears it. */
  slideId?: string | null;
  /** Morph tag (`tag:<name>`); '' clears it. */
  morphId?: string;
}
export interface UpdatePositionDto {
  x: number;
  y: number;
}

// --- Columns ---
export interface CreateColumnDto {
  name: string;
  dataType: DataType;
  isPrimaryKey?: boolean;
  isNullable?: boolean;
  isUnique?: boolean;
  isAutoIncrement?: boolean;
  isUnsigned?: boolean;
  defaultValue?: string;
}
export interface UpdateColumnDto {
  name?: string;
  dataType?: DataType;
  isPrimaryKey?: boolean;
  isNullable?: boolean;
  isUnique?: boolean;
  isAutoIncrement?: boolean;
  isUnsigned?: boolean;
  defaultValue?: string;
  note?: string;
}
export interface ReorderColumnsDto {
  orderedColumnIds: string[];
}

// --- Indexes ---
export interface CreateIndexDto {
  name: string;
  columnIds: string[];
  isUnique?: boolean;
}
export interface UpdateIndexDto {
  name?: string;
  columnIds?: string[];
  isUnique?: boolean;
}
export interface ReorderIndexesDto {
  orderedIndexIds: string[];
}

// --- Relationships ---
export interface CreateRelationshipDto {
  sourceColumnId: string;
  targetColumnId: string;
  type: RelationshipType;
  onDelete?: string;
  onUpdate?: string;
  sourceSide?: ConnectorSide;
  targetSide?: ConnectorSide;
  autoRoute?: boolean;
}
export interface UpdateRelationshipDto {
  type?: RelationshipType;
  // Re-point an endpoint to a different column (fixing a mis-drawn relationship).
  sourceColumnId?: string;
  targetColumnId?: string;
  onDelete?: string;
  onUpdate?: string;
  // Manual line routing bend points (world coords); empty array clears routing.
  waypoints?: PointModel[];
  sourceSide?: ConnectorSide;
  targetSide?: ConnectorSide;
  autoRoute?: boolean;
}

// --- Notes ---
export interface CreateNoteDto {
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  color?: string;
}
export interface UpdateNoteDto {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  content?: string;
  color?: string;
}

// --- Canvas elements (excalidraw-style drawing layer) ---
export interface CreateElementDto {
  /** Client-generated UUID, so the canvas can show the element before the save returns. */
  id?: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  strokeColor: string;
  backgroundColor?: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  opacity: number;
  zIndex?: number;
  cornerRadius?: number;
  ellipticCorners?: boolean;
  elbow?: boolean;
  clipContent?: boolean;
  points?: PointModel[];
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  aboveTables?: boolean;
  italic?: boolean;
  lineHeight?: number;
  wrap?: boolean;
  runs?: TextRun[];
  textAlign?: TextAlign;
  verticalAlign?: VerticalAlign;
  startBinding?: ElementBinding | null;
  endBinding?: ElementBinding | null;
  startArrowhead?: ArrowheadType;
  endArrowhead?: ArrowheadType;
  curvature?: number;
  /** Image only: the uploaded project image to display (see UploadImageDto). */
  fileId?: string;
  /** Image only: crop, clip shape and playback. */
  media?: MediaConfig;
  /** Code only: the highlight language of `text`. */
  language?: CodeLanguage;
  /** Code only: optional file name title bar. */
  fileName?: string;
  diffText?: string;
  diffView?: CodeDiffView;
  diffSplit?: number;
  diffShowWhitespace?: boolean;
  /** Code only: collapsed state (see CanvasElementModel.expandedHeight). */
  expandedHeight?: number;
  /** Frame only: slide-sequence membership + transition. */
  slide?: SlideConfig;
  /** Text boxes: a layout placeholder, or a slide's copy of one. */
  placeholder?: PlaceholderConfig;
  /** On a slide or layout: the master element this item stands in for. */
  overrides?: string;
  /** Morph lineage (set on copies so they morph with their source). */
  morphId?: string;
  morphIn?: string;
  morphOut?: string;
  step?: number;
  slideId?: string;
}
/** Style/content/geometry edits to a single element. */
export interface UpdateElementDto {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  angle?: number;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: FillStyle;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  opacity?: number;
  zIndex?: number;
  cornerRadius?: number;
  ellipticCorners?: boolean;
  elbow?: boolean;
  clipContent?: boolean;
  points?: PointModel[];
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  aboveTables?: boolean;
  italic?: boolean;
  lineHeight?: number;
  wrap?: boolean;
  /** null clears the rich runs (uniform styling). */
  runs?: TextRun[] | null;
  textAlign?: TextAlign;
  verticalAlign?: VerticalAlign;
  /** null clears a binding (endpoint reverts to its stored point). */
  startBinding?: ElementBinding | null;
  endBinding?: ElementBinding | null;
  startArrowhead?: ArrowheadType;
  endArrowhead?: ArrowheadType;
  curvature?: number;
  language?: CodeLanguage;
  /** Code only: file name title bar; empty string clears it. */
  fileName?: string;
  /** Code only: diff right side; null clears the diff. */
  diffText?: string | null;
  diffView?: CodeDiffView;
  diffSplit?: number;
  diffShowWhitespace?: boolean;
  /** Code only: height to restore when expanding; set = collapsed, null = expanded. */
  expandedHeight?: number | null;
  /** Group membership; null clears it. */
  groupId?: string | null;
  /** Frame only: slide config; null removes the frame from the sequence. */
  slide?: SlideConfig | null;
  placeholder?: PlaceholderConfig | null;
  /** Image only: crop/clip/playback; null clears it. */
  media?: MediaConfig | null;
  overrides?: string | null;
  /** Morph lineage; null clears an explicit pairing. */
  morphId?: string | null;
  /** Split morph tags (into / out of this slide); null clears. */
  morphIn?: string | null;
  morphOut?: string | null;
  /** Build step; null clears it. */
  step?: number | null;
  /** Owning slide (frame id); null clears it. */
  slideId?: string | null;
}
/** High-frequency drag/reshape autosave (position and/or vertices only). */
export interface UpdateElementPositionDto {
  x?: number;
  y?: number;
  points?: PointModel[];
}
export interface ReorderElementsDto {
  orderedElementIds: string[];
}

// --- Sequence diagrams (groups) ---
export interface CreateSequenceDiagramDto {
  originY: number;
  lifelineSpacing?: number;
  rowSpacing?: number;
  headerHeight?: number;
  backgroundColor?: string;
  /** Diagram box border color; empty string = theme border. */
  borderColor?: string;
  /** Stacking order against elements (default -1 = under all of them). */
  zIndex?: number;
  /** The slide (frame id) the diagram is created on. */
  slideId?: string;
  title?: string;
  /** Morph tag (`tag:<name>`); empty string clears it. */
  morphId?: string;
}
export interface UpdateSequenceDiagramDto {
  lifelineSpacing?: number;
  rowSpacing?: number;
  headerHeight?: number;
  originY?: number;
  /** Stacking order against elements; a diagram sits above elements ranked below it. */
  zIndex?: number;
  /** Group membership; null clears it. */
  groupId?: string | null;
  /** Owning slide (frame id); null clears it. */
  slideId?: string | null;
  /** Box background (hex); empty string clears back to the theme surface. */
  backgroundColor?: string;
  /** Diagram box border color; empty string = theme border. */
  borderColor?: string;
  /** Diagram title; empty string clears it. */
  title?: string;
  /** Morph tag (`tag:<name>`); empty string clears it. */
  morphId?: string;
}

// --- Lifelines (sequence diagram participant columns) ---
export interface CreateLifelineDto {
  diagramId: string;
  label: string;
  color?: string;
  lineColor?: string;
  /** Header border color; empty string clears it. */
  strokeColor?: string;
  /** Header label color; empty string = automatic. */
  textColor?: string;
  x: number;
  width?: number;
  order?: number;
  /** Morph tag (`tag:<name>`); empty string clears it. */
  morphId?: string;
}
export interface UpdateLifelineDto {
  label?: string;
  color?: string;
  lineColor?: string;
  /** Header border color; empty string clears it. */
  strokeColor?: string;
  /** Header label color; empty string = automatic. */
  textColor?: string;
  width?: number;
  /** Morph tag (`tag:<name>`); empty string clears it. */
  morphId?: string;
}
export interface UpdateLifelinePositionDto {
  x: number;
}

// --- Sequence messages (rows between lifelines) ---
export interface CreateSequenceMessageDto {
  diagramId: string;
  fromLifelineId: string;
  toLifelineId: string;
  label?: string;
  y: number;
  style?: 'solid' | 'dashed' | 'break';
  direction?: 'forward' | 'reverse';
  arrowhead?: 'arrow' | 'open' | 'none';
  color?: string;
  wrap?: boolean;
  /** Morph tag (`tag:<name>`); empty string clears it. */
  morphId?: string;
}
export interface UpdateSequenceMessageDto {
  fromLifelineId?: string;
  toLifelineId?: string;
  label?: string;
  style?: 'solid' | 'dashed' | 'break';
  direction?: 'forward' | 'reverse';
  arrowhead?: 'arrow' | 'open' | 'none';
  color?: string;
  wrap?: boolean;
  /** Morph tag (`tag:<name>`); empty string clears it. */
  morphId?: string;
}
export interface UpdateSequenceMessagePositionDto {
  y: number;
}

// --- Sharing ---
export interface CreateShareLinkDto {
  accessLevel: ShareAccessLevel;
  expiresAt?: string;
}
export interface ShareLinkResponse {
  id: string;
  token: string;
  url: string;
  accessLevel: ShareAccessLevel;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

// --- Batch (PATCH /projects/:projectId/batch) ---
/**
 * Many granular edits applied atomically in one transaction (all or nothing), then
 * broadcast as ordinary realtime mutations. Each entry is `{ id, ...patch }` using the
 * same fields as the matching granular PATCH; tables also take x/y, participants x and
 * messages y. Relationships take everything but endpoint re-pointing.
 */
export interface BatchUpdateDto {
  tables?: Array<{ id: string; x?: number; y?: number } & UpdateTableDto>;
  elements?: Array<{ id: string } & UpdateElementDto>;
  diagrams?: Array<{ id: string } & UpdateSequenceDiagramDto>;
  lifelines?: Array<{ id: string; x?: number } & UpdateLifelineDto>;
  messages?: Array<{ id: string; y?: number } & UpdateSequenceMessageDto>;
  relationships?: Array<{ id: string } & Omit<UpdateRelationshipDto, 'sourceColumnId' | 'targetColumnId'>>;
  /** Ids to delete (children of a deleted parent go with it). */
  deletes?: {
    tables?: string[];
    elements?: string[];
    relationships?: string[];
    diagrams?: string[];
    lifelines?: string[];
    messages?: string[];
  };
}
export interface BatchUpdateResponse {
  mutations: SchemaMutation[];
}

/**
 * POST /projects/:id/clone - copy existing rows in ONE transaction under ids the
 * client chose (so the copies can show locally before the server answers). Every
 * copy is offset by (dx, dy); maps pair each source child id with its copy's id.
 */
export interface CloneItemsDto {
  dx: number;
  dy: number;
  tables?: Array<{
    sourceId: string;
    id: string;
    slideId: string | null;
    columns: Record<string, string>;
    indexes: Record<string, string>;
  }>;
  /** Source and target columns are mapped through the tables' column maps. */
  relationships?: Array<{ sourceId: string; id: string }>;
  diagrams?: Array<{
    sourceId: string;
    id: string;
    slideId: string | null;
    lifelines: Record<string, string>;
    messages: Record<string, string>;
  }>;
  elements?: Array<{
    sourceId: string;
    id: string;
    slideId: string | null;
    slide: SlideConfig | null;
    morphId: string | null;
    zIndex: number;
    text: string | null;
    startBinding: ElementBinding | null;
    endBinding: ElementBinding | null;
  }>;
}

/** A theme in the caller's personal library (GET/POST /me/themes). */
export interface UserThemeResponse {
  id: string;
  theme: SlideTheme;
  createdAt: string;
}
/** Body for POST /me/themes. */
export interface SaveUserThemeDto {
  theme: SlideTheme;
}
