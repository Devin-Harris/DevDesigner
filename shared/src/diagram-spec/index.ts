// Declarative diagram specs + auto-layout, used by the MCP server so a model can
// describe a whole diagram by name (no ids, no pixel coordinates) and get back a
// ready-to-import project file. Pure and environment-agnostic like the rest of
// shared. The output goes through the normal project-import path, so server-side
// validation, id minting, realtime broadcast and export/import all apply.

import { PROJECT_EXPORT_FORMAT, PROJECT_EXPORT_VERSION } from '../dto';
import type { ProjectExportFile } from '../dto';
import type { RelationshipType } from '../enums';
import { HEADER_COLOR_CYCLE, paletteNames } from '../palette';
import { resolveColorOrToken, tokenOf } from '../slides/themes';
import { morphIdForTag } from '../slides';
import { estimateTableHeight, estimateTableWidth, tableDisplayScale } from './table-metrics';
import { isUnsignedType, parseDataType } from '../sql/data-type';
import type {
  CanvasElementModel,
  ColumnModel,
  LifelineModel,
  RelationshipModel,
  SchemaModel,
  SequenceDiagramModel,
  SequenceMessageModel,
  TableModel,
} from '../models';

// --- Geometry ----------------------------------------------------------------

export * from './table-metrics';

/** An axis-aligned world-space rectangle. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A table's world-space footprint (including its display scale). */
export function tableRect(table: TableModel): Rect {
  const s = tableDisplayScale(table);
  return {
    x: table.x,
    y: table.y,
    w: Math.round(estimateTableWidth(table.name, table.columns) * s),
    h: estimateTableHeight(table.columns.length) * s,
  };
}

/** Footprint of a sequence diagram: its lifelines' extent down to the last message. */
export function sequenceDiagramRect(
  diagram: SequenceDiagramModel,
  lifelines: readonly LifelineModel[],
  messages: readonly SequenceMessageModel[],
): Rect | null {
  const own = lifelines.filter((l) => l.diagramId === diagram.id);
  if (own.length === 0) {
    return null;
  }
  const left = Math.min(...own.map((l) => l.x - l.width / 2));
  const right = Math.max(...own.map((l) => l.x + l.width / 2));
  const ys = messages.filter((m) => m.diagramId === diagram.id).map((m) => m.y);
  const bottom = Math.max(
    diagram.originY + diagram.headerHeight + diagram.rowSpacing,
    ...ys.map((y) => y + diagram.rowSpacing),
  );
  return { x: left, y: diagram.originY, w: right - left, h: bottom - diagram.originY };
}

/** Footprints of everything on the canvas that placement should avoid. */
export function schemaRects(schema: SchemaModel): Rect[] {
  const rects: Rect[] = schema.tables.map(tableRect);
  for (const e of schema.elements) {
    if (e.type === 'line' || e.type === 'arrow' || e.type === 'freedraw') {
      const pts = e.points ?? [];
      if (pts.length === 0) continue;
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      rects.push({
        x: e.x + Math.min(...xs),
        y: e.y + Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      });
    } else {
      rects.push({ x: e.x, y: e.y, w: e.width, h: e.height });
    }
  }
  for (const d of schema.sequenceDiagrams) {
    const r = sequenceDiagramRect(d, schema.lifelines, schema.sequenceMessages);
    if (r) rects.push(r);
  }
  return rects;
}

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return (
    a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y
  );
}

