// Pure geometry for the layout tools: what is on the canvas (as rectangles), which
// items overlap / run outside their slide, how to compact and scale a set of items,
// and how to re-stack elements and sequence diagrams. No network, no MCP types, so it
// unit-tests. The tools in layout-tools.ts turn these plans into REST writes.

import {
  gridSummary,
  MAX_TABLE_SCALE,
  MIN_TABLE_SCALE,
  sequenceDiagramRect,
  tableDisplayScale,
  tableRect,
  wrappedTextHeight,
  type CanvasElementModel,
  type PointModel,
  type Rect,
  type SchemaModel,
} from '@dbdesigner/shared';

/** A sequence diagram's rounded box extends this far past its participants and rows. */
export const SEQUENCE_BOX_PAD = 26;

const LINE_TYPES = new Set<string>(['line', 'arrow', 'freedraw']);

export type ItemKind = 'table' | 'element' | 'diagram';

/** One thing on the canvas, reduced to what layout needs. */
export interface LayoutItem {
  /** `kind:id`, unique across kinds. */
  key: string;
  kind: ItemKind;
  id: string;
  /** Human-readable name for reports. */
  label: string;
  rect: Rect;
  /** Element type (rectangle, text, code, ...) for kind 'element'. */
  type?: string;
  slideId?: string;
  groupId?: string;
}

export interface SlideFrame {
  id: string;
  presentation?: string;
  order: number;
  rect: Rect;
}

export const keyOf = (kind: ItemKind, id: string): string => `${kind}:${id}`;

const round = (n: number): number => Math.round(n * 100) / 100;

export function isLineElement(e: CanvasElementModel): boolean {
  return LINE_TYPES.has(e.type);
}

