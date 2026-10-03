// Request/response DTO interfaces shared by client and server. The server's
// class-validator DTO classes implement these shapes so the client sends
// exactly what the server expects (see BUILD_INSTRUCTIONS.md section 5).
//
// These are intentionally granular: each write DTO scopes to the smallest
// coherent entity. Fields are fleshed out per phase during implementation.

import type {
  AccessLevel,
  ArrowheadType,
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
