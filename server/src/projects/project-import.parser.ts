import { BadRequestException } from '@nestjs/common';
import { jsonSize } from '../common/validators';
import {
  MAX_THEME_DESIGN_BYTES,
  extraLayoutsError,
  layoutItemsError,
  themeLayoutsError,
} from '../common/theme-validation';
import {
  parseDataType,
  MAX_COLOR_LENGTH,
  isColorValue,
  PLACEHOLDER_ROLES,
  MEDIA_CLIP_SHAPES,
  MEDIA_PLAYBACK_MODES,
  type MediaConfig,
  LAYOUT_KINDS,
  type PlaceholderConfig,
  ARROWHEAD_TYPES,
  CODE_LANGUAGES,
  CODE_DIFF_VIEWS,
  ELEMENT_TYPES,
  FILL_STYLES,
  MAX_ANIMATION_DELAY,
  MAX_ANIMATION_DURATION,
  MAX_SLIDE_ANIMATIONS,
  THEME_COLOR_TOKENS,
  PROJECT_EXPORT_FORMAT,
  PROJECT_EXPORT_VERSION,
  PROJECT_TYPES,
  CONNECTOR_SIDES,
  RELATIONSHIP_TYPES,
  SLIDE_ANIMATION_EFFECTS,
  SLIDE_ANIMATION_KINDS,
  SLIDE_ANIMATION_TRIGGERS,
  SLIDE_DIRECTIONS,
  MORPH_BY_OPTIONS,
  SLIDE_EASINGS,
  SLIDE_TRANSITION_TYPES,
  STROKE_STYLES,
  TEXT_ALIGNS,
  VERTICAL_ALIGNS,
} from '@devdesigner/shared';
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
  SlideAnimation,
  SlideConfig,
  SlideTheme,
  TableModel,
  TextRun,
  ProjectExportImage,
} from '@devdesigner/shared';

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

/** A stored color (security H-1 / S1.2: same rule as the DTOs' @IsColor). */
function color(o: Obj, key: string, path: string): string {
  const v = str(o, key, path, MAX_COLOR_LENGTH);
  if (!isColorValue(v)) fail(`${path}.${key}`, 'must be a color (#hex, a palette name or a $theme token)');
  return v;
}

function optColor(o: Obj, key: string, path: string): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  return color(o, key, path);
}

