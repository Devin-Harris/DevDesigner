import {
   resolveThemeColor,
   resolveThemeFont,
   themeLayoutItems,
   type LayoutKind,
   type LayoutSpecItem,
   type SlideTheme,
} from '@devdesigner/shared';
import { fontStack } from '../../../../../shared/helpers/fonts/fonts.helper';

/** One mark of a layout thumbnail, in a 1280x720 viewBox. */
export type ThumbMark =
   | {
        kind: 'rect';
        x: number;
        y: number;
        w: number;
        h: number;
        fill: string;
        stroke: string;
        strokeWidth: number;
        rx: number;
        opacity: number;
        rotate: string | null;
     }
   | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill: string; stroke: string; strokeWidth: number; opacity: number }
   | {
        kind: 'text';
        x: number;
        y: number;
        text: string;
        size: number;
        fill: string;
        font: string;
        weight: number;
        italic: boolean;
        anchor: 'start' | 'middle' | 'end';
        opacity: number;
     };

export interface LayoutThumb {
   background: string;
   marks: ThumbMark[];
}

const SW = 1280;
const SH = 720;

/**
 * A static picture of a design's `kind` layout (with its master items under it) in the
 * design's theme, for menus: no canvas elements are made.
 */
export function layoutThumb(set: SlideTheme, theme: SlideTheme, kind: LayoutKind = 'title'): LayoutThumb {
   const color = (c: string | undefined): string => {
      if (!c || c === 'transparent') return 'none';
      return resolveThemeColor(c, theme) ?? 'none';
   };
   const marks: ThumbMark[] = [];
   const add = (item: LayoutSpecItem): void => {
      const x = item.x * SW;
      const y = item.y * SH;
      const w = item.w * SW;
      if (item.kind === 'bar') {
         marks.push({ kind: 'rect', x, y, w, h: Math.max(2, item.h), fill: color(item.color), stroke: 'none', strokeWidth: 0, rx: 0, opacity: 1, rotate: null });
         return;
      }
      if (item.kind === 'text') {
         const anchor = item.align === 'center' ? 'middle' : item.align === 'right' ? 'end' : 'start';
         marks.push({
            kind: 'text',
            x: anchor === 'middle' ? x + w / 2 : anchor === 'end' ? x + w : x,
            y: y + item.size,
            text: item.role === 'title' ? 'Title' : item.prompt.replace(/^Click to add /, ''),
            size: item.size,
            fill: color(item.color),
            font: fontStack(resolveThemeFont(item.font === 'heading' ? '$heading' : '$body', theme)),
            weight: item.bold ? 700 : 400,
            italic: !!item.italic,
            anchor,
            opacity: 1,
         });
         return;
      }
      const el = item.el;
      const h = item.h * SH;
      const opacity = (el.opacity ?? 100) / 100;
      const filled = el.fillStyle && el.fillStyle !== 'none';
      const fill = filled ? color(el.backgroundColor) : 'none';
      const stroke = (el.strokeWidth ?? 0) > 0 ? color(el.strokeColor) : 'none';
      const strokeWidth = el.strokeWidth ?? 0;
      if (el.type === 'ellipse') {
         marks.push({ kind: 'ellipse', cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, fill, stroke, strokeWidth, opacity });
      } else if (el.type === 'rectangle') {
         const rot = el.angle ? `rotate(${(el.angle * 180) / Math.PI} ${x + w / 2} ${y + h / 2})` : null;
         marks.push({ kind: 'rect', x, y, w, h, fill, stroke, strokeWidth, rx: el.cornerRadius ?? 0, opacity, rotate: rot });
      } else if (el.type === 'text' && el.text) {
         const size = el.fontSize ?? 24;
         const anchor = el.textAlign === 'center' ? 'middle' : el.textAlign === 'right' ? 'end' : 'start';
         marks.push({
            kind: 'text',
            x: anchor === 'middle' ? x + w / 2 : anchor === 'end' ? x + w : x,
            y: y + size,
            text: el.text,
            size,
            fill: color(el.strokeColor),
            font: fontStack(resolveThemeFont(el.fontFamily, theme)),
            weight: el.bold ? 700 : 400,
            italic: !!el.italic,
            anchor,
            opacity,
         });
      }
   };
   for (const item of set.master ?? []) add(item);
   for (const item of themeLayoutItems(set, kind) ?? []) add(item);
   return { background: color('$background'), marks };
}
