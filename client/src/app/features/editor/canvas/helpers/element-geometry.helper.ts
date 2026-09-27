import type { CanvasElementModel, PointModel, TableModel } from '@dbdesigner/shared';
import type { Box, Point } from '../models/geometry.model';
import { nodeHeight, tableWidth } from './node-metrics.helper';

/** Vertex-based element types whose geometry lives in `points`, not width/height. */
export function isPathElement(type: CanvasElementModel['type']): boolean {
  return type === 'line' || type === 'arrow' || type === 'freedraw';
}

/** A stroke's points in absolute world coordinates (points are stored relative to x/y). */
export function absolutePoints(element: CanvasElementModel): Point[] {
  return (element.points ?? []).map((p) => ({ x: element.x + p.x, y: element.y + p.y }));
}

/** The element's axis-aligned bounding box in world coordinates (ignoring rotation). */
export function elementBox(element: CanvasElementModel): Box {
  if (isPathElement(element.type)) {
    const pts = absolutePoints(element);
    if (pts.length === 0) {
      return { x0: element.x, y0: element.y, x1: element.x, y1: element.y };
    }
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    return { x0, y0, x1, y1 };
  }
  return {
    x0: element.x,
    y0: element.y,
    x1: element.x + element.width,
    y1: element.y + element.height,
  };
}

export function elementCenter(element: CanvasElementModel): Point {
  const b = elementBox(element);
  return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
}

export function tableBox(table: TableModel): Box {
  return {
    x0: table.x,
    y0: table.y,
    x1: table.x + tableWidth(table),
    y1: table.y + nodeHeight(table.columns.length),
  };
}

function boxContains(box: Box, p: Point, pad = 0): boolean {
  return p.x >= box.x0 - pad && p.x <= box.x1 + pad && p.y >= box.y0 - pad && p.y <= box.y1 + pad;
}

/** Distance from a point to a line segment (used to hit-test thin strokes). */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Hit-test an element at a world point. Shapes/text use their box (filled shapes
 * are grabbable anywhere inside, outlines within a tolerance of the edge); strokes
 * (line/arrow/freedraw) hit within `tolerance` of the drawn path.
 */
export function hitTestElement(
  element: CanvasElementModel,
  p: Point,
  tolerance = 6,
): boolean {
  if (isPathElement(element.type)) {
    const pts = absolutePoints(element);
    for (let i = 0; i < pts.length - 1; i += 1) {
      if (distanceToSegment(p, pts[i], pts[i + 1]) <= tolerance + element.strokeWidth) {
        return true;
      }
    }
    return pts.length === 1 ? Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= tolerance : false;
  }
  return boxContains(elementBox(element), p, tolerance);
}

/** True when the element's box lies within (intersects) the given world rect. */
export function elementIntersectsRect(
  element: CanvasElementModel,
  rect: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  const b = elementBox(element);
  return b.x0 <= rect.maxX && b.x1 >= rect.minX && b.y0 <= rect.maxY && b.y1 >= rect.minY;
}

/**
 * The point on a box's boundary along the ray from its center toward `toward`.
 * Used to anchor a bound arrow to the edge of the shape/table it connects to.
 */
export function boundaryPoint(box: Box, toward: Point): Point {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) {
    return { x: cx, y: cy };
  }
  const halfW = (box.x1 - box.x0) / 2;
  const halfH = (box.y1 - box.y0) / 2;
  // Scale the ray so it just reaches the nearest box edge.
  const scale = 1 / Math.max(Math.abs(dx) / (halfW || 1), Math.abs(dy) / (halfH || 1));
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/** Convert an absolute world point to a point relative to an element's origin. */
export function toRelative(element: CanvasElementModel, p: Point): PointModel {
  return { x: p.x - element.x, y: p.y - element.y };
}
