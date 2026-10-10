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
  ElementType,
  FillStyle,
  ProjectType,
  RelationshipType,
  ShareAccessLevel,
  StrokeStyle,
  TextAlign,
  VerticalAlign,
} from '../enums';
import type { DataType, ElementBinding, PointModel, SchemaModel } from '../models';
import type { SchemaMutation } from '../realtime';

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
}
export interface UpdateTableDto {
  name?: string;
  color?: string;
  note?: string;
  /** Manual width in px; 0 clears the override back to auto-fit. */
  width?: number;
  /** Group membership; null clears it. */
  groupId?: string | null;
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
  defaultValue?: string;
}
export interface UpdateColumnDto {
  name?: string;
  dataType?: DataType;
  isPrimaryKey?: boolean;
  isNullable?: boolean;
  isUnique?: boolean;
  isAutoIncrement?: boolean;
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
  points?: PointModel[];
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  textAlign?: TextAlign;
  verticalAlign?: VerticalAlign;
  startBinding?: ElementBinding | null;
  endBinding?: ElementBinding | null;
  startArrowhead?: ArrowheadType;
  endArrowhead?: ArrowheadType;
  curvature?: number;
  /** Image only: the uploaded project image to display (see UploadImageDto). */
  fileId?: string;
  /** Code only: the highlight language of `text`. */
  language?: CodeLanguage;
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
  points?: PointModel[];
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  textAlign?: TextAlign;
  verticalAlign?: VerticalAlign;
  /** null clears a binding (endpoint reverts to its stored point). */
  startBinding?: ElementBinding | null;
  endBinding?: ElementBinding | null;
  startArrowhead?: ArrowheadType;
  endArrowhead?: ArrowheadType;
  curvature?: number;
  language?: CodeLanguage;
  /** Group membership; null clears it. */
  groupId?: string | null;
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
}
export interface UpdateSequenceDiagramDto {
  lifelineSpacing?: number;
  rowSpacing?: number;
  headerHeight?: number;
  originY?: number;
  /** Group membership; null clears it. */
  groupId?: string | null;
  /** Box background (hex); empty string clears back to the theme surface. */
  backgroundColor?: string;
}

// --- Lifelines (sequence diagram participant columns) ---
export interface CreateLifelineDto {
  diagramId: string;
  label: string;
  color?: string;
  lineColor?: string;
  x: number;
  width?: number;
  order?: number;
}
export interface UpdateLifelineDto {
  label?: string;
  color?: string;
  lineColor?: string;
  width?: number;
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
}
export interface UpdateSequenceMessageDto {
  fromLifelineId?: string;
  toLifelineId?: string;
  label?: string;
  style?: 'solid' | 'dashed' | 'break';
  direction?: 'forward' | 'reverse';
  arrowhead?: 'arrow' | 'open' | 'none';
  color?: string;
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
