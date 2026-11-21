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
 * Rectangle corner radius. By default it clamps to half the shorter side, so a big
 * radius gives a pill; with `ellipticCorners` the raw radius is left to SVG, which
 * clamps each axis separately and stretches the corners into an oval.
 */
export function rectCornerRadius(element: CanvasElementModel): number {
   const r = element.cornerRadius ?? Math.min(12, Math.min(element.width, element.height) * 0.15);
   return element.ellipticCorners ? r : Math.min(r, Math.abs(element.width) / 2, Math.abs(element.height) / 2);
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
