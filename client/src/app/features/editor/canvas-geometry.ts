import type { RelationshipModel, TableModel } from '@dbdesigner/shared';

// Fixed node metrics so connector anchors line up with the rendered rows.
export const NODE_WIDTH = 280;
export const HEADER_H = 40;
export const ROW_H = 34;
export const SVG_OFFSET = 5000;
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 3;
export const GRID_SIZE = 24;

/** Rendered height of a node (header + rows), for hit-testing and alignment. */
export function nodeHeight(columnCount: number): number {
  return HEADER_H + Math.max(1, columnCount) * ROW_H;
}

/** Snap a coordinate to the grid. */
export function snapToGrid(value: number, size = GRID_SIZE): number {
  return Math.round(value / size) * size;
}

export type Side = 'left' | 'right';

export interface Point {
  x: number;
  y: number;
}

export interface ColumnLocation {
  table: TableModel;
  index: number;
}

/** Render data for one relationship connector plus its endpoint anchors. */
export interface Connector {
  id: string;
  d: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  mx: number;
  my: number;
  markerStart: string;
  markerEnd: string;
  selected: boolean;
  /** User-set bend points (world coords), draggable when the connector is selected. */
  waypoints: Point[];
  /** Midpoints of each segment, where a new waypoint can be inserted. */
  segmentMidpoints: Point[];
}

/** World-space anchor point on a table's column row, on the given side. */
export function columnAnchor(table: TableModel, index: number, side: Side): Point {
  return {
    x: side === 'right' ? table.x + NODE_WIDTH : table.x,
    y: table.y + HEADER_H + index * ROW_H + ROW_H / 2,
  };
}

export function buildColumnLocations(tables: readonly TableModel[]): Map<string, ColumnLocation> {
  const map = new Map<string, ColumnLocation>();
  for (const table of tables) {
    table.columns.forEach((column, index) => map.set(column.id, { table, index }));
  }
  return map;
}

function markerFor(kind: 'one' | 'many'): string {
  return kind === 'many' ? 'url(#dbd-many)' : 'url(#dbd-one)';
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y) || 1;
}

/** Drop consecutive duplicate points (keeps degenerate elbows from wiggling). */
function dedupe(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Orthogonal (manhattan) route from a to b through the given guide points.
 * Every segment is horizontal or vertical; the line exits the source and enters
 * the target horizontally (matching the side connect points).
 */
function manhattanRoute(a: Point, b: Point, guides: Point[]): Point[] {
  if (guides.length === 0) {
    const midX = (a.x + b.x) / 2;
    return [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b];
  }
  const points = [a, ...guides, b];
  const route: Point[] = [a];
  let dir: 'h' | 'v' = 'h';
  for (let i = 1; i < points.length; i += 1) {
    const prev = route[route.length - 1];
    const cur = points[i];
    const isLast = i === points.length - 1;
    if (prev.x === cur.x || prev.y === cur.y) {
      route.push(cur);
      dir = prev.x === cur.x ? 'v' : 'h';
      continue;
    }
    if (isLast) {
      // Approach the target horizontally: go vertical first, then into b.
      route.push({ x: prev.x, y: cur.y });
      route.push(cur);
    } else if (dir === 'h') {
      route.push({ x: cur.x, y: prev.y });
      route.push(cur);
      dir = 'v';
    } else {
      route.push({ x: prev.x, y: cur.y });
      route.push(cur);
      dir = 'h';
    }
  }
  return route;
}

/** Rounded orthogonal elbow between two points (used for live endpoint dragging). */
export function elbowPath(a: Point, b: Point): string {
  return roundedPath(manhattanRoute(a, b, []), 10);
}

/** Build an SVG path through the points, with rounded corners at each vertex. */
function roundedPath(rawPoints: Point[], radius: number): string {
  const points = dedupe(rawPoints);
  if (points.length < 2) {
    return '';
  }
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const p = points[i];
    const next = points[i + 1];
    const lenPrev = distance(p, prev);
    const lenNext = distance(p, next);
    const rPrev = Math.min(radius, lenPrev / 2);
    const rNext = Math.min(radius, lenNext / 2);
    const c0 = { x: p.x + ((prev.x - p.x) / lenPrev) * rPrev, y: p.y + ((prev.y - p.y) / lenPrev) * rPrev };
    const c1 = { x: p.x + ((next.x - p.x) / lenNext) * rNext, y: p.y + ((next.y - p.y) / lenNext) * rNext };
    d += ` L ${c0.x} ${c0.y} Q ${p.x} ${p.y} ${c1.x} ${c1.y}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/** Build the SVG connectors for the current schema. */
export function computeConnectors(
  tables: readonly TableModel[],
  relationships: readonly RelationshipModel[],
  selectedIds: ReadonlySet<string>,
): Connector[] {
  const locations = buildColumnLocations(tables);
  const result: Connector[] = [];
  for (const rel of relationships) {
    const source = locations.get(rel.sourceColumnId);
    const target = locations.get(rel.targetColumnId);
    if (!source || !target) {
      continue;
    }
    const sourceCenter = source.table.x + NODE_WIDTH / 2;
    const targetCenter = target.table.x + NODE_WIDTH / 2;
    const sourceSide: Side = targetCenter >= sourceCenter ? 'right' : 'left';
    const targetSide: Side = sourceCenter >= targetCenter ? 'right' : 'left';
    const a = columnAnchor(source.table, source.index, sourceSide);
    const b = columnAnchor(target.table, target.index, targetSide);
    const waypoints = rel.waypoints ?? [];

    // Fully orthogonal route (all segments horizontal or vertical), through any
    // user bend points, with lightly rounded corners.
    const midX = (a.x + b.x) / 2;
    const routePoints = manhattanRoute(a, b, waypoints);
    const d = roundedPath(routePoints, 10);

    const midSeg = Math.floor((routePoints.length - 1) / 2);
    const mx = (routePoints[midSeg].x + routePoints[midSeg + 1].x) / 2;
    const my = (routePoints[midSeg].y + routePoints[midSeg + 1].y) / 2;

    // "Add waypoint" handles. Their array index maps directly to the insert index
    // in the waypoints array (a single handle at the middle when there are none).
    let segmentMidpoints: Point[];
    if (waypoints.length === 0) {
      segmentMidpoints = [{ x: midX, y: (a.y + b.y) / 2 }];
    } else {
      const topo = [a, ...waypoints, b];
      segmentMidpoints = [];
      for (let i = 0; i < topo.length - 1; i += 1) {
        segmentMidpoints.push({
          x: (topo[i].x + topo[i + 1].x) / 2,
          y: (topo[i].y + topo[i + 1].y) / 2,
        });
      }
    }

    result.push({
      id: rel.id,
      d,
      ax: a.x,
      ay: a.y,
      bx: b.x,
      by: b.y,
      mx,
      my,
      markerStart: markerFor(rel.type === 'MANY_TO_MANY' ? 'many' : 'one'),
      markerEnd: markerFor(
        rel.type === 'ONE_TO_MANY' || rel.type === 'MANY_TO_MANY' ? 'many' : 'one',
      ),
      selected: selectedIds.has(rel.id),
      waypoints,
      segmentMidpoints,
    });
  }
  return result;
}