/** Bounding box of a line/arrow/freehand stroke (points are relative to x/y). */
function strokeRect(e: CanvasElementModel): Rect | null {
  const pts = e.points ?? [];
  if (pts.length === 0) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    x: e.x + Math.min(...xs),
    y: e.y + Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

export function elementLabel(e: CanvasElementModel): string {
  const text = (e.type === 'grid' ? gridSummary(e.text, 40) : e.text)?.replace(/\s+/g, ' ').trim();
  return text ? `${e.type} "${text.length > 36 ? `${text.slice(0, 33)}...` : text}" (${e.id})` : `${e.type} ${e.id}`;
}

export interface CollectOptions {
  /** 'none' leaves lines/arrows/strokes out; 'free' keeps those with an unbound end; 'all' keeps every one. */
  lines?: 'none' | 'free' | 'all';
}

/** Every table, drawing element (frames excluded) and sequence diagram as a LayoutItem. */
export function collectItems(schema: SchemaModel, options: CollectOptions = {}): LayoutItem[] {
  const lines = options.lines ?? 'none';
  const items: LayoutItem[] = [];
  for (const t of schema.tables) {
    items.push({
      key: keyOf('table', t.id),
      kind: 'table',
      id: t.id,
      label: `table "${t.name}"`,
      rect: tableRect(t),
      ...(t.slideId ? { slideId: t.slideId } : {}),
      ...(t.groupId ? { groupId: t.groupId } : {}),
    });
  }
  for (const e of schema.elements) {
    if (e.type === 'frame') continue;
    let rect: Rect | null;
    if (isLineElement(e)) {
      if (lines === 'none') continue;
      if (lines === 'free' && e.startBinding && e.endBinding) continue;
      rect = strokeRect(e);
    } else {
      rect = { x: e.x, y: e.y, w: e.width, h: e.height };
    }
    if (!rect) continue;
    items.push({
      key: keyOf('element', e.id),
      kind: 'element',
      id: e.id,
      label: elementLabel(e),
      type: e.type,
      rect,
      ...(e.slideId ? { slideId: e.slideId } : {}),
      ...(e.groupId ? { groupId: e.groupId } : {}),
    });
  }
  for (const d of schema.sequenceDiagrams) {
    const r = sequenceDiagramRect(d, schema.lifelines, schema.sequenceMessages);
    if (!r) continue;
    items.push({
      key: keyOf('diagram', d.id),
      kind: 'diagram',
      id: d.id,
      label: `sequence diagram ${d.title ? `"${d.title}" ` : ''}(${d.id})`,
      rect: {
        x: r.x - SEQUENCE_BOX_PAD,
        y: r.y - SEQUENCE_BOX_PAD,
        w: r.w + SEQUENCE_BOX_PAD * 2,
        h: r.h + SEQUENCE_BOX_PAD * 2,
      },
      ...(d.slideId ? { slideId: d.slideId } : {}),
      ...(d.groupId ? { groupId: d.groupId } : {}),
    });
  }
  return items;
}

/** The slide frames (frames carrying a `slide` config). */
export function slideFramesOf(schema: SchemaModel): SlideFrame[] {
  return schema.elements
    .filter((e) => e.type === 'frame' && e.slide)
    .map((e) => ({
      id: e.id,
      presentation: e.slide?.presentation,
      order: e.slide?.order ?? 0,
      rect: { x: e.x, y: e.y, w: e.width, h: e.height },
    }));
}

// --- Geometry ---------------------------------------------------------------------

export function intersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

function contains(outer: Rect, inner: Rect, tol: number): boolean {
  return (
    inner.x >= outer.x - tol &&
    inner.y >= outer.y - tol &&
    inner.x + inner.w <= outer.x + outer.w + tol &&
    inner.y + inner.h <= outer.y + outer.h + tol
  );
}

export function unionOf(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const sameSlide = (a: LayoutItem, b: LayoutItem): boolean => (a.slideId ?? '') === (b.slideId ?? '');

// --- Checks -----------------------------------------------------------------------

export interface OverlapIssue {
  a: LayoutItem;
  b: LayoutItem;
  intersection: Rect;
  /** Intersection area as a fraction of the smaller item's area (0..1). */
  fractionOfSmaller: number;
}

/**
 * Pairs of items that partly cover each other. Items on different slides are never
 * compared (stacked slides share one spot by design); an item lying entirely inside
 * another (a label on a box, a table inside a container) is intentional nesting and is
 * skipped unless `includeNested`.
 */
export function findOverlaps(
  items: readonly LayoutItem[],
  options: { tolerance?: number; includeNested?: boolean } = {},
): OverlapIssue[] {
  const tol = options.tolerance ?? 2;
  const out: OverlapIssue[] = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i];
      const b = items[j];
      if (!sameSlide(a, b)) continue;
      const hit = intersection(a.rect, b.rect);
      if (!hit || hit.w <= tol || hit.h <= tol) continue;
      if (!options.includeNested && (contains(a.rect, b.rect, tol) || contains(b.rect, a.rect, tol))) {
        continue;
      }
      const smaller = Math.max(1, Math.min(a.rect.w * a.rect.h, b.rect.w * b.rect.h));
      out.push({
        a,
        b,
        intersection: hit,
        fractionOfSmaller: Math.min(1, (hit.w * hit.h) / smaller),
      });
    }
  }
  return out.sort((p, q) => q.fractionOfSmaller - p.fractionOfSmaller);
}

export interface BoundsIssue {
  item: LayoutItem;
  frame: SlideFrame;
  /** How far the item sticks out past each side of the slide (px, 0 = inside). */
  overflow: { left: number; top: number; right: number; bottom: number };
  fullyOutside: boolean;
}

export type FramePlacement = 'inside' | 'partial' | 'offslide';

/**
 * Where an item sits relative to a slide frame. `offslide` items are staged outside
 * the frame on purpose (morph entrances/exits): never shown, never laid out.
 */
export function placement(r: Rect, f: Rect, tolerance = 1): FramePlacement {
  if (!intersection(f, r)) return 'offslide';
  const inside =
    r.x >= f.x - tolerance &&
    r.y >= f.y - tolerance &&
    r.x + r.w <= f.x + f.w + tolerance &&
    r.y + r.h <= f.y + f.h + tolerance;
  return inside ? 'inside' : 'partial';
}

/** Slide-owned items staged wholly outside their slide's frame. */
export function findOffSlide(items: readonly LayoutItem[], frames: readonly SlideFrame[]): LayoutItem[] {
  const byId = new Map(frames.map((f) => [f.id, f]));
  return items.filter((i) => {
    const f = i.slideId ? byId.get(i.slideId) : undefined;
    return !!f && placement(i.rect, f.rect) === 'offslide';
  });
}

