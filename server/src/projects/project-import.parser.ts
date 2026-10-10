import { BadRequestException } from '@nestjs/common';
import {
  ARROWHEAD_TYPES,
  CODE_LANGUAGES,
  ELEMENT_TYPES,
  FILL_STYLES,
  PROJECT_EXPORT_FORMAT,
  PROJECT_EXPORT_VERSION,
  PROJECT_TYPES,
  RELATIONSHIP_TYPES,
  SLIDE_DIRECTIONS,
  SLIDE_EASINGS,
  SLIDE_TRANSITION_TYPES,
  STROKE_STYLES,
  TEXT_ALIGNS,
  VERTICAL_ALIGNS,
} from '@dbdesigner/shared';
import type {
  CanvasElementModel,
  ColumnModel,
  ElementBinding,
  IndexModel,
  LifelineModel,
  PointModel,
  ProjectType,
  RelationshipModel,
  SchemaModel,
  SequenceDiagramModel,
  SequenceMessageModel,
  SlideConfig,
  TableModel,
  ProjectExportImage,
} from '@dbdesigner/shared';

/** A validated, normalised project file ready to be inserted. */
export interface ParsedProjectImport {
  name: string;
  description: string | null;
  type: ProjectType;
  schema: SchemaModel;
  /** Embedded image files (still base64; validated + decoded by the service). */
  images: ProjectExportImage[];
}

const MAX_POINTS = 100_000;
type Obj = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new BadRequestException(`Invalid project file: ${path} ${message}.`);
}

function obj(value: unknown, path: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'must be an object');
  }
  return value as Obj;
}

/** A missing array is treated as empty so older/leaner files still import. */
function list(value: unknown, path: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(path, 'must be an array');
  return value as unknown[];
}

function str(o: Obj, key: string, path: string, max = 1000): string {
  const v = o[key];
  if (typeof v !== 'string') fail(`${path}.${key}`, 'must be a string');
  if (v.length > max) fail(`${path}.${key}`, `must be at most ${max} characters`);
  return v;
}

function optStr(o: Obj, key: string, path: string, max = 1000): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  return str(o, key, path, max);
}

