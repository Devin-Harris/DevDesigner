import type { CanvasElementModel, ElementBinding } from '@devdesigner/shared';
import type { Box, Point } from '../../models/geometry.model';
import type { ImageView, ShapeView, TextBlockView } from '../../models/shape-view.model';
import { isFullCrop, mediaSourceRect } from '../media.helper';
import {
   absolutePoints,
   anchorPoint,
   focusPoint,
   type BindingFocus,
   type RotatedBox,
} from '../element-geometry.helper';
import { ANCHOR_GAP } from '../../shared/constants/canvas.constants';
import { fontWeightFor } from './fonts';
import { contrastSafe, sentinelColor, type ThemeColors } from './theme-colors';
import { LINE_HEIGHT, layoutTextBlock } from './text-layout';
import { usableRuns } from '../rich-text.helper';

/**
 * Rectangle corner radius, clamped to half the shorter side (a big radius gives a pill).
 */
export function rectCornerRadius(element: CanvasElementModel): number {
   if (element.cornerRadii?.length === 4 && !hasMixedCorners(element)) {
      const r = element.cornerRadii[0];
      return Math.min(r, Math.abs(element.width) / 2, Math.abs(element.height) / 2);
   }
   const r = element.cornerRadius ?? Math.min(12, Math.min(element.width, element.height) * 0.15);
   return Math.min(r, Math.abs(element.width) / 2, Math.abs(element.height) / 2);
}

/**
 * Each corner's radius [top-left, top-right, bottom-right, bottom-left], each clamped
 * to half the shorter side. Uniform unless the element has per-corner `cornerRadii`.
 */
export function rectCornerRadii(element: CanvasElementModel): [number, number, number, number] {
   const max = Math.min(Math.abs(element.width), Math.abs(element.height)) / 2;
   const c = element.cornerRadii;
   if (c?.length === 4) return c.map((r) => Math.max(0, Math.min(max, r))) as [number, number, number, number];
   const r = Math.min(max, rectCornerRadius(element));
   return [r, r, r, r];
}

/** Whether the element rounds its corners unevenly (drawn as a path, not a <rect rx>). */
export function hasMixedCorners(element: CanvasElementModel): boolean {
   const c = element.cornerRadii;
   return c?.length === 4 && !c.every((r) => r === c[0]);
}

/** Path of a box with its own radius per corner [tl, tr, br, bl]. */
export function roundedRectPath(x: number, y: number, w: number, h: number, r: readonly number[]): string {
   const [tl, tr, br, bl] = r;
   return (
      `M${x + tl},${y}H${x + w - tr}` +
      (tr ? `A${tr},${tr} 0 0 1 ${x + w},${y + tr}` : '') +
      `V${y + h - br}` +
      (br ? `A${br},${br} 0 0 1 ${x + w - br},${y + h}` : '') +
      `H${x + bl}` +
      (bl ? `A${bl},${bl} 0 0 1 ${x},${y + h - bl}` : '') +
      `V${y + tl}` +
      (tl ? `A${tl},${tl} 0 0 1 ${x + tl},${y}` : '') +
      'Z'
   );
}

/** Shapes whose corners can be rounded with the live-corner grips. */
export function hasLiveCorners(element: CanvasElementModel): boolean {
   return element.type === 'rectangle' || element.type === 'diamond' || element.type === 'triangle';
}

/** A rectangle/diamond/triangle's corner points (unrotated, clockwise on screen). */
export function shapeVertices(element: CanvasElementModel): Array<{ x: number; y: number }> {
   const { x, y, width: w, height: h } = element;
   if (element.type === 'diamond') {
      return [
         { x: x + w / 2, y },
         { x: x + w, y: y + h / 2 },
         { x: x + w / 2, y: y + h },
         { x, y: y + h / 2 },
      ];
   }
   if (element.type === 'triangle') {
      return [
         { x: x + w / 2, y },
         { x: x + w, y: y + h },
         { x, y: y + h },
      ];
   }
   const x0 = Math.min(x, x + w);
   const y0 = Math.min(y, y + h);
   const aw = Math.abs(w);
   const ah = Math.abs(h);
   return [
      { x: x0, y: y0 },
      { x: x0 + aw, y: y0 },
      { x: x0 + aw, y: y0 + ah },
      { x: x0, y: y0 + ah },
   ];
}