/**
 * Slide-owned items that stick out past their slide's frame. Items wholly outside are
 * staging (see `placement`), not a problem, and are left out.
 */
export function findOutOfBounds(
  items: readonly LayoutItem[],
  frames: readonly SlideFrame[],
  tolerance = 1,
): BoundsIssue[] {
  const byId = new Map(frames.map((f) => [f.id, f]));
  const out: BoundsIssue[] = [];
  for (const item of items) {
    const frame = item.slideId ? byId.get(item.slideId) : undefined;
    if (!frame || placement(item.rect, frame.rect) === 'offslide') continue;
    const f = frame.rect;
    const r = item.rect;
    const overflow = {
      left: Math.max(0, round(f.x - r.x)),
      top: Math.max(0, round(f.y - r.y)),
      right: Math.max(0, round(r.x + r.w - (f.x + f.w))),
      bottom: Math.max(0, round(r.y + r.h - (f.y + f.h))),
    };
    if (Object.values(overflow).every((v) => v <= tolerance)) continue;
    out.push({ item, frame, overflow, fullyOutside: !intersection(f, r) });
  }
  return out;
}

export interface UnattachedIssue {
  item: LayoutItem;
  frame: SlideFrame;
}

/** Items that belong to no slide but whose centre sits on a slide frame. */
export function findUnattached(items: readonly LayoutItem[], frames: readonly SlideFrame[]): UnattachedIssue[] {
  const out: UnattachedIssue[] = [];
  for (const item of items) {
    if (item.slideId) continue;
    const cx = item.rect.x + item.rect.w / 2;
    const cy = item.rect.y + item.rect.h / 2;
    const frame = frames.find(
      (f) => cx >= f.rect.x && cx <= f.rect.x + f.rect.w && cy >= f.rect.y && cy <= f.rect.y + f.rect.h,
    );
    if (frame) out.push({ item, frame });
  }
  return out;
}

export interface TextOverflowIssue {
  item: LayoutItem;
  problem: string;
  /** What to do about it. */
  suggestion: string;
}

/**
 * Text that probably does not fit its box: shape labels (wrapped to the usable width of
 * the shape) and code cards (more lines / wider lines than the card). Estimates, like
 * the rest of the server-side geometry, so it errs toward flagging only clear misses.
 */
export function findTextOverflow(schema: SchemaModel, scope?: (e: CanvasElementModel) => boolean): TextOverflowIssue[] {
  const out: TextOverflowIssue[] = [];
  const items = new Map(collectItems(schema).map((i) => [i.id, i]));
  for (const e of schema.elements) {
    if (scope && !scope(e)) continue;
    const item = items.get(e.id);
    if (!item || !e.text) continue;
    if (e.type === 'rectangle' || e.type === 'ellipse' || e.type === 'diamond') {
      const fontSize = e.fontSize ?? 18;
      const inset = e.type === 'rectangle' ? 0.9 : e.type === 'ellipse' ? 0.7 : 0.5;
      const usable = Math.max(20, e.width * inset - 16);
      const need = wrappedTextHeight(e.text, fontSize, usable);
      const longestWord = Math.max(...e.text.split(/\s+/).map((w) => w.length), 1) * fontSize * 0.56;
      if (need > e.height - 8) {
        out.push({
          item,
          problem: `text needs about ${Math.round(need)}px of height but the ${e.type} is ${Math.round(e.height)}px tall`,
          suggestion: 'enlarge the shape, shorten the text, or lower fontSize (style_elements)',
        });
      } else if (longestWord > usable) {
        out.push({
          item,
          problem: `a word is about ${Math.round(longestWord)}px wide but the usable width is ${Math.round(usable)}px`,
          suggestion: 'widen the shape or lower fontSize (style_elements)',
        });
      }
    } else if (e.type === 'code' && e.expandedHeight === undefined) {
      const size = e.fontSize ?? 20;
      const lines = e.text.split('\n');
      const longest = Math.max(...lines.map((l) => l.length), 1);
      const header = Math.round(size * 1.5 + 14);
      const needH = header + Math.ceil(lines.length * size * 1.5) + 32;
      const needW = Math.ceil(longest * size * 0.62) + 32;
      if (needH > e.height + 4) {
        out.push({
          item,
          problem: `${lines.length} lines need about ${needH}px of height but the code card is ${Math.round(e.height)}px tall`,
          suggestion: 'raise its height, split the code, or lower fontSize (style_elements)',
        });
      } else if (needW > e.width + 4) {
        out.push({
          item,
          problem: `the longest line needs about ${needW}px of width but the code card is ${Math.round(e.width)}px wide`,
          suggestion: 'widen the card or lower fontSize (style_elements)',
        });
      }
    }
  }
  return out;
}