/** Bounding box of rectangles, or null when there are none. */
export function unionRects(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export interface FreeSpotOptions {
  /** Keep this much clearance (px) from existing content. */
  gap?: number;
  /** Prefer a spot adjacent to this rect (e.g. the table a new one relates to). */
  near?: Rect;
}

/**
 * Find a top-left for a `w` x `h` box that overlaps nothing in `existing`. With
 * `near`, tries beside it (right, below, left, above) at growing distances first;
 * otherwise scans a grid from the content's top-left, row by row. Always returns
 * a spot (falls back to below all content).
 */
export function findFreeSpot(
  existing: readonly Rect[],
  w: number,
  h: number,
  options: FreeSpotOptions = {},
): { x: number; y: number } {
  const gap = options.gap ?? 48;
  const free = (x: number, y: number): boolean =>
    !existing.some((r) => overlaps({ x, y, w, h }, r, gap));
  const bounds = unionRects(existing);
  if (!bounds) {
    return { x: 0, y: 0 };
  }
  const near = options.near;
  if (near) {
    for (let ring = 0; ring < 6; ring++) {
      const d = gap + ring * (gap + 40);
      const candidates = [
        { x: near.x + near.w + d, y: near.y },
        { x: near.x, y: near.y + near.h + d },
        { x: near.x - w - d, y: near.y },
        { x: near.x, y: near.y - h - d },
        { x: near.x + near.w + d, y: near.y + near.h + d },
        { x: near.x - w - d, y: near.y + near.h + d },
      ];
      for (const c of candidates) {
        if (free(c.x, c.y)) return c;
      }
    }
  }
  const stepX = Math.max(80, Math.round((w + gap) / 2));
  const stepY = Math.max(80, Math.round((h + gap) / 2));
  const maxX = bounds.x + Math.max(bounds.w, 1600);
  for (let y = bounds.y; y <= bounds.y + bounds.h; y += stepY) {
    for (let x = bounds.x; x <= maxX; x += stepX) {
      if (free(x, y)) return { x, y };
    }
  }
  return { x: bounds.x, y: bounds.y + bounds.h + gap * 2 };
}

// --- Auto-layout -------------------------------------------------------------

export interface LayoutNode {
  key: string;
  w: number;
  h: number;
}

export interface LayoutOptions {
  /** Horizontal gap between layers (px). */
  gapX?: number;
  /** Vertical gap between nodes in a layer (px). */
  gapY?: number;
  /** Wrap unrelated groups onto a new row past this width (px). */
  maxWidth?: number;
  /** Most nodes stacked in one column before it splits into another. */
  maxPerColumn?: number;
}

/**
 * Layered layout for a relationship graph. Connected groups are laid out
 * left-to-right by BFS depth from their best-connected node (neighbours end up in
 * adjacent columns, ordered to reduce crossings), then the groups - and lone
 * nodes - are shelf-packed into rows. Returns top-left positions with the
 * layout's own top-left at (0, 0); callers offset to a free spot.
 */
export function layoutGraph(
  nodes: readonly LayoutNode[],
  edges: ReadonlyArray<readonly [string, string]>,
  options: LayoutOptions = {},
): Map<string, { x: number; y: number }> {
  const gapX = options.gapX ?? 120;
  const gapY = options.gapY ?? 56;
  const maxWidth = options.maxWidth ?? 2000;
  const maxPerColumn = options.maxPerColumn ?? 5;

  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.key, new Set());
  for (const [a, b] of edges) {
    if (a === b || !byKey.has(a) || !byKey.has(b)) continue;
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  }

  // Connected components, each laid out into its own local box.
  const seen = new Set<string>();
  interface Group {
    positions: Map<string, { x: number; y: number }>;
    w: number;
    h: number;
    size: number;
  }
  const groups: Group[] = [];
  for (const start of nodes) {
    if (seen.has(start.key)) continue;
    const members: string[] = [];
    const queue = [start.key];
    seen.add(start.key);
    while (queue.length) {
      const k = queue.shift()!;
      members.push(k);
      for (const nb of adj.get(k)!) {
        if (!seen.has(nb)) {
          seen.add(nb);
          queue.push(nb);
        }
      }
    }
    groups.push(layoutComponent(members, adj, byKey, gapX, gapY, maxPerColumn));
  }

  // Shelf-pack: biggest groups first, wrap rows past maxWidth.
  groups.sort((a, b) => b.size - a.size || b.h - a.h);
  const out = new Map<string, { x: number; y: number }>();
  let cx = 0;
  let cy = 0;
  let rowH = 0;
  for (const g of groups) {
    if (cx > 0 && cx + g.w > maxWidth) {
      cx = 0;
      cy += rowH + gapY * 2;
      rowH = 0;
    }
    for (const [k, p] of g.positions) out.set(k, { x: cx + p.x, y: cy + p.y });
    cx += g.w + gapX;
    rowH = Math.max(rowH, g.h);
  }
  return out;
}

