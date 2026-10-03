import type {
  CanvasElementModel,
  ElementBinding,
  TableModel,
  TextAlign,
  VerticalAlign,
} from '@dbdesigner/shared';
import type { Box, Point } from '../models/geometry.model';
import type { ShapeView, TextBlockView, TextLineView } from '../models/shape-view.model';
import {
  absolutePoints,
  boundaryPoint,
  elementBox,
  elementCenter,
  tableBox,
} from './element-geometry.helper';
import { freehandFillPath, polylinePath } from './freedraw-path.helper';
import { ANCHOR_GAP } from '../constants/canvas.constants';

/** Map a stored font-family key to a concrete CSS font stack (see index.html). */
export const FONT_STACKS: Record<string, string> = {
  hand: "'Kalam', 'Comic Sans MS', cursive",
  normal: "'Nunito', 'Segoe UI', system-ui, sans-serif",
  code: "'JetBrains Mono', ui-monospace, 'Cascadia Mono', monospace",
};

export function fontStack(key: string | undefined): string {
  return FONT_STACKS[key ?? 'normal'] ?? FONT_STACKS['normal'];
}

/** Live theme colors used by the contrast guard (resolved CSS values). */
export interface ThemeColors {
  /** The canvas background a shape sits on (`--dbd-canvas-bg`). */
  canvasBg: string;
  /** The theme's foreground/text color to fall back to (`--dbd-text`). */
  text: string;
}

function parseColor(color: string): [number, number, number] | null {
  const s = color.trim();
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3) {
      h = h
        .split('')
        .map((x) => x + x)
        .join('');
    }
    if (h.length < 6) {
      return null;
    }
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  const m = s.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const parts = m[1].split(/[,/\s]+/).map((p) => parseFloat(p));
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => !Number.isNaN(n))) {
      return [parts[0], parts[1], parts[2]];
    }
  }
  return null;
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG-style contrast ratio between two parsed colors (1 = identical). */
const CONTRAST_FLOOR = 1.5;

/**
 * Keep a drawn color visible against the current canvas background: if the color
 * sits too close to the background (would nearly disappear), fall back to the
 * theme's text color. A pure render transform — the stored color is unchanged,
 * so toggling the theme re-evaluates automatically. Applies to explicitly chosen
 * colors too (per the design decision).
 */
export function contrastSafe(color: string, theme: ThemeColors | undefined): string {
  if (!theme) {
    return color;
  }
  const c = parseColor(color);
  const bg = parseColor(theme.canvasBg);
  if (!c || !bg) {
    return color;
  }
  const lc = relativeLuminance(c);
  const lb = relativeLuminance(bg);
  const ratio = (Math.max(lc, lb) + 0.05) / (Math.min(lc, lb) + 0.05);
  return ratio < CONTRAST_FLOOR ? theme.text : color;
}

/** Text stroke-width maps to font weight (so the width control affects text). */
export function fontWeightFor(strokeWidth: number): number {
  return strokeWidth <= 1 ? 400 : strokeWidth <= 2 ? 600 : 800;
}

const DEFAULT_FONT_SIZE = 20;
const LINE_HEIGHT = 1.25;

const measureCtx: CanvasRenderingContext2D | null =
  typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;

function measureWidth(text: string, cssFont: string): number {
  if (!measureCtx || text === '') {
    return text.length * 8;
  }
  measureCtx.font = cssFont;
  return measureCtx.measureText(text).width;
}