// --- Compaction ---------------------------------------------------------------------

/** Items that must move together: same group, or overlapping each other. */
export interface Unit {
  keys: string[];
  rect: Rect;
}

export function buildUnits(items: readonly LayoutItem[], tolerance = 1): Unit[] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number): void => {
    parent[find(a)] = find(b);
  };
  const byGroup = new Map<string, number>();
  items.forEach((it, i) => {
    if (!it.groupId) return;
    const first = byGroup.get(it.groupId);
    if (first === undefined) byGroup.set(it.groupId, i);
    else union(first, i);
  });
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const hit = intersection(items[i].rect, items[j].rect);
      if (hit && hit.w > tolerance && hit.h > tolerance) union(i, j);
    }
  }
  const clusters = new Map<number, number[]>();
  items.forEach((_, i) => {
    const root = find(i);
    clusters.set(root, [...(clusters.get(root) ?? []), i]);
  });
  return [...clusters.values()].map((idx) => ({
    keys: idx.map((i) => items[i].key),
    rect: unionOf(idx.map((i) => items[i].rect)) as Rect,
  }));
}

/**
 * Close empty gutters: wherever no unit crosses a band wider than `gap` along `axis`,
 * shrink the band to `gap`. Everything keeps its alignment; only empty space goes.
 * Returns each unit's shift (<= 0).
 */
export function squeezeDeltas(rects: readonly Rect[], axis: 'x' | 'y', gap: number): number[] {
  const start = (r: Rect): number => (axis === 'x' ? r.x : r.y);
  const size = (r: Rect): number => (axis === 'x' ? r.w : r.h);
  const order = rects.map((_, i) => i).sort((i, j) => start(rects[i]) - start(rects[j]));
  const deltas = new Array<number>(rects.length).fill(0);
  let end = -Infinity;
  let removed = 0;
  for (const i of order) {
    const s = start(rects[i]);
    if (end !== -Infinity && s > end + gap) removed += s - end - gap;
    end = Math.max(end, s + size(rects[i]));
    deltas[i] = removed === 0 ? 0 : -removed;
  }
  return deltas;
}

/**
 * Slide every unit toward the top-left corner of the content until it rests `gap` from
 * whatever is in its way (a shelf-style "gravity"). Never moves anything right/down.
 */
export function gravityDeltas(rects: readonly Rect[], axis: 'x' | 'y', gap: number): number[] {
  const a = axis;
  const s = axis === 'x' ? 'w' : 'h';
  const cross = axis === 'x' ? 'y' : 'x';
  const crossS = axis === 'x' ? 'h' : 'w';
  const order = rects
    .map((_, i) => i)
    .sort((i, j) => rects[i][a] - rects[j][a] || rects[i][cross] - rects[j][cross]);
  const origin = Math.min(...rects.map((r) => r[a]));
  const placed: Array<{ i: number; pos: number }> = [];
  const deltas = new Array<number>(rects.length).fill(0);
  for (const i of order) {
    const r = rects[i];
    let pos = origin;
    for (const p of placed) {
      const q = rects[p.i];
      const shareBand = q[cross] < r[cross] + r[crossS] + gap && q[cross] + q[crossS] + gap > r[cross];
      if (shareBand) pos = Math.max(pos, p.pos + q[s] + gap);
    }
    pos = Math.min(pos, r[a]);
    deltas[i] = pos - r[a];
    placed.push({ i, pos });
  }
  return deltas;
}

export interface CompactOptions {
  mode: 'gutters' | 'gravity';
  gap: number;
  axis: 'both' | 'x' | 'y';
}