/** Each corner's requested radius (rectangles: as drawn; diamonds/triangles default sharp). */
export function shapeCornerRadii(element: CanvasElementModel): number[] {
   if (element.type === 'rectangle') return rectCornerRadii(element);
   const n = element.type === 'triangle' ? 3 : 4;
   const c = element.cornerRadii;
   if (c?.length === n) return c.map((r) => Math.max(0, r));
   return new Array<number>(n).fill(Math.max(0, element.cornerRadius ?? 0));
}

/** Geometry of corner `i`: unit bisector pointing inward, half the interior angle, and the largest radius that fits. */
export function cornerGeometry(
   pts: ReadonlyArray<{ x: number; y: number }>,
   i: number
): { bx: number; by: number; half: number; max: number } {
   const n = pts.length;
   const p = pts[i];
   const a = pts[(i + n - 1) % n];
   const b = pts[(i + 1) % n];
   const la = Math.hypot(a.x - p.x, a.y - p.y) || 1;
   const lb = Math.hypot(b.x - p.x, b.y - p.y) || 1;
   const ua = { x: (a.x - p.x) / la, y: (a.y - p.y) / la };
   const ub = { x: (b.x - p.x) / lb, y: (b.y - p.y) / lb };
   const half = Math.acos(Math.max(-1, Math.min(1, ua.x * ub.x + ua.y * ub.y))) / 2;
   const bl = Math.hypot(ua.x + ub.x, ua.y + ub.y) || 1;
   // Tangent points may use at most half of each adjacent edge.
   const max = Math.min(la, lb) / 2 * Math.tan(half);
   return { bx: (ua.x + ub.x) / bl, by: (ua.y + ub.y) / bl, half, max };
}

/** Path of a polygon with each corner rounded by its own radius (clamped to fit). */
export function roundedPolygonPath(pts: ReadonlyArray<{ x: number; y: number }>, radii: readonly number[]): string {
   const n = pts.length;
   let d = '';
   for (let i = 0; i < n; i++) {
      const p = pts[i];
      const g = cornerGeometry(pts, i);
      const r = Math.min(radii[i] ?? 0, g.max);
      const a = pts[(i + n - 1) % n];
      const b = pts[(i + 1) % n];
      const t = r > 0 ? r / Math.tan(g.half) : 0;
      const la = Math.hypot(a.x - p.x, a.y - p.y) || 1;
      const lb = Math.hypot(b.x - p.x, b.y - p.y) || 1;
      const inX = p.x + ((a.x - p.x) / la) * t;
      const inY = p.y + ((a.y - p.y) / la) * t;
      d += `${i ? 'L' : 'M'}${inX},${inY}`;
      if (t > 0) {
         const outX = p.x + ((b.x - p.x) / lb) * t;
         const outY = p.y + ((b.y - p.y) / lb) * t;
         d += `A${r},${r} 0 0 1 ${outX},${outY}`;
      }
   }
   return d + 'Z';
}

/** An image element's picture: its crop resolved to where the source lands, and its clip. */
export function imageView(element: CanvasElementModel, fileId: string): ImageView {
   const box = { x: element.x, y: element.y, width: element.width, height: element.height };
   const media = element.media;
   const crop = isFullCrop(media?.crop) ? undefined : media?.crop;
   const view: ImageView = {
      ...box,
      fileId,
      src: mediaSourceRect(box, crop),
      playback: media?.playback,
      loop: media?.loop ?? false,
      muted: media?.muted ?? false,
      start: media?.start,
      end: media?.end,
      alt: media?.alt,
   };
   const id = `img-clip-${element.id}`;
   const w = Math.abs(box.width);
   const h = Math.abs(box.height);
   if (media?.clip === 'ellipse') {
      view.clip = {
         id,
         ellipse: { cx: box.x + box.width / 2, cy: box.y + box.height / 2, rx: w / 2, ry: h / 2 },
         css: 'ellipse(50% 50% at 50% 50%)',
      };
   } else if (media?.clip === 'diamond') {
      const mx = box.x + box.width / 2;
      const my = box.y + box.height / 2;
      view.clip = {
         id,
         polygon: `${mx},${box.y} ${box.x + box.width},${my} ${mx},${box.y + box.height} ${box.x},${my}`,
         css: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
      };
   } else if (media?.clip === 'rectangle' || crop) {
      const rx = media?.clip === 'rectangle' ? Math.min(media.clipRadius ?? 0, w / 2, h / 2) : 0;
      view.clip = { id, rect: { ...box, rx }, css: `inset(0 round ${rx}px)` };
   }
   return view;
}