/** A theme's free-form design part, checked like the theme DTOs (security M-4 / S2.2). */
function themeDesign<T>(value: unknown, path: string, check: (v: unknown, p: string) => string | null): T | undefined {
  if (value === undefined || value === null) return undefined;
  const error = check(value, path);
  if (error) throw new BadRequestException(`Invalid project file: ${error}.`);
  if (jsonSize(value) > MAX_THEME_DESIGN_BYTES) fail(path, 'is too large');
  return value as T;
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

function textRuns(value: unknown, path: string): TextRun[] | undefined {
  if (value === undefined || value === null) return undefined;
  const items = list(value, path);
  if (items.length > 5000) fail(path, 'has too many runs (max 5000)');
  return items.map((raw, i) => {
    const r = obj(raw, `${path}[${i}]`);
    const flag = (k: string): boolean | undefined =>
      r[k] === undefined || r[k] === null ? undefined : bool(r, k, `${path}[${i}]`, false);
    return {
      text: str(r, 'text', `${path}[${i}]`, 50_000),
      bold: flag('bold'),
      italic: flag('italic'),
      underline: flag('underline'),
      color: optColor(r, 'color', `${path}[${i}]`),
      morph: optStr(r, 'morph', `${path}[${i}]`, 80),
    };
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

function slideAnimations(value: unknown, path: string): SlideAnimation[] | undefined {
  if (value === undefined || value === null) return undefined;
  const items = list(value, path);
  if (items.length > MAX_SLIDE_ANIMATIONS) {
    fail(path, `has too many animations (max ${MAX_SLIDE_ANIMATIONS})`);
  }
  return items.map((raw, i) => {
    const p = `${path}[${i}]`;
    const a = obj(raw, p);
    return {
      id: str(a, 'id', p, 100),
      target: str(a, 'target', p, 100),
      kind: oneOf(a, 'kind', p, SLIDE_ANIMATION_KINDS, 'enter'),
      effect: oneOf(a, 'effect', p, SLIDE_ANIMATION_EFFECTS, 'fade'),
      trigger: oneOf(a, 'trigger', p, SLIDE_ANIMATION_TRIGGERS, 'click'),
      duration: Math.min(MAX_ANIMATION_DURATION, Math.max(0, num(a, 'duration', p, 500))),
      delay: Math.min(MAX_ANIMATION_DELAY, Math.max(0, num(a, 'delay', p, 0))),
      direction: optOneOf(a, 'direction', p, SLIDE_DIRECTIONS),
    };
  });
}

function slide(value: unknown, path: string): SlideConfig | undefined {
  if (value === undefined || value === null) return undefined;
  const s = obj(value, path);
  const t = s['transition'] === undefined || s['transition'] === null ? undefined : obj(s['transition'], `${path}.transition`);
  return {
    order: num(s, 'order', path, 0),
    presentation: optStr(s, 'presentation', path, 120),
    hidden: s['hidden'] === undefined || s['hidden'] === null ? undefined : bool(s, 'hidden', path, false),
    notes: optStr(s, 'notes', path, 20_000),
    transition: t
      ? {
          type: oneOf(t, 'type', `${path}.transition`, SLIDE_TRANSITION_TYPES, 'none'),
          direction: optOneOf(t, 'direction', `${path}.transition`, SLIDE_DIRECTIONS),
          duration: Math.min(10_000, Math.max(0, num(t, 'duration', `${path}.transition`, 600))),
          easing: oneOf(t, 'easing', `${path}.transition`, SLIDE_EASINGS, 'ease-in-out'),
          morphBy: optOneOf(t, 'morphBy', `${path}.transition`, MORPH_BY_OPTIONS),
        }
      : undefined,
    animations: slideAnimations(s['animations'], `${path}.animations`),
    layout: s['layout'] === undefined || s['layout'] === null ? undefined : bool(s, 'layout', path, false),
    layoutName: optStr(s, 'layoutName', path, 120),
    layoutId: optStr(s, 'layoutId', path, 64),
    defaultLayout:
      s['defaultLayout'] === undefined || s['defaultLayout'] === null ? undefined : bool(s, 'defaultLayout', path, false),
    master: s['master'] === undefined || s['master'] === null ? undefined : bool(s, 'master', path, false),
    masterBackground:
      s['masterBackground'] === undefined || s['masterBackground'] === null
        ? undefined
        : bool(s, 'masterBackground', path, false),
    layoutKind: optOneOf(s, 'layoutKind', path, LAYOUT_KINDS),
    designId: optStr(s, 'designId', path, 64),
    layoutSetId: optStr(s, 'layoutSetId', path, 64),
    theme: slideTheme(s['theme'], `${path}.theme`),
  };
}

function slideTheme(value: unknown, path: string): SlideTheme | undefined {
  if (value === undefined || value === null) return undefined;
  const t = obj(value, path);
  const c = obj(t['colors'], `${path}.colors`);
  const f = obj(t['fonts'], `${path}.fonts`);
  const colors = {} as SlideTheme['colors'];
  for (const k of THEME_COLOR_TOKENS) colors[k] = color(c, k, `${path}.colors`);
  return {
    id: optStr(t, 'id', path, 64),
    kind: optOneOf(t, 'kind', path, ['theme', 'layouts', 'design'] as const),
    themeId: optStr(t, 'themeId', path, 64),
    layoutsId: optStr(t, 'layoutsId', path, 64),
    designId: optStr(t, 'designId', path, 64),
    name: str(t, 'name', path, 120),
    colors,
    fonts: { heading: str(f, 'heading', `${path}.fonts`, 32), body: str(f, 'body', `${path}.fonts`, 32) },
    layouts: themeDesign<SlideTheme['layouts']>(t['layouts'], `${path}.layouts`, themeLayoutsError),
    master: themeDesign<SlideTheme['master']>(t['master'], `${path}.master`, layoutItemsError),
    extraLayouts: themeDesign<SlideTheme['extraLayouts']>(t['extraLayouts'], `${path}.extraLayouts`, extraLayoutsError),
  };
}

function media(value: unknown, path: string): MediaConfig | undefined {
  if (value === undefined || value === null) return undefined;
  const m = obj(value, path);
  const c = m['crop'] === undefined || m['crop'] === null ? undefined : obj(m['crop'], `${path}.crop`);
  const bool = (key: string): boolean | undefined => (typeof m[key] === 'boolean' ? (m[key] as boolean) : undefined);
  return {
    crop: c
      ? {
          x: num(c, 'x', `${path}.crop`),
          y: num(c, 'y', `${path}.crop`),
          width: Math.max(0.0001, num(c, 'width', `${path}.crop`)),
          height: Math.max(0.0001, num(c, 'height', `${path}.crop`)),
        }
      : undefined,
    clip: optOneOf(m, 'clip', path, MEDIA_CLIP_SHAPES),
    clipRadius: optNum(m, 'clipRadius', path),
    playback: optOneOf(m, 'playback', path, MEDIA_PLAYBACK_MODES),
    loop: bool('loop'),
    muted: bool('muted'),
    start: optNum(m, 'start', path),
    end: optNum(m, 'end', path),
    alt: typeof m['alt'] === 'string' ? (m['alt'] as string).slice(0, 1000) : undefined,
  };
}

function placeholder(value: unknown, path: string): PlaceholderConfig | undefined {
  if (value === undefined || value === null) return undefined;
  const p = obj(value, path);
  return {
    role: optOneOf(p, 'role', path, PLACEHOLDER_ROLES),
    prompt: optStr(p, 'prompt', path, 200),
    of: optStr(p, 'of', path, 100),
  };
}

function parseColumn(raw: unknown, path: string): ColumnModel {
  const c = obj(raw, path);
  // Hand-written files (and the home seeds) may spell the type as SQL text: "VARCHAR(64)".
  const dt =
    typeof c['dataType'] === 'string' && c['dataType'].length <= 100
      ? (parseDataType(c['dataType']) as unknown as Obj)
      : obj(c['dataType'], `${path}.dataType`);
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
    isUnsigned: bool(c, 'isUnsigned', path, false),
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
    color: optColor(t, 'color', path),
    note: optStr(t, 'note', path, 10_000),
    width: optNum(t, 'width', path),
    scale: optNum(t, 'scale', path),
    groupId: optStr(t, 'groupId', path, 100),
    slideId: optStr(t, 'slideId', path, 100),
    morphId: optStr(t, 'morphId', path, 100),
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
    sourceSide: r['sourceSide'] === undefined ? undefined : oneOf(r, 'sourceSide', path, CONNECTOR_SIDES),
    targetSide: r['targetSide'] === undefined ? undefined : oneOf(r, 'targetSide', path, CONNECTOR_SIDES),
    autoRoute: r['autoRoute'] === undefined ? undefined : bool(r, 'autoRoute', path, true),
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
    strokeColor: color(e, 'strokeColor', path),
    backgroundColor: optColor(e, 'backgroundColor', path),
    fillStyle: oneOf(e, 'fillStyle', path, FILL_STYLES, 'none'),
    strokeWidth: num(e, 'strokeWidth', path, 2),
    strokeStyle: oneOf(e, 'strokeStyle', path, STROKE_STYLES, 'solid'),
    opacity: num(e, 'opacity', path, 100),
    zIndex: num(e, 'zIndex', path, 0),
    cornerRadius: optNum(e, 'cornerRadius', path),
    ellipticCorners: e['ellipticCorners'] === true ? true : undefined,
    elbow: e['elbow'] === true ? true : undefined,
    clipContent: e['clipContent'] === true ? true : undefined,
    points: points(e['points'], `${path}.points`),
    text: optStr(e, 'text', path, 100_000),
    fontSize: optNum(e, 'fontSize', path),
    fontFamily: optStr(e, 'fontFamily', path, 100),
    bold: e['bold'] === undefined || e['bold'] === null ? undefined : bool(e, 'bold', path, false),
    aboveTables: e['aboveTables'] === true ? true : undefined,
    italic:
      e['italic'] === undefined || e['italic'] === null ? undefined : bool(e, 'italic', path, false),
    lineHeight: optNum(e, 'lineHeight', path),
    wrap: e['wrap'] === undefined || e['wrap'] === null ? undefined : bool(e, 'wrap', path, false),
    runs: textRuns(e['runs'], `${path}.runs`),
    textAlign: optOneOf(e, 'textAlign', path, TEXT_ALIGNS),
    verticalAlign: optOneOf(e, 'verticalAlign', path, VERTICAL_ALIGNS),
    startBinding: binding(e['startBinding'], `${path}.startBinding`),
    endBinding: binding(e['endBinding'], `${path}.endBinding`),
    startArrowhead: optOneOf(e, 'startArrowhead', path, ARROWHEAD_TYPES),
    endArrowhead: optOneOf(e, 'endArrowhead', path, ARROWHEAD_TYPES),
    curvature: optNum(e, 'curvature', path),
    fileId: optStr(e, 'fileId', path, 100),
    media: media(e['media'], `${path}.media`),
    // 'javascript' was removed; older exports map to TypeScript.
    language: optOneOf(
      e['language'] === 'javascript' ? { ...e, language: 'typescript' } : e,
      'language',
      path,
      CODE_LANGUAGES,
    ),
    fileName: optStr(e, 'fileName', path, 120),
    diffText: optStr(e, 'diffText', path, 50000),
    diffView: optOneOf(e, 'diffView', path, CODE_DIFF_VIEWS),
    diffSplit: optNum(e, 'diffSplit', path),
    diffShowWhitespace: e['diffShowWhitespace'] == null ? undefined : bool(e, 'diffShowWhitespace', path, false),
    expandedHeight: optNum(e, 'expandedHeight', path),
    groupId: optStr(e, 'groupId', path, 100),
    slide: slide(e['slide'], `${path}.slide`),
    placeholder: placeholder(e['placeholder'], `${path}.placeholder`),
    overrides: optStr(e, 'overrides', path, 100),
    morphId: optStr(e, 'morphId', path, 100),
    morphIn: optStr(e, 'morphIn', path, 100),
    morphOut: optStr(e, 'morphOut', path, 100),
    step: optNum(e, 'step', path),
    slideId: optStr(e, 'slideId', path, 100),
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
    zIndex: num(d, 'zIndex', path, -1),
    groupId: optStr(d, 'groupId', path, 100),
    slideId: optStr(d, 'slideId', path, 100),
    backgroundColor: optColor(d, 'backgroundColor', path),
    borderColor: optColor(d, 'borderColor', path),
    title: optStr(d, 'title', path, 200),
    morphId: optStr(d, 'morphId', path, 100),
  };
}

function parseLifeline(raw: unknown, path: string): LifelineModel {
  const l = obj(raw, path);
  return {
    id: str(l, 'id', path, 100),
    diagramId: str(l, 'diagramId', path, 100),
    label: str(l, 'label', path, 255),
    color: optColor(l, 'color', path),
    lineColor: optColor(l, 'lineColor', path),
    strokeColor: optColor(l, 'strokeColor', path),
    textColor: optColor(l, 'textColor', path),
    morphId: optStr(l, 'morphId', path, 100),
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
    color: optColor(m, 'color', path),
    wrap: m['wrap'] === undefined || m['wrap'] === null ? undefined : bool(m, 'wrap', path, false),
    morphId: optStr(m, 'morphId', path, 100),
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
    fail('file', 'is not a DevDesigner project export');
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
      themes: list(s['themes'], 'schema.themes').map((t, i) => slideTheme(t, `schema.themes[${i}]`)!),
    },
  };
}