/** Per-unit (dx, dy) that compacts `units`; the content's top-left corner stays put. */
export function compactUnits(units: readonly Unit[], options: CompactOptions): Array<{ dx: number; dy: number }> {
  const rects = units.map((u) => ({ ...u.rect }));
  const total = units.map(() => ({ dx: 0, dy: 0 }));
  const pass = (axis: 'x' | 'y'): void => {
    const deltas =
      options.mode === 'gutters' ? squeezeDeltas(rects, axis, options.gap) : gravityDeltas(rects, axis, options.gap);
    deltas.forEach((d, i) => {
      const v = Math.round(d);
      if (axis === 'x') {
        rects[i].x += v;
        total[i].dx += v;
      } else {
        rects[i].y += v;
        total[i].dy += v;
      }
    });
  };
  if (options.axis !== 'y') pass('x');
  if (options.axis !== 'x') pass('y');
  return total;
}

// --- Scaling ------------------------------------------------------------------------

export interface ScaleSelection {
  tableIds: ReadonlySet<string>;
  elementIds: ReadonlySet<string>;
  diagramIds: ReadonlySet<string>;
}

export interface ScaledElement {
  id: string;
  /** PATCH /elements/:id body (size, text size...). */
  patch: Record<string, unknown>;
  /** PATCH /elements/:id/position body, when the position or vertices change. */
  position?: { x: number; y: number; points?: PointModel[] };
}

export interface ScalePlan {
  /** Factor the caller asked for, and the one actually applied (tables clamp to 0.4-3). */
  requested: number;
  applied: number;
  origin: { x: number; y: number };
  tables: Array<{ id: string; name: string; scale: number; x: number; y: number }>;
  elements: ScaledElement[];
  /** Diagrams cannot be scaled (their text/spacing are fixed); they only get a new top-left. */
  diagramShifts: Array<{ id: string; dx: number; dy: number }>;
  waypoints: Array<{ id: string; waypoints: PointModel[] }>;
  notes: string[];
}

export interface ScaleOptions {
  /** Multiply the current size by this (groups scale about their top-left corner). */
  factor?: number;
  /** Tables only: set every table to exactly this scale; positions stay. */
  absoluteScale?: number;
  /** With `factor`: also scale the distances between items (default true). */
  reposition?: boolean;
  /** Extra shift after scaling (used when fitting into a slide). */
  translate?: { dx: number; dy: number };
}