export function dashArray(element: CanvasElementModel): string | null {
   const w = Math.max(1, element.strokeWidth);
   switch (element.strokeStyle) {
      case 'dashed':
         return `${w * 3} ${w * 2}`;
      case 'dotted':
         return `${w} ${w * 2}`;
      default:
         return null;
   }
}

export function fillOf(
   element: CanvasElementModel,
   theme: ThemeColors | undefined
): {
   fill: string;
   fillOpacity: number;
   hatch?: { id: string; color: string };
} {
   if (element.fillStyle === 'none' || !element.backgroundColor) {
      return { fill: 'none', fillOpacity: 1 };
   }
   const color = sentinelColor(element.backgroundColor, theme);
   // Hachure = real diagonal-line hatching via a per-element SVG <pattern>.
   if (element.fillStyle === 'hachure') {
      const id = `hatch-${element.id}`;
      return { fill: `url(#${id})`, fillOpacity: 1, hatch: { id, color } };
   }
   return { fill: color, fillOpacity: 1 };
}

export function rotation(element: CanvasElementModel, center: Point): string | null {
   if (!element.angle) {
      return null;
   }
   const deg = (element.angle * 180) / Math.PI;
   return `rotate(${deg} ${center.x} ${center.y})`;
}

/**
 * Resolve a line/arrow's two ends to absolute world points, snapping a bound end
 * to the boundary of its target (table or element) so it re-routes as the target
 * moves. Falls back to the stored point when the binding target is gone.
 */
/**
 * A line/arrow's points as drawn: both ends bound = a straight connector between the
 * two boundaries; otherwise each bound end snapped to its target. World coordinates.
 */
export function lineEnds(
   element: CanvasElementModel,
   targetBox: (binding: ElementBinding) => RotatedBox | null
): Point[] {
   const sBox = element.startBinding ? targetBox(element.startBinding) : null;
   const tBox = element.endBinding ? targetBox(element.endBinding) : null;
   if (sBox && tBox) {
      return routeBoundConnector(sBox, tBox, element.startBinding?.focus, element.endBinding?.focus);
   }
   return resolveEnds(element, targetBox);
}

export function resolveEnds(
   element: CanvasElementModel,
   targetBox: (binding: ElementBinding) => RotatedBox | null
): Point[] {
   const pts = absolutePoints(element);
   if (pts.length < 2) {
      return pts;
   }
   const start = pts[0];
   const end = pts[pts.length - 1];
   const startBox = element.startBinding ? targetBox(element.startBinding) : null;
   const endBox = element.endBinding ? targetBox(element.endBinding) : null;
   const resolved = pts.map((p) => ({ ...p }));
   if (startBox) {
      resolved[0] = anchorPoint(startBox, element.startBinding?.focus, pts[1] ?? end, ANCHOR_GAP);
   }
   if (endBox) {
      resolved[resolved.length - 1] = anchorPoint(
         endBox,
         element.endBinding?.focus,
         pts[pts.length - 2] ?? start,
         ANCHOR_GAP
      );
   }
   return resolved;
}

export function boxToBbox(box: Box): ShapeView['bbox'] {
   return { x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 };
}

/** A shape's optional centered text label (rectangle/ellipse/diamond). */
export function shapeLabel(
   element: CanvasElementModel,
   box: ShapeView['bbox'],
   theme: ThemeColors | undefined
): TextBlockView | undefined {
   if (!element.text) {
      return undefined;
   }
   return layoutTextBlock(element.text, shapeTextBox(element, box), shapeLabelOptions(element, theme));
}

/** Padding inside a shape's text box (the editor uses the same, so it lines up). */
export const SHAPE_TEXT_PADDING = 4;

/**
 * The box a shape's label wraps in: the shape's bounds pulled in from the edges, by
 * more for an ellipse or diamond so the text stays inside the curved/slanted sides.
 */
export function shapeTextBox(
   element: Pick<CanvasElementModel, 'type' | 'x' | 'y' | 'width' | 'height'>,
   box: { x: number; y: number; width: number; height: number } = element
): { x: number; y: number; width: number; height: number } {
   if (element.type === 'triangle') {
      // The widest part of an up-pointing triangle is its lower half.
      const ix = Math.max(0, Math.min(box.width * 0.25 + 6, box.width / 2 - 4));
      const top = box.y + box.height * 0.4;
      return {
         x: box.x + ix,
         y: top,
         width: Math.max(8, box.width - 2 * ix),
         height: Math.max(8, box.y + box.height - 4 - top),
      };
   }
   const k = element.type === 'ellipse' ? 0.146 : element.type === 'diamond' ? 0.25 : 0;
   const ix = Math.min(box.width * k + 6, box.width / 2 - 4);
   const iy = Math.min(box.height * k + 4, box.height / 2 - 4);
   return {
      x: box.x + Math.max(0, ix),
      y: box.y + Math.max(0, iy),
      width: Math.max(8, box.width - 2 * Math.max(0, ix)),
      height: Math.max(8, box.height - 2 * Math.max(0, iy)),
   };
}

