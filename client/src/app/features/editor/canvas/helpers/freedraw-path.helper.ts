import type { PointModel } from '@dbdesigner/shared';
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