export function planScale(schema: SchemaModel, sel: ScaleSelection, options: ScaleOptions): ScalePlan {
  const tables = schema.tables.filter((t) => sel.tableIds.has(t.id));
  const elements = schema.elements.filter((e) => sel.elementIds.has(e.id) && e.type !== 'frame');
  const diagrams = schema.sequenceDiagrams.filter((d) => sel.diagramIds.has(d.id));
  const notes: string[] = [];
  const itemsByKey = new Map(collectItems(schema, { lines: 'all' }).map((i) => [i.key, i]));
  const rects: Rect[] = [
    ...tables.map((t) => itemsByKey.get(keyOf('table', t.id))?.rect),
    ...elements.map((e) => itemsByKey.get(keyOf('element', e.id))?.rect),
    ...diagrams.map((d) => itemsByKey.get(keyOf('diagram', d.id))?.rect),
  ].filter((r): r is Rect => !!r);
  const box = unionOf(rects) ?? { x: 0, y: 0, w: 0, h: 0 };
  const origin = { x: box.x, y: box.y };
  const shift = options.translate ?? { dx: 0, dy: 0 };

  const absolute = options.absoluteScale !== undefined;
  const requested = absolute ? 1 : (options.factor ?? 1);
  let applied = requested;
  if (!absolute && tables.length) {
    const lo = Math.max(...tables.map((t) => MIN_TABLE_SCALE / tableDisplayScale(t)));
    const hi = Math.min(...tables.map((t) => MAX_TABLE_SCALE / tableDisplayScale(t)));
    applied = lo <= hi ? Math.min(hi, Math.max(lo, requested)) : 1;
    if (applied !== requested) {
      notes.push(
        `Tables can only be scaled between ${MIN_TABLE_SCALE}x and ${MAX_TABLE_SCALE}x; applied factor ${round(applied)} instead of ${round(requested)}.`,
      );
    }
  }
  const reposition = !absolute && options.reposition !== false;
  const move = (x: number, y: number): { x: number; y: number } =>
    reposition
      ? {
          x: Math.round(origin.x + (x - origin.x) * applied + shift.dx),
          y: Math.round(origin.y + (y - origin.y) * applied + shift.dy),
        }
      : { x: Math.round(x + shift.dx), y: Math.round(y + shift.dy) };

  const plan: ScalePlan = {
    requested: round(requested),
    applied: round(applied),
    origin,
    tables: [],
    elements: [],
    diagramShifts: [],
    waypoints: [],
    notes,
  };

  for (const t of tables) {
    const next = absolute
      ? Math.min(MAX_TABLE_SCALE, Math.max(MIN_TABLE_SCALE, options.absoluteScale as number))
      : tableDisplayScale(t) * applied;
    const p = move(t.x, t.y);
    plan.tables.push({ id: t.id, name: t.name, scale: round(next), ...p });
  }

  if (!absolute) {
    for (const e of elements) {
      const p = move(e.x, e.y);
      const patch: Record<string, unknown> = {};
      if (applied !== 1) {
        patch.width = round(e.width * applied);
        patch.height = round(e.height * applied);
        if (e.fontSize) patch.fontSize = Math.max(6, round(e.fontSize * applied));
        if (e.cornerRadius) patch.cornerRadius = round(e.cornerRadius * applied);
        if (e.expandedHeight) patch.expandedHeight = round(e.expandedHeight * applied);
        if (e.strokeWidth && isLineElement(e)) patch.strokeWidth = Math.max(1, round(e.strokeWidth * applied));
      }
      const points =
        applied !== 1 && e.points
          ? e.points.map((q) => ({ x: round(q.x * applied), y: round(q.y * applied) }))
          : undefined;
      const moved = p.x !== Math.round(e.x) || p.y !== Math.round(e.y);
      plan.elements.push({
        id: e.id,
        patch,
        ...(moved || points ? { position: { x: p.x, y: p.y, ...(points ? { points } : {}) } } : {}),
      });
    }
    for (const d of diagrams) {
      const r = itemsByKey.get(keyOf('diagram', d.id))?.rect;
      if (!r) continue;
      const p = move(r.x, r.y);
      plan.diagramShifts.push({ id: d.id, dx: p.x - Math.round(r.x), dy: p.y - Math.round(r.y) });
    }
    if (diagrams.length && applied !== 1) {
      notes.push('Sequence diagrams cannot be scaled; they were only repositioned. Run check_layout to see if they now collide.');
    }
    if (reposition || shift.dx || shift.dy) {
      const picked = new Set(tables.map((t) => t.id));
      const tableOf = new Map<string, string>();
      for (const t of schema.tables) for (const c of t.columns) tableOf.set(c.id, t.id);
      for (const r of schema.relationships) {
        const a = tableOf.get(r.sourceColumnId);
        const b = tableOf.get(r.targetColumnId);
        if (!r.waypoints?.length || !a || !b || !picked.has(a) || !picked.has(b)) continue;
        plan.waypoints.push({
          id: r.id,
          waypoints: r.waypoints.map((w) => {
            const p = move(w.x, w.y);
            return { x: p.x, y: p.y };
          }),
        });
      }
    }
  } else {
    if (elements.length || diagrams.length) {
      notes.push('`scale` sets table scale only; drawing elements and diagrams were left alone (use factor).');
    }
  }
  return plan;
}

// --- Stacking -----------------------------------------------------------------------

export type ArrangeOp = 'front' | 'back' | 'forward' | 'backward' | 'above' | 'below';

export interface StackItem {
  key: string;
  kind: 'element' | 'diagram';
  id: string;
  label: string;
  cls: 'frame' | 'line' | 'content';
  rect: Rect;
}