function layoutComponent(
  members: string[],
  adj: Map<string, Set<string>>,
  byKey: Map<string, LayoutNode>,
  gapX: number,
  gapY: number,
  maxPerColumn: number,
): { positions: Map<string, { x: number; y: number }>; w: number; h: number; size: number } {
  const positions = new Map<string, { x: number; y: number }>();
  if (members.length === 1) {
    const n = byKey.get(members[0])!;
    positions.set(n.key, { x: 0, y: 0 });
    return { positions, w: n.w, h: n.h, size: 1 };
  }
  // BFS depth from the best-connected node.
  const root = members.reduce((best, k) => (adj.get(k)!.size > adj.get(best)!.size ? k : best));
  const depth = new Map<string, number>([[root, 0]]);
  const queue = [root];
  while (queue.length) {
    const k = queue.shift()!;
    for (const nb of adj.get(k)!) {
      if (!depth.has(nb)) {
        depth.set(nb, depth.get(k)! + 1);
        queue.push(nb);
      }
    }
  }
  const layers: string[][] = [];
  for (const k of members) {
    const d = depth.get(k)!;
    (layers[d] ??= []).push(k);
  }
  // Order each layer by the mean row of already-placed neighbours (one sweep).
  const row = new Map<string, number>();
  const columns: string[][] = [];
  layers.forEach((layer, d) => {
    if (d > 0) {
      const score = (k: string): number => {
        const rows = [...adj.get(k)!].filter((nb) => row.has(nb)).map((nb) => row.get(nb)!);
        return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : Number.MAX_SAFE_INTEGER;
      };
      layer.sort((a, b) => score(a) - score(b));
    }
    for (let i = 0; i < layer.length; i += maxPerColumn) {
      const chunk = layer.slice(i, i + maxPerColumn);
      chunk.forEach((k, r) => row.set(k, r));
      columns.push(chunk);
    }
  });
  let x = 0;
  let height = 0;
  for (const col of columns) {
    let y = 0;
    let width = 0;
    for (const k of col) {
      const n = byKey.get(k)!;
      positions.set(k, { x, y });
      y += n.h + gapY;
      width = Math.max(width, n.w);
    }
    height = Math.max(height, y - gapY);
    x += width + gapX;
  }
  return { positions, w: x - gapX, h: height, size: members.length };
}

// --- Declarative spec --------------------------------------------------------

export interface SpecColumn {
  name: string;
  /** SQL-ish type: "INT", "VARCHAR(255)", "DECIMAL(10,2)", "ENUM('a','b')". Default VARCHAR(255). */
  type?: string;
  primaryKey?: boolean;
  /** Default true (false is implied for primary keys). */
  nullable?: boolean;
  unique?: boolean;
  autoIncrement?: boolean;
  default?: string;
  note?: string;
  /** Foreign-key shorthand: "table.column" this column references (adds a ONE_TO_MANY relationship). */
  references?: string;
}

export interface SpecTable {
  name: string;
  /**
   * Header color: a palette name ("blue", "amber-soft", see COLOR_ROLES) or a hex.
   * Unset: tables that are connected by relationships share one color per group.
   */
  color?: string;
  note?: string;
  columns: SpecColumn[];
}

export interface SpecRelationship {
  /** "table.column" on the referenced ("one") side. */
  from: string;
  /** "table.column" on the referencing ("many") side. */
  to: string;
  type?: RelationshipType;
  onDelete?: string;
  onUpdate?: string;
}

export interface SpecMessage {
  from: string;
  to: string;
  label?: string;
  /** solid = call, dashed = return/async, break = label-only divider. */
  style?: 'solid' | 'dashed' | 'break';
  /** Arrow color (palette name or hex); leave unset unless it carries meaning (error path...). */
  color?: string;
  /** Morph tag: the same tag on the next slide's message animates into this one even if reworded. */
  morph?: string;
}

/** A participant with options; a plain string is just its name. */
export interface SpecParticipant {
  name: string;
  /** Header color (palette name or hex). */
  color?: string;
  /** Color of the dashed line under the header. */
  lineColor?: string;
  /** Header border color. */
  strokeColor?: string;
  /** Header label color. */
  textColor?: string;
  /** Morph tag: pairs this participant with the same tag on the next slide even if renamed. */
  morph?: string;
}

export interface SpecSequenceDiagram {
  /** What the diagram shows; drawn at its top-left. */
  title?: string;
  participants: Array<string | SpecParticipant>;
  messages: SpecMessage[];
  /** Diagram box background (palette name or hex); text color adapts. */
  background?: string;
  /** Morph tag pairing this whole diagram with the same tag on the next slide. */
  morph?: string;
}

export interface DiagramSpec {
  tables?: SpecTable[];
  relationships?: SpecRelationship[];
  sequenceDiagrams?: SpecSequenceDiagram[];
}

export interface BuiltSpec {
  file: ProjectExportFile;
  /** Human-readable problems found while resolving references (skipped, not fatal). */
  warnings: string[];
}

