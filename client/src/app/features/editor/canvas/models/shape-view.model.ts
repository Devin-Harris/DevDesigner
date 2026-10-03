import type { ArrowheadType, ElementType } from '@dbdesigner/shared';

/** One wrapped line with its absolute baseline position. */
export interface TextLineView {
  text: string;
  x: number;
  y: number;
}

/** A laid-out text block (a text element's content, or a shape's centered label). */
export interface TextBlockView {
  lines: TextLineView[];
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  color: string;
  anchor: 'start' | 'middle' | 'end';
}

/**
 * Fully-resolved render data for one canvas element, produced by buildShapeViews
 * and consumed by CanvasShapesComponent. All coordinates are world-space; the SVG
 * layer offsets the whole group so negative coordinates are drawable. Bound
 * arrow/line endpoints are already resolved to their target boundary here, so the
 * component stays purely presentational.
 */
export interface ShapeView {
  id: string;
  type: ElementType;
  selected: boolean;
  opacity: number;
  stroke: string;
  strokeWidth: number;
  /** SVG stroke-dasharray, or null for a solid stroke. */
  dash: string | null;
  fill: string;
  fillOpacity: number;
  /** When set, a per-element diagonal-hatch <pattern> to emit and fill with. */
  hatch?: { id: string; color: string };
  /** Rotation applied around the element's center, or null when angle is 0. */
  transform: string | null;

  // Exactly one geometry field is set per element type.
  rect?: { x: number; y: number; width: number; height: number; rx: number };
  ellipse?: { cx: number; cy: number; rx: number; ry: number };
  polygon?: string;
  path?: string;
  /** True for a freehand stroke: `path` is a filled outline (fill = stroke color). */
  freehand: boolean;
  /** Arrowhead style at each end (line/arrow only; 'none' otherwise). */
  markerStart: ArrowheadType;
  markerEnd: ArrowheadType;
  /** The stroke color, exposed so arrowhead markers can match it per element. */
  markerColor: string;
  /** Content of a text element (the element IS this text). */
  text?: TextBlockView;
  /** Centered label drawn inside a shape (rectangle/ellipse/diamond). */
  label?: TextBlockView;

  /** Resolved endpoints for a line/arrow, used to draw endpoint handles. */
  ends?: { start: { x: number; y: number }; end: { x: number; y: number } };

  /** Selection bounding box (world coords) for the outline and resize handles. */
  bbox: { x: number; y: number; width: number; height: number };
}