/** Elements and sequence diagrams in one bottom-to-top list (diagrams sit between elements). */
export function stackOrder(schema: SchemaModel): StackItem[] {
  const rectOf = new Map(collectItems(schema, { lines: 'all' }).map((i) => [i.key, i.rect]));
  const zero: Rect = { x: 0, y: 0, w: 0, h: 0 };
  const els = schema.elements
    .map((e, i) => ({ e, i }))
    .sort((p, q) => p.e.zIndex - q.e.zIndex || p.i - q.i)
    .map((p) => p.e);
  const diagrams = [...schema.sequenceDiagrams].sort((a, b) => a.zIndex - b.zIndex);
  const out: StackItem[] = [];
  let di = 0;
  const pushDiagramsBelow = (z: number): void => {
    while (di < diagrams.length && diagrams[di].zIndex < z) {
      const d = diagrams[di];
      out.push({
        key: keyOf('diagram', d.id),
        kind: 'diagram',
        id: d.id,
        label: `sequence diagram ${d.title ? `"${d.title}" ` : ''}(${d.id})`,
        cls: 'content',
        rect: rectOf.get(keyOf('diagram', d.id)) ?? zero,
      });
      di += 1;
    }
  };
  for (const e of els) {
    pushDiagramsBelow(e.zIndex);
    out.push({
      key: keyOf('element', e.id),
      kind: 'element',
      id: e.id,
      label: elementLabel(e),
      cls: e.type === 'frame' ? 'frame' : isLineElement(e) ? 'line' : 'content',
      rect: rectOf.get(keyOf('element', e.id)) ?? { x: e.x, y: e.y, w: e.width, h: e.height },
    });
  }
  pushDiagramsBelow(Infinity);
  return out;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return intersection(a, b) !== null;
}

/**
 * Re-stack `selected` keys. front/back go to the very top/bottom; forward/backward hop
 * past the nearest item of the same kind of layer that they visually overlap (so a step
 * always changes what is on top); above/below place them right next to `reference`.
 */
export function arrangeStack(
  stack: readonly StackItem[],
  selected: ReadonlySet<string>,
  op: ArrangeOp,
  options: { reference?: string; steps?: number } = {},
): StackItem[] {
  const isSel = (it: StackItem): boolean => selected.has(it.key);
  if (op === 'front') return [...stack.filter((i) => !isSel(i)), ...stack.filter(isSel)];
  if (op === 'back') return [...stack.filter(isSel), ...stack.filter((i) => !isSel(i))];
  if (op === 'above' || op === 'below') {
    const rest = stack.filter((i) => !isSel(i));
    const at = rest.findIndex((i) => i.key === options.reference);
    if (at < 0) return [...stack];
    const picked = stack.filter(isSel);
    const cut = op === 'above' ? at + 1 : at;
    return [...rest.slice(0, cut), ...picked, ...rest.slice(cut)];
  }
  const step = op === 'forward' ? 1 : -1;
  let next = [...stack];
  for (let n = 0; n < Math.max(1, options.steps ?? 1); n += 1) {
    const order = next.map((_, i) => i);
    if (step === 1) order.reverse();
    // Positions shift as items hop, so track the items themselves.
    const moving = order.map((i) => next[i]).filter(isSel);
    for (const it of moving) {
      const i = next.indexOf(it);
      let j = i + step;
      while (j >= 0 && j < next.length && !(next[j].cls === it.cls && rectsOverlap(next[j].rect, it.rect))) {
        j += step;
      }
      if (j < 0 || j >= next.length || isSel(next[j])) continue;
      next.splice(i, 1);
      next.splice(j, 0, it);
    }
  }
  return next;
}

/**
 * The writes a new stack order needs: elements take 0..n-1 in order, and each diagram
 * sits just above the element before it (fractional zIndex, -1 = under all elements).
 */
export function stackToZ(
  stack: readonly StackItem[],
  selected: ReadonlySet<string>,
  op: ArrangeOp,
): { elementOrder: string[]; diagramZ: Map<string, number> } {
  const elementOrder = stack.filter((i) => i.kind === 'element').map((i) => i.id);
  const total = elementOrder.length;
  const diagramZ = new Map<string, number>();
  let before = 0;
  let slot = 0;
  for (const it of stack) {
    if (it.kind === 'element') {
      before += 1;
      slot = 0;
      continue;
    }
    const sel = selected.has(it.key);
    if (total === 0 && !sel) continue;
    const atBottom = total > 0 ? before === 0 : op === 'back' || op === 'backward';
    const base = atBottom ? -1 : Math.max(before, 1) - 0.5;
    diagramZ.set(it.id, base + slot * 0.001);
    slot += 1;
  }
  return { elementOrder, diagramZ };
}
