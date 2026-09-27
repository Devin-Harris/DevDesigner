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
import { routeOrthogonal } from './routing.helper';

/** Map a stored font-family key to a concrete CSS font stack (see index.html). */
export const FONT_STACKS: Record<string, string> = {
  hand: "'Kalam', 'Comic Sans MS', cursive",
  normal: "'Nunito', 'Segoe UI', system-ui, sans-serif",
  code: "'JetBrains Mono', ui-monospace, 'Cascadia Mono', monospace",
};

export function fontStack(key: string | undefined): string {
  return FONT_STACKS[key ?? 'normal'] ?? FONT_STACKS['normal'];
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
    color: string;
    align: TextAlign;
    vAlign: VerticalAlign;
    padding: number;
    wrap: boolean;
  },
): TextBlockView {
  const stack = fontStack(opts.fontFamilyKey);
  const cssFont = `${opts.fontWeight} ${opts.fontSize}px ${stack}`;
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

function fillOf(element: CanvasElementModel): { fill: string; fillOpacity: number } {
  if (element.fillStyle === 'none' || !element.backgroundColor) {
    return { fill: 'none', fillOpacity: 1 };
  }
  // Hachure is approximated as a lighter solid fill (no cross-hatching yet).
  return {
    fill: element.backgroundColor,
    fillOpacity: element.fillStyle === 'hachure' ? 0.35 : 1,
  };
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
    resolved[0] = boundaryPoint(startBox, pts[1] ?? end);
  }
  if (endBox) {
    resolved[resolved.length - 1] = boundaryPoint(endBox, pts[pts.length - 2] ?? start);
  }
  return resolved;
}

function boxToBbox(box: Box): ShapeView['bbox'] {
  return { x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 };
}

/** A shape's optional centered text label (rectangle/ellipse/diamond). */
function shapeLabel(element: CanvasElementModel, box: ShapeView['bbox']): TextBlockView | undefined {
  if (!element.text) {
    return undefined;
  }
  return layoutTextBlock(element.text, box, {
    fontSize: element.fontSize ?? 16,
    fontFamilyKey: element.fontFamily,
    fontWeight: fontWeightFor(element.strokeWidth),
    color: element.strokeColor,
    align: element.textAlign ?? 'center',
    vAlign: element.verticalAlign ?? 'middle',
    padding: 8,
    wrap: true,
  });
}

/** Anchor a bound endpoint to the midpoint of the box side facing the other end. */
function sideAnchor(box: Box, towardRight: boolean): { point: Point; dir: number } {
  const cy = (box.y0 + box.y1) / 2;
  return { point: { x: towardRight ? box.x1 : box.x0, y: cy }, dir: towardRight ? 1 : -1 };
}

/**
 * Route a both-ends-bound line/arrow orthogonally around obstacles (the ERD
 * connector router), so it traverses around shapes instead of crossing them.
 */
function routeBoundConnector(sBox: Box, tBox: Box, obstacles: readonly Box[]): Point[] {
  const sc = (sBox.x0 + sBox.x1) / 2;
  const tc = (tBox.x0 + tBox.x1) / 2;
  const src = sideAnchor(sBox, tc >= sc);
  const tgt = sideAnchor(tBox, sc > tc);
  return routeOrthogonal(src.point, tgt.point, src.dir, tgt.dir, [...obstacles, sBox, tBox]);
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

  // Obstacle boxes for routing: all tables and box-shaped elements, keyed by id.
  const obstacleById = new Map<string, Box>();
  for (const t of tables) {
    obstacleById.set(`table:${t.id}`, tableBox(t));
  }
  for (const e of elements) {
    if (e.type === 'rectangle' || e.type === 'ellipse' || e.type === 'diamond' || e.type === 'text') {
      obstacleById.set(`elem:${e.id}`, elementBox(e));
    }
  }

  return elements.map((element) => {
    const box = elementBox(element);
    const center = elementCenter(element);
    const { fill, fillOpacity } = fillOf(element);
    const base: ShapeView = {
      id: element.id,
      type: element.type,
      selected: selectedIds.has(element.id),
      opacity: element.opacity / 100,
      stroke: element.strokeColor,
      strokeWidth: element.strokeWidth,
      dash: dashArray(element),
      fill,
      fillOpacity,
      transform: rotation(element, center),
      freehand: false,
      markerStart: 'none',
      markerEnd: 'none',
      markerColor: element.strokeColor,
      bbox: boxToBbox(box),
    };

    switch (element.type) {
      case 'rectangle':
        base.rect = {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          rx: Math.min(12, Math.min(element.width, element.height) * 0.15),
        };
        base.label = shapeLabel(element, base.bbox);
        break;
      case 'ellipse':
        base.ellipse = {
          cx: element.x + element.width / 2,
          cy: element.y + element.height / 2,
          rx: element.width / 2,
          ry: element.height / 2,
        };
        base.label = shapeLabel(element, base.bbox);
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
        base.label = shapeLabel(element, base.bbox);
        break;
      }
      case 'freedraw':
        base.path = freehandFillPath(absolutePoints(element), element.strokeWidth);
        base.freehand = true;
        base.fill = element.strokeColor;
        break;
      case 'line':
      case 'arrow': {
        const sBox = element.startBinding ? targetBox(element.startBinding) : null;
        const tBox = element.endBinding ? targetBox(element.endBinding) : null;
        let ends: Point[];
        if (sBox && tBox) {
          // Both ends bound: route orthogonally around every other shape/table.
          const exclude = new Set<Box>([sBox, tBox]);
          const obstacles = [...obstacleById.values()].filter((b) => !exclude.has(b));
          ends = routeBoundConnector(sBox, tBox, obstacles);
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
      case 'text':
        base.text = layoutTextBlock(element.text ?? '', base.bbox, {
          fontSize: element.fontSize ?? DEFAULT_FONT_SIZE,
          fontFamilyKey: element.fontFamily,
          fontWeight: fontWeightFor(element.strokeWidth),
          color: element.strokeColor,
          align: element.textAlign ?? 'left',
          vAlign: element.verticalAlign ?? 'top',
          padding: 2,
          wrap: true,
        });
        break;
    }
    return base;
  });
}
