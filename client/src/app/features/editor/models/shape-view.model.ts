import type { ArrowheadType, ElementType, MediaPlayback } from '@devdesigner/shared';

/** One wrapped line with its absolute baseline position. */
export interface TextLineView {
   text: string;
   x: number;
   y: number;
   /** Rich text: the styled pieces of this line (absent = the line is one plain run). */
   spans?: TextSpanView[];
}

/** One styled piece of a rich-text line. */
export interface TextSpanView {
   text: string;
   fontWeight: number;
   fontStyle: 'normal' | 'italic';
   underline: boolean;
   color: string;
   /** Morph tag of these characters (rendered as `data-morph` so morphs can pair them). */
   morph?: string;
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

/** One colored run of code on a single line. Tokens flow left to right after the line's x. */
export interface CodeTokenView {
   text: string;
   color: string;
   italic: boolean;
}

/** What clicking a code block's title-bar dot does. */
export type CodeDotAction = 'delete' | 'collapse' | 'fit';

/** One drawn row of a code block. Diff rows override the card's gutter/text x and add a +/- sign. */
export interface CodeLineView {
   y: number;
   number: string;
   tokens: CodeTokenView[];
   /** Overrides CodeBlockView.numberX / textX (diff views). */
   numberX?: number;
   textX?: number;
   /** Inline diff: the original-side line number in a second gutter column. */
   oldNumber?: { x: number; text: string };
   /** Diff marker ('+' / '-') before the code. */
   sign?: { x: number; text: string; color: string };
}

/** A syntax-highlighted code block (code element): card, gutter and colored lines. */
export interface CodeBlockView {
   rect: { x: number; y: number; width: number; height: number; rx: number };
   background: string;
   fontSize: number;
   fontFamily: string;
   /** Unique id for the clip that keeps overflowing code inside the card. */
   clipId: string;
   /** Right edge of the line-number gutter and left edge of the code text (world x). */
   numberX: number;
   textX: number;
   numberColor: string;
   lines: CodeLineView[];
   /** Diff views only: row highlight bands (red removed, green added), drawn behind the code. */
   bands?: { x: number; y: number; width: number; height: number; fill: string }[];
   /** Split diff view only: the rule between the original and changed halves. */
   divider?: { x: number; y1: number; y2: number; color: string };
   /** True while collapsed to just the title bar. */
   collapsed: boolean;
   /** Window-style title bar across the top of the card (code starts below it). */
   header: {
      height: number;
      /** Title, centered at (x, y) like a window title. */
      text: string;
      x: number;
      y: number;
      color: string;
      tint: string;
      /** Window-style control dots down the left; `action` marks the clickable ones. */
      dots: { x: number; y: number; r: number; color: string; action: CodeDotAction }[];
   };
}

/** A spreadsheet-style table (grid element): outer frame, header tint, cell lines and text. */
export interface GridTableView {
   rect: { x: number; y: number; width: number; height: number; rx: number };
   /** Cell surface fill ('none' = transparent). */
   background: string;
   /** Tinted header-row band, or null when the grid has no header row. */
   header: { x: number; y: number; width: number; height: number; fill: string } | null;
   /** Inner cell borders (world coords). */
   lines: { x1: number; y1: number; x2: number; y2: number }[];
   /** Draw the outer border (off for the "inner" and "none" border modes). */
   outline: boolean;
   cells: TextBlockView[];
   /** Per-cell background fills (cells with a fill override). */
   fills: { x: number; y: number; width: number; height: number; fill: string }[];
   clipId: string;
   /** Absolute world x of every column edge / y of every row edge (first = left/top). */
   colEdges: number[];
   rowEdges: number[];
}

/**
 * Fully-resolved render data for one canvas element, produced by buildShapeViews
 * and consumed by CanvasShapesComponent. All coordinates are world-space; the SVG
 * layer offsets the whole group so negative coordinates are drawable. Bound
 * arrow/line endpoints are already resolved to their target boundary here, so the
 * component stays purely presentational.
 */
export interface ShapeView {
   /** Set when a clip-content frame holds this shape: the frame's box (world coords). */
   frameClip?: { x: number; y: number; width: number; height: number };
   id: string;
   type: ElementType;
   selected: boolean;
   /** A slide layout's item drawn under the slide: shown, never hit or edited. */
   locked?: boolean;
   opacity: number;
   stroke: string;
   /** Outline opacity 0..1 (applied inside the element's overall opacity). */
   strokeOpacity: number;
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
   /** An uploaded picture or video (image element), shown in this box. */
   image?: ImageView;
   /** A syntax-highlighted code block (code element). */
   code?: CodeBlockView;
   /** A spreadsheet-style table (grid element). */
   grid?: GridTableView;
   /** A live frame (embed element): its page box and URL (the card is `rect` + `label`). */
   embed?: EmbedView;
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

   /** Line/arrow: the curve's midpoint, where the draggable bend handle sits. */
   bend?: { x: number; y: number };

   /** Selection bounding box (world coords) for the outline and resize handles. */
   bbox: { x: number; y: number; width: number; height: number };
}

/** An image element's picture: the box it fills, where its whole source lands, and its clip. */
export interface ImageView {
   x: number;
   y: number;
   width: number;
   height: number;
   fileId: string;
   /** Where the whole source is drawn (stretched); the box itself when uncropped. */
   src: { x: number; y: number; width: number; height: number };
   /** Set when the picture is cropped or clipped: the outline it is clipped to. */
   clip?: ImageClipView;
   /** GIFs/videos: when playback starts (absent = click). */
   playback?: MediaPlayback;
   loop: boolean;
   muted: boolean;
   /** Videos: trim (seconds); absent = the whole video. */
   start?: number;
   end?: number;
   /** Description for screen readers. */
   alt?: string;
}

export interface ImageClipView {
   id: string;
   /** Rectangle outline (rx = corner radius). */
   rect?: { x: number; y: number; width: number; height: number; rx: number };
   ellipse?: { cx: number; cy: number; rx: number; ry: number };
   /** Diamond outline as SVG points. */
   polygon?: string;
   /** The same outline as a CSS clip-path (for HTML overlays positioned on the box). */
   css: string;
}

/** A live frame's page area. `url` is null until one is set (or when it is not http(s)). */
export interface EmbedView {
   x: number;
   y: number;
   width: number;
   height: number;
   rx: number;
   url: string | null;
}
