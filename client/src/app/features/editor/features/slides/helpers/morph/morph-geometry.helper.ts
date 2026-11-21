import { type CanvasElementModel, type ElementBinding, type PointModel, isSwatchColor } from '@devdesigner/shared';
import type { RotatedBox } from '../../../../helpers/element-geometry.helper';
import type { Offset } from './morph.model';

/** Interpolation of numbers, angles, colors, bindings and whole elements between two slides. */

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Interpolate angles the short way round. */
export function lerpAngle(a: number, b: number, t: number): number {
   const delta = ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
   return a + delta * t;
}

/** Fade in over the first half so a still-opaque twin never dips in brightness. */
export const fadeIn = (t: number): number => Math.min(1, t * 2);

/** Slide travel per direction (unit vectors; the outgoing slide moves this way). */
export const TRAVEL: Record<string, [number, number]> = {
   left: [-1, 0],
   right: [1, 0],
   up: [0, -1],
   down: [0, 1],
};

/** Fade out over the second half (the incoming twin is already opaque by then). */
export const fadeOut = (t: number): number => 1 - Math.max(0, t * 2 - 1);

export function parseColor(c: string): [number, number, number] | null {
   const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
   if (hex) {
      const h = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join('') : hex[1];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
   }
   const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(c.trim());
   return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

export function mixColor(a: string, b: string, t: number): string {
   const ca = parseColor(a);
   const cb = parseColor(b);
   if (!ca || !cb) {
      return t < 0.5 ? a : b;
   }
   // Hex, not rgb(): the contrast helpers (contrastText, readableTextOn, isSwatchColor)
   // only parse hex, and an unparsed blend made text fall back to the theme color mid-morph.
   const hex = ca.map((v, i) =>
      Math.max(0, Math.min(255, Math.round(lerp(v, cb[i], t))))
         .toString(16)
         .padStart(2, '0')
   );
   return `#${hex.join('')}`;
}

export function mixOptionalColor(a: string | undefined, b: string | undefined, t: number): string | undefined {
   if (a && b) {
      return mixColor(a, b, t);
   }
   return t < 0.5 ? a : b;
}

/** A header color that takes the theme text: unset or a stock swatch. */
export const isStockHeader = (c: string | undefined): boolean => !c || isSwatchColor(c);

/**
 * A bound end at progress `t`. Both sides' bindings point at the destination's target
 * (the paired target), and an anchor the user placed (`focus`) slides from where it was
 * to where it goes; an automatic anchor stands in as the box center when only one side
 * has one, so the end glides instead of jumping.
 */
export function blendBinding(
   a: ElementBinding | undefined,
   b: ElementBinding | undefined,
   t: number
): ElementBinding | undefined {
   if (!b) return t < 0.5 ? a : undefined;
   if (!a || (!a.focus && !b.focus)) return b;
   const fa = a.focus ?? { x: 0.5, y: 0.5 };
   const fb = b.focus ?? { x: 0.5, y: 0.5 };
   return { ...b, focus: { x: lerp(fa.x, fb.x, t), y: lerp(fa.y, fb.y, t) } };
}

/** A bound end walking around its (morphing) target's outline, by angle in the target's frame. */
export interface Walk {
   binding: ElementBinding;
   from: number;
   to: number;
}

/**
 * The direction of a point from a box's center in the box's own normalized frame
 * (unrotated, half-sizes scaled to 1): the same angle names the same spot on its outline
 * whatever the box's size, position or rotation.
 */
export function outlineAngle(box: RotatedBox, p: PointModel): number {
   const cx = (box.x0 + box.x1) / 2;
   const cy = (box.y0 + box.y1) / 2;
   let dx = p.x - cx;
   let dy = p.y - cy;
   const a = box.angle ?? 0;
   if (a) {
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      [dx, dy] = [dx * cos + dy * sin, -dx * sin + dy * cos];
   }
   return Math.atan2(dy / ((box.y1 - box.y0) / 2 || 1), dx / ((box.x1 - box.x0) / 2 || 1));
}

/** The binding for a walking end at progress `t`: a focus at the in-between outline angle. */
export function walkBinding(w: Walk | null, t: number): ElementBinding | undefined {
   if (!w) return undefined;
   let d = w.to - w.from;
   // The short way round.
   if (d > Math.PI) d -= 2 * Math.PI;
   if (d < -Math.PI) d += 2 * Math.PI;
   const th = w.from + d * t;
   return { ...w.binding, focus: { x: 0.5 + 0.25 * Math.cos(th), y: 0.5 + 0.25 * Math.sin(th) } };
}

/** A shape's visible fill color, or null when it draws no fill. */
export function fillOf(e: CanvasElementModel): string | null {
   const c = e.backgroundColor;
   return e.fillStyle !== 'none' && c && c !== 'transparent' && parseColor(c) ? c : null;
}

/**
 * Fill at progress `t`: two fills mix; a fill against no fill fades in or out through
 * transparency (instead of snapping empty at the halfway point), keeping the filled
 * side's fill style the whole way.
 */
export function blendFill(
   a: CanvasElementModel,
   b: CanvasElementModel,
   t: number
): Pick<CanvasElementModel, 'backgroundColor' | 'fillStyle'> {
   const fa = fillOf(a);
   const fb = fillOf(b);
   if (fa && fb) return { backgroundColor: mixColor(fa, fb, t), fillStyle: t < 0.5 ? a.fillStyle : b.fillStyle };
   if (!fa && !fb)
      return {
         backgroundColor: mixOptionalColor(a.backgroundColor, b.backgroundColor, t),
         fillStyle: (t < 0.5 ? a : b).fillStyle,
      };
   const c = parseColor((fa ?? fb)!)!;
   const alpha = Math.round(255 * (fa ? 1 - t : t));
   const hex = [...c, alpha].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
   return { backgroundColor: `#${hex}`, fillStyle: (fa ? a : b).fillStyle };
}

/** The element at progress `t` between its two slide versions (slide-local coordinates). */
export function blendElement(
   a: CanvasElementModel,
   b: CanvasElementModel,
   t: number,
   offA: Offset,
   offB: Offset
): CanvasElementModel {
   const pick = t < 0.5 ? a : b;
   const num = (x: number | undefined, y: number | undefined): number | undefined =>
      x !== undefined && y !== undefined ? lerp(x, y, t) : (y ?? x);
   let points: PointModel[] | undefined = pick.points;
   if (a.points && b.points && a.points.length === b.points.length) {
      points = a.points.map((p, i) => ({
         x: lerp(p.x, b.points![i].x, t),
         y: lerp(p.y, b.points![i].y, t),
      }));
   }
   return {
      ...pick,
      id: b.id,
      startBinding: blendBinding(a.startBinding, b.startBinding, t),
      endBinding: blendBinding(a.endBinding, b.endBinding, t),
      x: lerp(a.x - offA.x, b.x - offB.x, t),
      y: lerp(a.y - offA.y, b.y - offB.y, t),
      width: lerp(a.width, b.width, t),
      height: lerp(a.height, b.height, t),
      angle: lerpAngle(a.angle ?? 0, b.angle ?? 0, t),
      strokeColor: mixColor(a.strokeColor, b.strokeColor, t),
      ...blendFill(a, b, t),
      strokeWidth: lerp(a.strokeWidth, b.strokeWidth, t),
      opacity: lerp(a.opacity, b.opacity, t),
      cornerRadius: num(a.cornerRadius, b.cornerRadius),
      fontSize: num(a.fontSize, b.fontSize),
      curvature: num(a.curvature, b.curvature),
      points,
   };
}