/** Text layout options for a shape label (shared by the renderer and the inline editor). */
export function shapeLabelOptions(element: CanvasElementModel, theme: ThemeColors | undefined) {
   return {
      fontSize: element.fontSize ?? 16,
      fontFamilyKey: element.fontFamily,
      fontWeight: element.bold ? 800 : fontWeightFor(element.strokeWidth),
      italic: element.italic,
      color: contrastSafe(element.strokeColor, theme),
      align: element.textAlign ?? ('center' as const),
      vAlign: element.verticalAlign ?? ('middle' as const),
      padding: SHAPE_TEXT_PADDING,
      wrap: true,
      lineHeight: element.lineHeight,
      runs: usableRuns(element.text ?? '', element.runs),
      resolveColor: (c: string) => contrastSafe(c, theme),
   };
}

/** A line/arrow's optional label, centered just above the segment's midpoint. */
export function arrowLabel(
   element: CanvasElementModel,
   start: Point,
   end: Point,
   theme: ThemeColors | undefined
): TextBlockView | undefined {
   if (!element.text) {
      return undefined;
   }
   const fontSize = element.fontSize ?? 14;
   const lineH = fontSize * LINE_HEIGHT;
   const midX = (start.x + end.x) / 2;
   const midY = (start.y + end.y) / 2;
   // Ride above the line so the glyphs clear the stroke.
   const box = { x: midX - 120, y: midY - fontSize - lineH / 2, width: 240, height: lineH };
   return layoutTextBlock(element.text, box, {
      fontSize,
      fontFamilyKey: element.fontFamily,
      fontWeight: element.bold ? 800 : fontWeightFor(element.strokeWidth),
      italic: element.italic,
      color: contrastSafe(element.strokeColor, theme),
      align: 'center',
      vAlign: 'middle',
      padding: 0,
      wrap: false,
   });
}

/**
 * Connect two bound boxes with a STRAIGHT line: each end anchors to the exact
 * point on its box boundary along the center-to-center ray (not snapped to a few
 * fixed side midpoints), pushed `ANCHOR_GAP` outward so the line and its marker
 * stay clear of the shape. A direct segment — no orthogonal/elbow routing.
 */
export function routeBoundConnector(
   sBox: RotatedBox,
   tBox: RotatedBox,
   sFocus?: BindingFocus,
   tFocus?: BindingFocus
): Point[] {
   // An end the user placed aims at its focus; the other end aims at that spot too.
   const sAim: Point = sFocus ? focusPoint(sBox, sFocus) : { x: (sBox.x0 + sBox.x1) / 2, y: (sBox.y0 + sBox.y1) / 2 };
   const tAim: Point = tFocus ? focusPoint(tBox, tFocus) : { x: (tBox.x0 + tBox.x1) / 2, y: (tBox.y0 + tBox.y1) / 2 };
   return [anchorPoint(sBox, sFocus, tAim, ANCHOR_GAP), anchorPoint(tBox, tFocus, sAim, ANCHOR_GAP)];
}

/**
 * Part of a clip path's id that changes with the box it clips to. Chrome does not always
 * repaint the area a clipped group used to cover when only the clip rect moves, leaving
 * a faded copy behind mid-drag; a fresh clipPath per box forces a clean repaint.
 */
export function clipKey(el: { x: number; y: number; width: number; height: number }): string {
   const r = (n: number) => Math.round(n * 10);
   return `${r(el.x)}_${r(el.y)}_${r(el.width)}_${r(el.height)}`.replace(/-/g, 'm');
}

/** Split a point run at non-finite (gap) points. */
export function splitAtGaps<T extends { x: number; y: number }>(points: readonly T[]): T[][] {
   const runs: T[][] = [];
   let cur: T[] = [];
   for (const p of points) {
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) cur.push(p);
      else if (cur.length) {
         runs.push(cur);
         cur = [];
      }
   }
   if (cur.length) runs.push(cur);
   return runs;
}