/**
 * Resolve a color given by name or hex; an unknown color adds a warning that lists
 * the valid names and falls back to `undefined` (the theme default).
 */
function colorOrWarn(
  input: string | undefined,
  what: string,
  warnings: string[],
): string | undefined {
  if (!input?.trim()) return undefined;
  const hex = resolveColorOrToken(input);
  if (hex) return hex;
  warnings.push(`Unknown color "${input}" for ${what}; ignored. Use a theme token ($accent1, ...), a hex like #2f6bff or one of: ${paletteNames()}.`);
  return undefined;
}

/** Connected groups of tables (by relationships), each as a list of table indexes. */
function tableGroups(tableCount: number, edges: ReadonlyArray<readonly [number, number]>): number[][] {
  const parent = Array.from({ length: tableCount }, (_v, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const [a, b] of edges) parent[find(a)] = find(b);
  const groups = new Map<number, number[]>();
  for (let i = 0; i < tableCount; i++) {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  }
  return [...groups.values()].sort((a, b) => a[0] - b[0]);
}

function splitRef(ref: string): { table: string; column: string } | null {
  const i = ref.lastIndexOf('.');
  if (i <= 0 || i === ref.length - 1) return null;
  return { table: ref.slice(0, i).trim(), column: ref.slice(i + 1).trim() };
}

/**
 * Turn a declarative spec into an export file with auto-laid-out positions.
 * `origin` is where the new content's top-left lands (callers pass a free spot
 * below existing content). References are resolved case-insensitively by name.
 */
export function buildSpecFile(
  spec: DiagramSpec,
  options: {
    projectName?: string;
    origin?: { x: number; y: number };
    /** Prepended to every generated id, so several built specs can share one file. */
    idPrefix?: string;
  } = {},
): BuiltSpec {
  const warnings: string[] = [];
  const origin = options.origin ?? { x: 0, y: 0 };
  let next = 0;
  const idPrefix = options.idPrefix ?? '';
  const id = (prefix: string): string => `${idPrefix}${prefix}${++next}`;

  const tables: TableModel[] = [];
  const tableByName = new Map<string, TableModel>();
  for (const t of spec.tables ?? []) {
    const key = t.name.toLowerCase();
    if (tableByName.has(key)) {
      warnings.push(`Duplicate table "${t.name}" skipped.`);
      continue;
    }
    const seenCols = new Set<string>();
    const columns: ColumnModel[] = [];
    for (const c of t.columns) {
      if (seenCols.has(c.name.toLowerCase())) {
        warnings.push(`Duplicate column "${t.name}.${c.name}" skipped.`);
        continue;
      }
      seenCols.add(c.name.toLowerCase());
      columns.push({
        id: id('c'),
        name: c.name,
        dataType: parseDataType(c.type),
        isPrimaryKey: c.primaryKey ?? false,
        isNullable: c.nullable ?? !(c.primaryKey ?? false),
        isUnique: c.unique ?? false,
        isAutoIncrement: c.autoIncrement ?? false,
        ...(isUnsignedType(c.type) ? { isUnsigned: true } : {}),
        defaultValue: c.default,
        note: c.note,
      });
    }
    // Database tables do not follow a deck theme.
    const color = tokenOf(t.color) === null ? colorOrWarn(t.color, `table "${t.name}"`, warnings) : undefined;
    if (tokenOf(t.color) !== null) warnings.push(`Table "${t.name}": theme tokens are not supported on database tables; color ignored.`);
    const table: TableModel = {
      id: id('t'),
      name: t.name,
      columns,
      x: 0,
      y: 0,
      ...(color ? { color } : {}),
      note: t.note,
    };
    tables.push(table);
    tableByName.set(key, table);
  }

  const findColumn = (ref: string): ColumnModel | null => {
    const parts = splitRef(ref);
    if (!parts) {
      warnings.push(`Reference "${ref}" must look like "table.column".`);
      return null;
    }
    const table = tableByName.get(parts.table.toLowerCase());
    const column = table?.columns.find((c) => c.name.toLowerCase() === parts.column.toLowerCase());
    if (!column) {
      warnings.push(`Reference "${ref}" does not match any table/column in the spec.`);
      return null;
    }
    return column;
  };

  const relationships: RelationshipModel[] = [];
  const addRel = (
    sourceRef: string,
    targetRef: string,
    type: RelationshipType,
    onDelete?: string,
    onUpdate?: string,
  ): void => {
    const source = findColumn(sourceRef);
    const target = findColumn(targetRef);
    if (!source || !target) return;
    relationships.push({
      id: id('r'),
      sourceColumnId: source.id,
      targetColumnId: target.id,
      type,
      onDelete,
      onUpdate,
    });
  };
  for (const t of spec.tables ?? []) {
    for (const c of t.columns) {
      if (c.references) addRel(c.references, `${t.name}.${c.name}`, 'ONE_TO_MANY');
    }
  }
  for (const r of spec.relationships ?? []) {
    addRel(r.from, r.to, r.type ?? 'ONE_TO_MANY', r.onDelete, r.onUpdate);
  }

  // Tables: layered layout over the relationship graph.
  const tableOfColumn = new Map<string, string>();
  for (const t of tables) for (const c of t.columns) tableOfColumn.set(c.id, t.id);
  const edges: Array<[string, string]> = [];
  for (const r of relationships) {
    const a = tableOfColumn.get(r.sourceColumnId);
    const b = tableOfColumn.get(r.targetColumnId);
    if (a && b) edges.push([a, b]);
  }

  // Tables without a color get one per connected group, so related tables read as a
  // domain and unrelated groups differ.
  const indexOf = new Map(tables.map((t, i) => [t.id, i] as const));
  const groupEdges = edges.map(([a, b]) => [indexOf.get(a)!, indexOf.get(b)!] as const);
  tableGroups(tables.length, groupEdges).forEach((members, g) => {
    const auto = HEADER_COLOR_CYCLE[g % HEADER_COLOR_CYCLE.length];
    for (const m of members) {
      if (!tables[m].color) tables[m].color = auto;
    }
  });
  const layout = layoutGraph(
    tables.map((t) => ({
      key: t.id,
      w: estimateTableWidth(t.name, t.columns),
      h: estimateTableHeight(t.columns.length),
    })),
    edges,
  );
  for (const t of tables) {
    const p = layout.get(t.id)!;
    t.x = origin.x + Math.round(p.x);
    t.y = origin.y + Math.round(p.y);
  }
  const tablesBottom = tables.length
    ? Math.max(...tables.map((t) => t.y + estimateTableHeight(t.columns.length)))
    : origin.y - 120;

  // Sequence diagrams: stacked below the tables.
  const diagrams: SequenceDiagramModel[] = [];
  const lifelines: LifelineModel[] = [];
  const messages: SequenceMessageModel[] = [];
  let seqY = tablesBottom + 120;
  for (const s of spec.sequenceDiagrams ?? []) {
    const diagram = buildSequence(s, origin.x, seqY, id, warnings);
    diagrams.push(diagram.diagram);
    lifelines.push(...diagram.lifelines);
    messages.push(...diagram.messages);
    seqY = diagram.bottom + 120;
  }

  const schema: SchemaModel = {
    tables,
    relationships,
    notes: [],
    elements: [],
    sequenceDiagrams: diagrams,
    lifelines,
    sequenceMessages: messages,
    viewport: { x: 0, y: 0, zoom: 1 },
    home: null,
  };
  const file: ProjectExportFile = {
    format: PROJECT_EXPORT_FORMAT,
    version: PROJECT_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    project: { name: options.projectName ?? 'Imported', description: null, type: 'ERD' },
    schema,
  };
  return { file, warnings };
}

/** Geometry defaults for a sequence diagram (match the server's create defaults). */
export const SEQUENCE_DEFAULTS = {
  lifelineSpacing: 160,
  rowSpacing: 48,
  headerHeight: 42,
  lifelineWidth: 120,
} as const;

function buildSequence(
  spec: SpecSequenceDiagram,
  originX: number,
  originY: number,
  id: (prefix: string) => string,
  warnings: string[],
): {
  diagram: SequenceDiagramModel;
  lifelines: LifelineModel[];
  messages: SequenceMessageModel[];
  bottom: number;
} {
  const d = SEQUENCE_DEFAULTS;
  const diagram: SequenceDiagramModel = {
    id: id('d'),
    lifelineSpacing: d.lifelineSpacing,
    rowSpacing: d.rowSpacing,
    headerHeight: d.headerHeight,
    originY,
    zIndex: -1,
    ...(spec.title?.trim() ? { title: spec.title.trim() } : {}),
    ...(spec.morph?.trim() ? { morphId: morphIdForTag(spec.morph) ?? undefined } : {}),
  };
  const background = colorOrWarn(spec.background, 'the diagram background', warnings);
  if (background) diagram.backgroundColor = background;
  const byName = new Map<string, LifelineModel>();
  const lifelines: LifelineModel[] = [];
  const addParticipant = (p: string | SpecParticipant): LifelineModel => {
    const opts: SpecParticipant = typeof p === 'string' ? { name: p } : p;
    const name = opts.name;
    const existing = byName.get(name.toLowerCase());
    if (existing) return existing;
    const n = lifelines.length;
    const color = colorOrWarn(opts.color, `participant "${name}"`, warnings);
    const lineColor = colorOrWarn(opts.lineColor, `participant "${name}" line`, warnings);
    const strokeColor = colorOrWarn(opts.strokeColor, `participant "${name}" stroke`, warnings);
    const textColor = colorOrWarn(opts.textColor, `participant "${name}" text`, warnings);
    const tag = opts.morph?.trim() ? morphIdForTag(opts.morph) : null;
    const lifeline: LifelineModel = {
      id: id('l'),
      diagramId: diagram.id,
      label: name,
      x: originX + d.lifelineWidth / 2 + n * d.lifelineSpacing,
      width: d.lifelineWidth,
      order: n,
      ...(color ? { color } : {}),
      ...(lineColor ? { lineColor } : {}),
      ...(strokeColor ? { strokeColor } : {}),
      ...(textColor ? { textColor } : {}),
      ...(tag ? { morphId: tag } : {}),
    };
    lifelines.push(lifeline);
    byName.set(name.toLowerCase(), lifeline);
    return lifeline;
  };
  for (const p of spec.participants) addParticipant(p);

  const messages: SequenceMessageModel[] = [];
  let y = originY + d.headerHeight + d.rowSpacing;
  for (const m of spec.messages) {
    const from = byName.get(m.from.toLowerCase());
    const to = byName.get(m.to.toLowerCase());
    if (!from || !to) {
      warnings.push(
        `Message "${m.label ?? ''}" references unknown participant "${!from ? m.from : m.to}"; skipped.`,
      );
      continue;
    }
    if (from === to && m.style !== 'break') {
      warnings.push(
        `Message "${m.label ?? ''}" goes from "${m.from}" to itself; a message needs two different participants, skipped.`,
      );
      continue;
    }
    const color = colorOrWarn(m.color, `message "${m.label ?? ''}"`, warnings);
    const tag = m.morph?.trim() ? morphIdForTag(m.morph) : null;
    messages.push({
      id: id('m'),
      diagramId: diagram.id,
      fromLifelineId: from.id,
      toLifelineId: to.id,
      label: m.label,
      y,
      style: m.style ?? 'solid',
      direction: 'forward',
      arrowhead: m.style === 'dashed' ? 'open' : 'arrow',
      ...(color ? { color } : {}),
      ...(tag ? { morphId: tag } : {}),
    });
    y += d.rowSpacing;
  }
  return { diagram, lifelines, messages, bottom: y };
}

// --- Drawing helpers ---------------------------------------------------------

/** Rough text footprint for a text element (the client refits on first edit). */
export function estimateTextSize(
  text: string,
  fontSize: number,
  lineHeight = 1.25,
): { width: number; height: number } {
  const lines = text.split('\n');
  const longest = Math.max(...lines.map((l) => l.length), 1);
  return {
    width: Math.ceil(longest * fontSize * 0.58) + 8,
    height: Math.ceil(lines.length * fontSize * lineHeight) + 4,
  };
}

/** Where a line from `from`'s centre toward `to`'s centre leaves `from`'s rectangle. */
export function edgePoint(from: Rect, to: Rect): { x: number; y: number } {
  const cx = from.x + from.w / 2;
  const cy = from.y + from.h / 2;
  const tx = to.x + to.w / 2 - cx;
  const ty = to.y + to.h / 2 - cy;
  if (tx === 0 && ty === 0) return { x: cx, y: cy };
  const sx = tx === 0 ? Infinity : from.w / 2 / Math.abs(tx);
  const sy = ty === 0 ? Infinity : from.h / 2 / Math.abs(ty);
  const s = Math.min(sx, sy);
  return { x: cx + tx * s, y: cy + ty * s };
}

/** Element rect used when anchoring arrows (frames and shapes use their box). */
export function elementRect(e: CanvasElementModel): Rect {
  return { x: e.x, y: e.y, w: e.width, h: e.height };
}