/** Greedily wrap a paragraph to a maximum width (word wrap, hard-breaks long words). */
function wrapParagraph(para: string, maxWidth: number, cssFont: string): string[] {
  if (para === '') {
    return [''];
  }
  const words = para.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measureWidth(candidate, cssFont) <= maxWidth || current === '') {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

/**
 * Lay out a text block inside a box with wrapping and horizontal/vertical
 * alignment. `wrap` false keeps explicit lines only (auto-size text); true wraps
 * to the box width (a resized text box or a shape label).
 */
function layoutTextBlock(
  text: string,
  box: { x: number; y: number; width: number; height: number },
  opts: {
    fontSize: number;
    fontFamilyKey: string | undefined;
    fontWeight: number;
    italic?: boolean;
    color: string;
    align: TextAlign;
    vAlign: VerticalAlign;
    padding: number;
    wrap: boolean;
  },
): TextBlockView {
  const stack = fontStack(opts.fontFamilyKey);
  const style = opts.italic ? 'italic ' : '';
  const cssFont = `${style}${opts.fontWeight} ${opts.fontSize}px ${stack}`;
  const maxWidth = Math.max(8, box.width - opts.padding * 2);
  const paragraphs = text.split('\n');
  const lines: string[] = [];
  for (const para of paragraphs) {
    if (opts.wrap) {
      lines.push(...wrapParagraph(para, maxWidth, cssFont));
    } else {
      lines.push(para);
    }
  }
  const lineHeight = opts.fontSize * LINE_HEIGHT;
  const blockHeight = lines.length * lineHeight;
  let top: number;
  switch (opts.vAlign) {
    case 'middle':
      top = box.y + (box.height - blockHeight) / 2;
      break;
    case 'bottom':
      top = box.y + box.height - blockHeight - opts.padding;
      break;
    default:
      top = box.y + opts.padding;
  }
  const anchor: TextBlockView['anchor'] =
    opts.align === 'center' ? 'middle' : opts.align === 'right' ? 'end' : 'start';
  const x =
    anchor === 'middle'
      ? box.x + box.width / 2
      : anchor === 'end'
        ? box.x + box.width - opts.padding
        : box.x + opts.padding;
  const lineViews: TextLineView[] = lines.map((t, i) => ({
    text: t,
    x,
    y: top + i * lineHeight + opts.fontSize * 0.8,
  }));
  return {
    lines: lineViews,
    fontSize: opts.fontSize,
    fontFamily: stack,
    fontWeight: opts.fontWeight,
    fontStyle: opts.italic ? 'italic' : 'normal',
    color: opts.color,
    anchor,
  };
}

function dashArray(element: CanvasElementModel): string | null {
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

function fillOf(element: CanvasElementModel): {
  fill: string;
  fillOpacity: number;
  hatch?: { id: string; color: string };
} {
  if (element.fillStyle === 'none' || !element.backgroundColor) {
    return { fill: 'none', fillOpacity: 1 };
  }
  // Hachure = real diagonal-line hatching via a per-element SVG <pattern>.
  if (element.fillStyle === 'hachure') {
    const id = `hatch-${element.id}`;
    return { fill: `url(#${id})`, fillOpacity: 1, hatch: { id, color: element.backgroundColor } };
  }
  return { fill: element.backgroundColor, fillOpacity: 1 };
}

function rotation(element: CanvasElementModel, center: Point): string | null {
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
function resolveEnds(
  element: CanvasElementModel,
  targetBox: (binding: ElementBinding) => Box | null,
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
    resolved[0] = boundaryPoint(startBox, pts[1] ?? end, ANCHOR_GAP);
  }
  if (endBox) {
    resolved[resolved.length - 1] = boundaryPoint(endBox, pts[pts.length - 2] ?? start, ANCHOR_GAP);
  }
  return resolved;
}

function boxToBbox(box: Box): ShapeView['bbox'] {
  return { x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 };
}

/** A shape's optional centered text label (rectangle/ellipse/diamond). */
function shapeLabel(
  element: CanvasElementModel,
  box: ShapeView['bbox'],
  theme: ThemeColors | undefined,
): TextBlockView | undefined {
  if (!element.text) {
    return undefined;
  }
  return layoutTextBlock(element.text, box, {
    fontSize: element.fontSize ?? 16,
    fontFamilyKey: element.fontFamily,
    fontWeight: element.bold ? 800 : fontWeightFor(element.strokeWidth),
    italic: element.italic,
    color: contrastSafe(element.strokeColor, theme),
    align: element.textAlign ?? 'center',
    vAlign: element.verticalAlign ?? 'middle',
    padding: 8,
    wrap: true,
  });
}

/**
 * Connect two bound boxes with a STRAIGHT line: each end anchors to the exact
 * point on its box boundary along the center-to-center ray (not snapped to a few
 * fixed side midpoints), pushed `ANCHOR_GAP` outward so the line and its marker
 * stay clear of the shape. A direct segment — no orthogonal/elbow routing.
 */
function routeBoundConnector(sBox: Box, tBox: Box): Point[] {
  const sc: Point = { x: (sBox.x0 + sBox.x1) / 2, y: (sBox.y0 + sBox.y1) / 2 };
  const tc: Point = { x: (tBox.x0 + tBox.x1) / 2, y: (tBox.y0 + tBox.y1) / 2 };
  return [boundaryPoint(sBox, tc, ANCHOR_GAP), boundaryPoint(tBox, sc, ANCHOR_GAP)];
}

/**
 * Build render views for every element, resolving styling, rotation, bound arrow
 * endpoints, text layout, and shape labels. Bound connectors route around other
 * shapes/tables. `tables`/`elements` supply binding targets and obstacles.
 */
export function buildShapeViews(
  elements: readonly CanvasElementModel[],
  tables: readonly TableModel[],
  selectedIds: ReadonlySet<string>,
  theme?: ThemeColors,
): ShapeView[] {
  const tableById = new Map(tables.map((t) => [t.id, t]));
  const elementById = new Map(elements.map((e) => [e.id, e]));
  const targetBox = (binding: ElementBinding): Box | null => {
    if (binding.targetKind === 'table') {
      const t = tableById.get(binding.targetId);
      return t ? tableBox(t) : null;
    }
    const e = elementById.get(binding.targetId);
    return e ? elementBox(e) : null;
  };

  return elements.map((element) => {
    const box = elementBox(element);
    const center = elementCenter(element);
    const stroke = contrastSafe(element.strokeColor, theme);
    const { fill, fillOpacity, hatch } = fillOf(element);
    const base: ShapeView = {
      id: element.id,
      type: element.type,
      selected: selectedIds.has(element.id),
      opacity: element.opacity / 100,
      stroke,
      strokeWidth: element.strokeWidth,
      dash: dashArray(element),
      fill,
      fillOpacity,
      hatch,
      transform: rotation(element, center),
      freehand: false,
      markerStart: 'none',
      markerEnd: 'none',
      markerColor: stroke,
      bbox: boxToBbox(box),
    };

    switch (element.type) {
      case 'rectangle':
        base.rect = {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          rx:
            element.cornerRadius ??
            Math.min(12, Math.min(element.width, element.height) * 0.15),
        };
        base.label = shapeLabel(element, base.bbox, theme);
        break;
      case 'ellipse':
        base.ellipse = {
          cx: element.x + element.width / 2,
          cy: element.y + element.height / 2,
          rx: element.width / 2,
          ry: element.height / 2,
        };
        base.label = shapeLabel(element, base.bbox, theme);
        break;
      case 'diamond': {
        const midX = element.x + element.width / 2;
        const midY = element.y + element.height / 2;
        base.polygon = [
          `${midX},${element.y}`,
          `${element.x + element.width},${midY}`,
          `${midX},${element.y + element.height}`,
          `${element.x},${midY}`,
        ].join(' ');
        base.label = shapeLabel(element, base.bbox, theme);
        break;
      }
      case 'freedraw':
        base.path = freehandFillPath(absolutePoints(element), element.strokeWidth);
        base.freehand = true;
        base.fill = stroke;
        break;
      case 'line':
      case 'arrow': {
        const sBox = element.startBinding ? targetBox(element.startBinding) : null;
        const tBox = element.endBinding ? targetBox(element.endBinding) : null;
        let ends: Point[];
        if (sBox && tBox) {
          // Both ends bound: a straight line between the two shape boundaries.
          ends = routeBoundConnector(sBox, tBox);
        } else {
          ends = resolveEnds(element, targetBox);
        }
        base.path = polylinePath(ends);
        base.fill = 'none';
        // Default arrowheads: arrow => end only; line => none. Element can override.
        const defaultEnd: ShapeView['markerEnd'] = element.type === 'arrow' ? 'arrow' : 'none';
        base.markerStart = element.startArrowhead ?? 'none';
        base.markerEnd = element.endArrowhead ?? defaultEnd;
        if (ends.length >= 2) {
          base.ends = { start: ends[0], end: ends[ends.length - 1] };
        }
        // Recompute bbox from resolved ends so the selection box tracks bindings.
        if (ends.length) {
          const xs = ends.map((p) => p.x);
          const ys = ends.map((p) => p.y);
          base.bbox = {
            x: Math.min(...xs),
            y: Math.min(...ys),
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys),
          };
        }
        break;
      }
      case 'text': {
        // Text wraps to its box width. While typing (auto mode) the box is kept
        // as wide as the content, so wrapping is a no-op; once the box has been
        // resized narrower, the text reflows to fit. Either way the selection box
        // is then fit to the wrapped content height so text never spills out.
        const tFontSize = element.fontSize ?? DEFAULT_FONT_SIZE;
        base.text = layoutTextBlock(element.text ?? '', base.bbox, {
          fontSize: tFontSize,
          fontFamilyKey: element.fontFamily,
          fontWeight: element.bold ? 800 : fontWeightFor(element.strokeWidth),
          italic: element.italic,
          color: stroke,
          align: element.textAlign ?? 'left',
          vAlign: element.verticalAlign ?? 'top',
          padding: 2,
          wrap: true,
        });
        const contentH = base.text.lines.length * tFontSize * LINE_HEIGHT + 4;
        base.bbox = { ...base.bbox, height: contentH };
        break;
      }
    }
    return base;
  });
}