function num(o: Obj, key: string, path: string, fallback?: number): number {
  const v = o[key];
  if (v === undefined && fallback !== undefined) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${path}.${key}`, 'must be a number');
  return v;
}

function optNum(o: Obj, key: string, path: string): number | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  return num(o, key, path);
}

function bool(o: Obj, key: string, path: string, fallback: boolean): boolean {
  const v = o[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'boolean') fail(`${path}.${key}`, 'must be true or false');
  return v;
}

function oneOf<T extends string>(
  o: Obj,
  key: string,
  path: string,
  allowed: readonly T[],
  fallback?: T,
): T {
  const v = o[key];
  if ((v === undefined || v === null) && fallback !== undefined) return fallback;
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    fail(`${path}.${key}`, `must be one of ${allowed.join(', ')}`);
  }
  return v as T;
}

function optOneOf<T extends string>(
  o: Obj,
  key: string,
  path: string,
  allowed: readonly T[],
): T | undefined {
  const v = o[key];
  return v === undefined || v === null ? undefined : oneOf(o, key, path, allowed);
}

function points(value: unknown, path: string): PointModel[] | undefined {
  if (value === undefined || value === null) return undefined;
  const items = list(value, path);
  if (items.length > MAX_POINTS) fail(path, `has too many points (max ${MAX_POINTS})`);
  return items.map((raw, i) => {
    const p = obj(raw, `${path}[${i}]`);
    return { x: num(p, 'x', `${path}[${i}]`), y: num(p, 'y', `${path}[${i}]`) };
  });
}

function binding(value: unknown, path: string): ElementBinding | undefined {
  if (value === undefined || value === null) return undefined;
  const b = obj(value, path);
  return {
    targetKind: oneOf(b, 'targetKind', path, ['element', 'table', 'message'] as const),
    targetId: str(b, 'targetId', path, 100),
  };
}

function slide(value: unknown, path: string): SlideConfig | undefined {
  if (value === undefined || value === null) return undefined;
  const s = obj(value, path);
  const t = s['transition'] === undefined || s['transition'] === null ? undefined : obj(s['transition'], `${path}.transition`);
  return {
    order: num(s, 'order', path, 0),
    hidden: s['hidden'] === undefined || s['hidden'] === null ? undefined : bool(s, 'hidden', path, false),
    notes: optStr(s, 'notes', path, 20_000),
    transition: t
      ? {
          type: oneOf(t, 'type', `${path}.transition`, SLIDE_TRANSITION_TYPES, 'none'),
          direction: optOneOf(t, 'direction', `${path}.transition`, SLIDE_DIRECTIONS),
          duration: Math.min(10_000, Math.max(0, num(t, 'duration', `${path}.transition`, 600))),
          easing: oneOf(t, 'easing', `${path}.transition`, SLIDE_EASINGS, 'ease-in-out'),
        }
      : undefined,
  };
}

function parseColumn(raw: unknown, path: string): ColumnModel {
  const c = obj(raw, path);
  const dt = obj(c['dataType'], `${path}.dataType`);
  const args = dt['args'] === undefined || dt['args'] === null ? undefined : list(dt['args'], `${path}.dataType.args`);
  if (args && !args.every((a) => typeof a === 'string')) {
    fail(`${path}.dataType.args`, 'must be an array of strings');
  }
  return {
    id: str(c, 'id', path, 100),
    name: str(c, 'name', path, 255),
    dataType: {
      name: str(dt, 'name', `${path}.dataType`, 100),
      length: optNum(dt, 'length', `${path}.dataType`),
      args: args as string[] | undefined,
    },
    isPrimaryKey: bool(c, 'isPrimaryKey', path, false),
    isNullable: bool(c, 'isNullable', path, true),
    isUnique: bool(c, 'isUnique', path, false),
    isAutoIncrement: bool(c, 'isAutoIncrement', path, false),
    defaultValue: optStr(c, 'defaultValue', path, 1000),
    note: optStr(c, 'note', path, 10_000),
  };
}

function parseIndex(raw: unknown, path: string): IndexModel {
  const i = obj(raw, path);
  const columnIds = list(i['columnIds'], `${path}.columnIds`);
  if (!columnIds.every((id) => typeof id === 'string')) {
    fail(`${path}.columnIds`, 'must be an array of strings');
  }
  return {
    id: str(i, 'id', path, 100),
    name: str(i, 'name', path, 255),
    columnIds: columnIds as string[],
    isUnique: bool(i, 'isUnique', path, false),
  };
}

function parseTable(raw: unknown, path: string): TableModel {
  const t = obj(raw, path);
  return {
    id: str(t, 'id', path, 100),
    name: str(t, 'name', path, 255),
    columns: list(t['columns'], `${path}.columns`).map((c, i) =>
      parseColumn(c, `${path}.columns[${i}]`),
    ),
    indexes: list(t['indexes'], `${path}.indexes`).map((x, i) =>
      parseIndex(x, `${path}.indexes[${i}]`),
    ),
    x: num(t, 'x', path, 0),
    y: num(t, 'y', path, 0),
    color: optStr(t, 'color', path, 100),
    note: optStr(t, 'note', path, 10_000),
    width: optNum(t, 'width', path),
    groupId: optStr(t, 'groupId', path, 100),
  };
}

function parseRelationship(raw: unknown, path: string): RelationshipModel {
  const r = obj(raw, path);
  return {
    id: str(r, 'id', path, 100),
    sourceColumnId: str(r, 'sourceColumnId', path, 100),
    targetColumnId: str(r, 'targetColumnId', path, 100),
    type: oneOf(r, 'type', path, RELATIONSHIP_TYPES),
    onDelete: optStr(r, 'onDelete', path, 50),
    onUpdate: optStr(r, 'onUpdate', path, 50),
    waypoints: points(r['waypoints'], `${path}.waypoints`),
  };
}

function parseElement(raw: unknown, path: string): CanvasElementModel {
  const e = obj(raw, path);
  return {
    id: str(e, 'id', path, 100),
    type: oneOf(e, 'type', path, ELEMENT_TYPES),
    x: num(e, 'x', path, 0),
    y: num(e, 'y', path, 0),
    width: num(e, 'width', path, 0),
    height: num(e, 'height', path, 0),
    angle: num(e, 'angle', path, 0),
    strokeColor: str(e, 'strokeColor', path, 100),
    backgroundColor: optStr(e, 'backgroundColor', path, 100),
    fillStyle: oneOf(e, 'fillStyle', path, FILL_STYLES, 'none'),
    strokeWidth: num(e, 'strokeWidth', path, 2),
    strokeStyle: oneOf(e, 'strokeStyle', path, STROKE_STYLES, 'solid'),
    opacity: num(e, 'opacity', path, 100),
    zIndex: num(e, 'zIndex', path, 0),
    cornerRadius: optNum(e, 'cornerRadius', path),
    points: points(e['points'], `${path}.points`),
    text: optStr(e, 'text', path, 100_000),
    fontSize: optNum(e, 'fontSize', path),
    fontFamily: optStr(e, 'fontFamily', path, 100),
    bold: e['bold'] === undefined || e['bold'] === null ? undefined : bool(e, 'bold', path, false),
    italic:
      e['italic'] === undefined || e['italic'] === null ? undefined : bool(e, 'italic', path, false),
    textAlign: optOneOf(e, 'textAlign', path, TEXT_ALIGNS),
    verticalAlign: optOneOf(e, 'verticalAlign', path, VERTICAL_ALIGNS),
    startBinding: binding(e['startBinding'], `${path}.startBinding`),
    endBinding: binding(e['endBinding'], `${path}.endBinding`),
    startArrowhead: optOneOf(e, 'startArrowhead', path, ARROWHEAD_TYPES),
    endArrowhead: optOneOf(e, 'endArrowhead', path, ARROWHEAD_TYPES),
    curvature: optNum(e, 'curvature', path),
    fileId: optStr(e, 'fileId', path, 100),
    language: optOneOf(e, 'language', path, CODE_LANGUAGES),
    groupId: optStr(e, 'groupId', path, 100),
    slide: slide(e['slide'], `${path}.slide`),
    morphId: optStr(e, 'morphId', path, 100),
    step: optNum(e, 'step', path),
  };
}

function parseImage(raw: unknown, path: string): ProjectExportImage {
  const i = obj(raw, path);
  return {
    id: str(i, 'id', path, 100),
    mimeType: str(i, 'mimeType', path, 100),
    data: str(i, 'data', path, 8_000_000),
  };
}

function parseDiagram(raw: unknown, path: string): SequenceDiagramModel {
  const d = obj(raw, path);
  return {
    id: str(d, 'id', path, 100),
    lifelineSpacing: num(d, 'lifelineSpacing', path, 160),
    rowSpacing: num(d, 'rowSpacing', path, 48),
    headerHeight: num(d, 'headerHeight', path, 42),
    originY: num(d, 'originY', path, 0),
    groupId: optStr(d, 'groupId', path, 100),
    backgroundColor: optStr(d, 'backgroundColor', path, 100),
  };
}

function parseLifeline(raw: unknown, path: string): LifelineModel {
  const l = obj(raw, path);
  return {
    id: str(l, 'id', path, 100),
    diagramId: str(l, 'diagramId', path, 100),
    label: str(l, 'label', path, 255),
    color: optStr(l, 'color', path, 100),
    lineColor: optStr(l, 'lineColor', path, 100),
    x: num(l, 'x', path, 0),
    width: num(l, 'width', path, 120),
    order: num(l, 'order', path, 0),
  };
}

function parseMessage(raw: unknown, path: string): SequenceMessageModel {
  const m = obj(raw, path);
  return {
    id: str(m, 'id', path, 100),
    diagramId: str(m, 'diagramId', path, 100),
    fromLifelineId: str(m, 'fromLifelineId', path, 100),
    toLifelineId: str(m, 'toLifelineId', path, 100),
    label: optStr(m, 'label', path, 10_000),
    y: num(m, 'y', path, 0),
    style: oneOf(m, 'style', path, ['solid', 'dashed', 'break'] as const, 'solid'),
    direction: oneOf(m, 'direction', path, ['forward', 'reverse'] as const, 'forward'),
    arrowhead: oneOf(m, 'arrowhead', path, ['arrow', 'open', 'none'] as const, 'arrow'),
    color: optStr(m, 'color', path, 100),
  };
}

/**
 * Validate an untrusted project export file and normalise it. Throws a 400 naming
 * the offending field. Cross-references (relationship -> column, message ->
 * lifeline, ...) are NOT resolved here; the importer drops any that dangle.
 */
export function parseProjectExport(raw: unknown): ParsedProjectImport {
  const file = obj(raw, 'file');
  // The marker is optional: files written without it (e.g. by an older client build)
  // are accepted as version 1 and still go through the full structural validation
  // below. A marker that is present but wrong means some other kind of file.
  const format = file['format'];
  if (format !== undefined && format !== null && format !== PROJECT_EXPORT_FORMAT) {
    fail('file', 'is not a DBDesigner project export');
  }
  const version = file['version'] ?? 1;
  if (typeof version !== 'number' || version < 1) {
    fail('version', 'must be a positive number');
  }
  if (version > PROJECT_EXPORT_VERSION) {
    fail('version', `${version} was made by a newer app version; update before importing`);
  }

  const project = obj(file['project'], 'project');
  const name = str(project, 'name', 'project', 120).trim();
  if (!name) fail('project.name', 'must not be empty');

  const s = obj(file['schema'], 'schema');
  const viewport = s['viewport'] === undefined ? {} : obj(s['viewport'], 'schema.viewport');
  const homeRaw = s['home'];
  const home =
    homeRaw === undefined || homeRaw === null ? null : obj(homeRaw, 'schema.home');

  return {
    name,
    description: optStr(project, 'description', 'project', 5000) ?? null,
    type: oneOf(project, 'type', 'project', PROJECT_TYPES, 'ERD'),
    images: list(file['images'], 'images').map((img, i) => parseImage(img, `images[${i}]`)),
    schema: {
      tables: list(s['tables'], 'schema.tables').map((t, i) =>
        parseTable(t, `schema.tables[${i}]`),
      ),
      relationships: list(s['relationships'], 'schema.relationships').map((r, i) =>
        parseRelationship(r, `schema.relationships[${i}]`),
      ),
      notes: [],
      elements: list(s['elements'], 'schema.elements').map((e, i) =>
        parseElement(e, `schema.elements[${i}]`),
      ),
      sequenceDiagrams: list(s['sequenceDiagrams'], 'schema.sequenceDiagrams').map((d, i) =>
        parseDiagram(d, `schema.sequenceDiagrams[${i}]`),
      ),
      lifelines: list(s['lifelines'], 'schema.lifelines').map((l, i) =>
        parseLifeline(l, `schema.lifelines[${i}]`),
      ),
      sequenceMessages: list(s['sequenceMessages'], 'schema.sequenceMessages').map((m, i) =>
        parseMessage(m, `schema.sequenceMessages[${i}]`),
      ),
      viewport: {
        x: num(viewport, 'x', 'schema.viewport', 0),
        y: num(viewport, 'y', 'schema.viewport', 0),
        zoom: num(viewport, 'zoom', 'schema.viewport', 1),
      },
      home: home
        ? {
            x: num(home, 'x', 'schema.home'),
            y: num(home, 'y', 'schema.home'),
            zoom: num(home, 'zoom', 'schema.home'),
          }
        : null,
    },
  };
}
