import type { PointModel } from '@devdesigner/shared';
import { getStroke } from 'perfect-freehand';

/** Turn a perfect-freehand outline into a filled SVG path (quadratic segments). */
function outlineToPath(outline: number[][]): string {
  if (outline.length === 0) {
    return '';
  }
  const d = outline.reduce<(string | number)[]>(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ['M', ...outline[0], 'Q'],
  );
  d.push('Z');
  return d.join(' ');
}

/**
 * Build a filled, variable-width freehand stroke path (the same engine Excalidraw
 * uses). The returned path is meant to be FILLED with the stroke color (not
 * stroked), which gives natural brush tapering and smoothing. `size` is the base
 * stroke width; velocity thins the line for a hand-drawn feel. Points are absolute
 * world coordinates.
 */
export function freehandFillPath(points: readonly PointModel[], size: number): string {
  if (points.length === 0) {
    return '';
  }
  const outline = getStroke(
    points.map((p) => [p.x, p.y]),
    {
      size: Math.max(3, size * 4.5),
      thinning: 0.6,
      smoothing: 0.6,
      streamline: 0.5,
      last: true,
    },
  );
  return outlineToPath(outline);
}

/** Straight polyline through the given points (line / multi-point arrow body). */
export function polylinePath(points: readonly PointModel[]): string {
  if (points.length === 0) {
    return '';
  }
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}

/** Unit normal of the chord start→end (rotated 90° clockwise), or null if degenerate. */
export function chordNormal(start: PointModel, end: PointModel): PointModel | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  return len < 1e-6 ? null : { x: -dy / len, y: dx / len };
}

/**
 * A single quadratic curve from start to end that bows `curvature` px away from
 * the chord at its midpoint (the sign picks the side). Returns the SVG path and
 * the curve's actual midpoint (where the bend handle and label sit).
 */
export function curvedPath(
  start: PointModel,
  end: PointModel,
  curvature: number,
): { path: string; mid: PointModel } {
  const n = chordNormal(start, end) ?? { x: 0, y: 0 };
  const chordMid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const mid = { x: chordMid.x + n.x * curvature, y: chordMid.y + n.y * curvature };
  // A quadratic's midpoint sits halfway between the chord midpoint and its control point.
  const cx = chordMid.x + n.x * curvature * 2;
  const cy = chordMid.y + n.y * curvature * 2;
  return { path: `M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}`, mid };
}
