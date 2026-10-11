import type {
  CanvasElementModel,
  ElementBinding,
  TableModel,
  TextAlign,
  TextRun,
  VerticalAlign,
} from '@dbdesigner/shared';
import type { Box, Point } from '../models/geometry.model';
import { runLines, runWeight, usableRuns } from './rich-text.helper';
import type {
  CodeBlockView,
  ShapeView,
  TextBlockView,
  TextLineView,
} from '../models/shape-view.model';
import {
  CODE_LANGUAGE_LABELS,
  TAB_SIZE,
  codePalette,
  expandTabs,
  isElisionLine,
  tokenColor,
  tokenizeCode,
  type CodeToken,
} from './code-highlight.helper';
import {
  absolutePoints,
  boundaryPoint,
  type RotatedBox,
  elementBox,
  elementCenter,
  FRAME_TITLE_H,
  FRAME_TITLE_W,
  tableBox,
} from './element-geometry.helper';
import { curvedPath, freehandFillPath, polylinePath } from './freedraw-path.helper';
import { ANCHOR_GAP } from '../constants/canvas.constants';

/** Map a stored font-family key to a concrete CSS font stack (see index.html). */
export const FONT_STACKS: Record<string, string> = {
  normal: "'Nunito', 'Segoe UI', system-ui, sans-serif",
  inter: "'Inter', 'Segoe UI', system-ui, sans-serif",
  poppins: "'Poppins', 'Segoe UI', system-ui, sans-serif",
  serif: "'Lora', Georgia, 'Times New Roman', serif",
  display: "'Playfair Display', Georgia, 'Times New Roman', serif",
  condensed: "'Oswald', 'Arial Narrow', Impact, sans-serif",
  hand: "'Kalam', 'Comic Sans MS', cursive",
  caveat: "'Caveat', 'Segoe Script', cursive",
  marker: "'Permanent Marker', 'Marker Felt', cursive",
  code: "'JetBrains Mono', ui-monospace, 'Cascadia Mono', monospace",
};

/** Font choices offered in the text controls (labels are drawn in their own face). */
export const FONT_OPTIONS: { value: string; label: string }[] = [
  { value: 'normal', label: 'Nunito' },
  { value: 'inter', label: 'Inter' },
  { value: 'poppins', label: 'Poppins' },
  { value: 'serif', label: 'Lora (serif)' },
  { value: 'display', label: 'Playfair (display)' },
  { value: 'condensed', label: 'Oswald (condensed)' },
  { value: 'hand', label: 'Kalam (hand)' },
  { value: 'caveat', label: 'Caveat (script)' },
  { value: 'marker', label: 'Permanent Marker' },
  { value: 'code', label: 'JetBrains Mono' },
];

export function fontStack(key: string | undefined): string {
  return FONT_STACKS[key ?? 'normal'] ?? FONT_STACKS['normal'];
}

/** Live theme colors used by the contrast guard (resolved CSS values). */
export interface ThemeColors {
  /** The canvas background a shape sits on (`--dbd-canvas-bg`). */
  canvasBg: string;
  /** The theme's foreground/text color to fall back to (`--dbd-text`). */
  text: string;
  /** The raised surface color (`--dbd-surface`) used by the "surface" fill. */
  surface?: string;
}

/**
 * Sentinel `backgroundColor` meaning "the theme surface" (`--dbd-surface`). It is
 * resolved at render time so the fill follows light/dark mode, and — unlike
 * `fillStyle: 'none'` — it is opaque, hiding the canvas grid behind the shape.
 */
export const SURFACE_FILL = 'surface';

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

/** Build a CSS font shorthand for a run, given the block's typography. */
function cssFontFor(opts: { fontSize: number; fontFamilyKey: string | undefined }) {
  const stack = fontStack(opts.fontFamilyKey);
  return (weight: number, italic: boolean): string =>
    `${italic ? 'italic ' : ''}${weight} ${opts.fontSize}px ${stack}`;
}

/**
 * Word-wrap styled lines to `maxWidth`. Words are measured in their own run's
 * font (bold is wider), long words are broken by character, and trailing spaces
 * are dropped at a break so alignment stays true.
 */
function wrapRunLines(
  paragraphs: TextRun[][],
  maxWidth: number,
  baseWeight: number,
  baseItalic: boolean,
  fontFor: (weight: number, italic: boolean) => string,
): TextRun[][] {
  const out: TextRun[][] = [];
  for (const para of paragraphs) {
    let line: TextRun[] = [];
    let width = 0;
    const add = (run: TextRun, text: string): void => {
      const last = line[line.length - 1];
      if (
        last &&
        last.bold === run.bold &&
        last.italic === run.italic &&
        last.underline === run.underline &&
        last.color === run.color &&
        last.morph === run.morph
      ) {
        last.text += text;
      } else {
        line.push({ ...run, text });
      }
    };
    const flush = (): void => {
      const last = line[line.length - 1];
      if (last) {
        last.text = last.text.replace(/\s+$/, '');
      }
      out.push(line.filter((r) => r.text));
      line = [];
      width = 0;
    };
    for (const run of para) {
      const font = fontFor(runWeight(baseWeight, run), run.italic ?? baseItalic);
      for (const tok of run.text.match(/\S+\s*|\s+/g) ?? []) {
        const wordW = measureWidth(tok.replace(/\s+$/, ''), font);
        if (width > 0 && width + wordW > maxWidth) {
          flush();
        }
        if (wordW > maxWidth) {
          // A word wider than the box: break it by character.
          for (const ch of tok) {
            const cw = measureWidth(ch, font);
            if (width > 0 && width + cw > maxWidth) {
              flush();
            }
            add(run, ch);
            width += cw;
          }
        } else {
          add(run, tok);
          width += measureWidth(tok, font);
        }
      }
    }
    out.push(line);
  }
  return out;
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
    /** Line height as a multiple of the font size (default 1.25). */
    lineHeight?: number;
    /** Styled runs (honoured when not wrapping); `resolveColor` guards run colors for contrast. */
    runs?: readonly TextRun[] | null;
    resolveColor?: (color: string) => string;
  },
): TextBlockView {
  const stack = fontStack(opts.fontFamilyKey);
  const style = opts.italic ? 'italic ' : '';
  const cssFont = `${style}${opts.fontWeight} ${opts.fontSize}px ${stack}`;
  const maxWidth = Math.max(8, box.width - opts.padding * 2);
  const rich = opts.runs?.length
    ? opts.wrap
      ? wrapRunLines(runLines(opts.runs), maxWidth, opts.fontWeight, !!opts.italic, cssFontFor(opts))
      : runLines(opts.runs)
    : null;
  const lines: string[] = [];
  if (rich) {
    for (const line of rich) {
      lines.push(line.map((r) => r.text).join(''));
    }
  } else {
    for (const para of text.split('\n')) {
      if (opts.wrap) {
        lines.push(...wrapParagraph(para, maxWidth, cssFont));
      } else {
        lines.push(para);
      }
    }
  }
  const lineHeight = opts.fontSize * (opts.lineHeight ?? LINE_HEIGHT);
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
  // The baseline sits where a browser puts it: centred in the line box, so a
  // looser line height adds space above and below the glyphs rather than only below.
  const baseline = lineHeight / 2 + opts.fontSize * 0.175;
  const lineViews: TextLineView[] = lines.map((t, i) => {
    const view: TextLineView = { text: t, x, y: top + i * lineHeight + baseline };
    if (rich) {
      view.spans = rich[i].map((r) => ({
        text: r.text,
        fontWeight: runWeight(opts.fontWeight, r),
        fontStyle: (r.italic ?? !!opts.italic) ? 'italic' : 'normal',
        underline: !!r.underline,
        color: r.color ? (opts.resolveColor?.(r.color) ?? r.color) : opts.color,
        ...(r.morph ? { morph: r.morph } : {}),
      }));
    }
    return view;
  });
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

// --- code blocks ---

export const CODE_FONT_SIZE = 14;
/** Inner padding of a code card and the gap between the line-number gutter and the code. */
export const CODE_PADDING = 12;
const CODE_GUTTER_GAP = 14;
const CODE_LINE_HEIGHT = 1.5;

/** Baseline offset inside a code line box; matches how a textarea centers a line. */
function codeBaseline(fontSize: number): number {
  return (fontSize * CODE_LINE_HEIGHT) / 2 + fontSize * 0.36;
}

function codeCharWidth(fontSize: number): number {
  return measureWidth('0'.repeat(20), `400 ${fontSize}px ${fontStack('code')}`) / 20;
}

/** Geometry shared by the SVG renderer and the inline editor so the two line up exactly. */
export function codeLayoutMetrics(
  fontSize: number,
  lineCount: number,
): { charWidth: number; lineHeight: number; textOffset: number } {
  const charWidth = codeCharWidth(fontSize);
  const digits = Math.max(2, String(lineCount).length);
  return {
    charWidth,
    lineHeight: fontSize * CODE_LINE_HEIGHT,
    textOffset: CODE_PADDING + digits * charWidth + CODE_GUTTER_GAP,
  };
}

/** Number of numbered lines in a code block (elision rows like `...` are not numbered). */
export function codeLineCount(text: string): number {
  const lines = (text || '').replace(/\r\n?/g, '\n').split('\n');
  return Math.max(1, lines.filter((l) => !isElisionLine(l)).length);
}

/** One drawn row of a code block: a line or an elision gap. */
interface CodeRow {
  tokens: CodeToken[];
  /** Line number, '' for gaps. */
  number: string;
  gap: boolean;
}

/** Expand tabs across a line's tokens (column-aware, so rendered and typed columns agree). */
function expandTokenTabs(tokens: CodeToken[]): CodeToken[] {
  let col = 0;
  return tokens.map((t) => {
    let text = '';
    for (const ch of t.text) {
      if (ch === '\t') {
        const n = TAB_SIZE - (col % TAB_SIZE);
        text += ' '.repeat(n);
        col += n;
      } else {
        text += ch;
        col += 1;
      }
    }
    return { text, kind: t.kind };
  });
}

/** How many characters fit across a code card of `width`. */
export function codeColumns(width: number, textOffset: number, charWidth: number): number {
  return Math.max(4, Math.floor((width - textOffset - CODE_PADDING) / charWidth + 1e-6));
}

/**
 * Lay a code block out into drawn rows: tokenized, tab-expanded, elision lines as
 * gaps (unnumbered).
 */
function layoutCodeRows(
  text: string,
  language: string,
  fontSize: number,
): { rows: CodeRow[]; metrics: ReturnType<typeof codeLayoutMetrics>; digits: number } {
  const raw = (text || '').replace(/\r\n?/g, '\n').split('\n');
  const tokenLines = tokenizeCode(text || '', language);
  const realCount = Math.max(1, raw.filter((l) => !isElisionLine(l)).length);
  const metrics = codeLayoutMetrics(fontSize, realCount);
  const rows: CodeRow[] = [];
  let n = 0;
  raw.forEach((line, i) => {
    if (isElisionLine(line)) {
      const indent = /^\s*/.exec(expandTabs(line))?.[0] ?? '';
      const tokens: CodeToken[] = [];
      if (indent) {
        tokens.push({ text: indent, kind: 'plain' });
      }
      tokens.push({ text: '...', kind: 'elision' });
      rows.push({ tokens, number: '', gap: true });
      return;
    }
    n += 1;
    const tokens = expandTokenTabs(tokenLines[i] ?? []);
    rows.push({ tokens, number: String(n), gap: false });
  });
  return { rows, metrics, digits: Math.max(2, String(realCount).length) };
}

/** The smallest box that shows all of `text` without clipping. */
export function codeContentSize(
  text: string,
  fontSize: number,
): { width: number; height: number } {
  const { rows, metrics } = layoutCodeRows(text, 'plaintext', fontSize);
  const longest = Math.max(1, ...rows.map((r) => r.tokens.reduce((c, t) => c + t.text.length, 0)));
  return {
    width: Math.ceil(metrics.textOffset + longest * metrics.charWidth + CODE_PADDING),
    height: Math.ceil(rows.length * metrics.lineHeight + CODE_PADDING * 2),
  };
}

/**
 * The Prettier print width that matches a code card's current width, so formatting
 * re-flows the code to the card's bounds (taller, not wider).
 */
export function codePrintWidth(element: CanvasElementModel): number {
  const fontSize = element.fontSize ?? CODE_FONT_SIZE;
  const m = codeLayoutMetrics(fontSize, codeLineCount(element.text ?? ''));
  return Math.max(20, codeColumns(element.width, m.textOffset, m.charWidth));
}

/** True when the color is dark enough that a light token palette reads on it. */
function isDarkColor(color: string): boolean {
  const rgb = parseColor(color);
  return rgb ? relativeLuminance(rgb) < 0.25 : false;
}

/** The surface a code card is drawn on: its own fill, else the theme-matched default. */
function codeBackground(element: CanvasElementModel, theme: ThemeColors | undefined): string {
  if (element.fillStyle !== 'none' && element.backgroundColor) {
    return element.backgroundColor === SURFACE_FILL
      ? (theme?.surface ?? '#ffffff')
      : element.backgroundColor;
  }
  const canvasDark = theme ? isDarkColor(theme.canvasBg) : false;
  return codePalette(canvasDark).background;
}

function codeBlockView(
  element: CanvasElementModel,
  theme: ThemeColors | undefined,
): CodeBlockView {
  const fontSize = element.fontSize ?? CODE_FONT_SIZE;
  const background = codeBackground(element, theme);
  const palette = codePalette(isDarkColor(background));
  const language = element.language ?? 'typescript';
  const { rows, metrics: m, digits } = layoutCodeRows(
    element.text ?? '',
    language,
    fontSize,
  );
  const baseline = codeBaseline(fontSize);
  const top = element.y + CODE_PADDING;
  const lines = rows.map((row, i) => ({
    y: top + i * m.lineHeight + baseline,
    number: row.number,
    tokens: row.tokens.map((t) => ({
      // An elision reads as a muted "···" (same width as the "..." typed).
      text: t.kind === 'elision' ? '\u00b7\u00b7\u00b7' : t.text,
      color: tokenColor(palette, t.kind),
      italic: t.kind === 'comment',
    })),
  }));
  const labelText = language === 'plaintext' ? '' : CODE_LANGUAGE_LABELS[language];
  const firstLineLen = (rows[0]?.tokens ?? []).reduce((n, t) => n + t.text.length, 0);
  const labelWidth = labelText.length * 10 * 0.62;
  const room = element.width - (m.textOffset + firstLineLen * m.charWidth) - CODE_PADDING;
  return {
    rect: {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      rx: element.cornerRadius ?? 8,
    },
    background,
    fontSize,
    fontFamily: fontStack('code'),
    clipId: `code-clip-${element.id}`,
    numberX: element.x + CODE_PADDING + digits * m.charWidth,
    textX: element.x + m.textOffset,
    numberColor: palette.muted,
    lines,
    label:
      labelText && room > labelWidth + 12
        ? {
            text: labelText,
            x: element.x + element.width - 10,
            y: element.y + 15,
            color: palette.muted,
          }
        : undefined,
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

function fillOf(
  element: CanvasElementModel,
  theme: ThemeColors | undefined,
): {
  fill: string;
  fillOpacity: number;
  hatch?: { id: string; color: string };
} {
  if (element.fillStyle === 'none' || !element.backgroundColor) {
    return { fill: 'none', fillOpacity: 1 };
  }
  const color =
    element.backgroundColor === SURFACE_FILL
      ? (theme?.surface ?? '#ffffff')
      : element.backgroundColor;
  // Hachure = real diagonal-line hatching via a per-element SVG <pattern>.
  if (element.fillStyle === 'hachure') {
    const id = `hatch-${element.id}`;
    return { fill: `url(#${id})`, fillOpacity: 1, hatch: { id, color } };
  }
  return { fill: color, fillOpacity: 1 };
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
  targetBox: (binding: ElementBinding) => RotatedBox | null,
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
    lineHeight: element.lineHeight,
  });
}

/** A line/arrow's optional label, centered just above the segment's midpoint. */
function arrowLabel(
  element: CanvasElementModel,
  start: Point,
  end: Point,
  theme: ThemeColors | undefined,
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
function routeBoundConnector(sBox: RotatedBox, tBox: RotatedBox): Point[] {
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
  messageBoxes?: ReadonlyMap<string, Box>,
): ShapeView[] {
  const tableById = new Map(tables.map((t) => [t.id, t]));
  const elementById = new Map(elements.map((e) => [e.id, e]));
  const targetBox = (binding: ElementBinding): RotatedBox | null => {
    if (binding.targetKind === 'message') {
      return messageBoxes?.get(binding.targetId) ?? null;
    }
    if (binding.targetKind === 'table') {
      const t = tableById.get(binding.targetId);
      return t ? tableBox(t) : null;
    }
    const e = elementById.get(binding.targetId);
    return e ? { ...elementBox(e), angle: e.angle } : null;
  };

  const views = elements.map((element) => {
    const box = elementBox(element);
    const center = elementCenter(element);
    const stroke = contrastSafe(element.strokeColor, theme);
    const { fill, fillOpacity, hatch } = fillOf(element, theme);
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
      case 'code':
        base.code = codeBlockView(element, theme);
        // The card carries its own fill; the SVG layer draws the border from stroke.
        base.fill = base.code.background;
        break;
      case 'image':
        if (element.fileId) {
          base.image = {
            x: element.x,
            y: element.y,
            width: element.width,
            height: element.height,
            fileId: element.fileId,
          };
        }
        break;
      case 'frame': {
        // A page outline: square corners, transparent unless a fill was chosen,
        // with its name sitting above the top-left corner (outside the frame, so
        // it never lands in an export crop).
        base.rect = { x: element.x, y: element.y, width: element.width, height: element.height, rx: 0 };
        // A slide's name is drawn on the slide outline instead (editor overlay).
        if (element.text && !element.slide) {
          base.label = layoutTextBlock(
            element.text,
            { x: element.x, y: element.y - FRAME_TITLE_H, width: FRAME_TITLE_W, height: FRAME_TITLE_H },
            {
              fontSize: 14,
              fontFamilyKey: 'normal',
              fontWeight: 600,
              color: stroke,
              align: 'left',
              vAlign: 'middle',
              padding: 0,
              wrap: false,
            },
          );
        }
        break;
      }
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
        const curvature = ends.length >= 2 ? (element.curvature ?? 0) : 0;
        let labelAt: Point | undefined;
        if (Math.abs(curvature) > 0.5) {
          const curve = curvedPath(ends[0], ends[ends.length - 1], curvature);
          base.path = curve.path;
          base.bend = curve.mid;
          labelAt = curve.mid;
        } else {
          base.path = polylinePath(ends);
          if (ends.length >= 2) {
            base.bend = {
              x: (ends[0].x + ends[ends.length - 1].x) / 2,
              y: (ends[0].y + ends[ends.length - 1].y) / 2,
            };
          }
        }
        base.fill = 'none';
        // Default arrowheads: arrow => end only; line => none. Element can override.
        const defaultEnd: ShapeView['markerEnd'] = element.type === 'arrow' ? 'arrow' : 'none';
        base.markerStart = element.startArrowhead ?? 'none';
        base.markerEnd = element.endArrowhead ?? defaultEnd;
        if (ends.length >= 2) {
          base.ends = { start: ends[0], end: ends[ends.length - 1] };
          base.label = arrowLabel(element, labelAt ?? ends[0], labelAt ? labelAt : ends[ends.length - 1], theme);
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
        // Text hugs its glyphs and never wraps: the box is sized to the content
        // (resizing scales the font instead). The one exception is legacy text
        // that was resized narrower before this model — it keeps its wrapping
        // until it is next edited, so existing drawings do not change.
        const tFontSize = element.fontSize ?? DEFAULT_FONT_SIZE;
        const tWeight = element.bold ? 800 : fontWeightFor(element.strokeWidth);
        // Legacy-wrapped text is recognised from its stored HEIGHT (taller than its
        // explicit lines), which — unlike a width measurement — does not depend on
        // whether the web font has loaded yet.
        const explicitLines = (element.text ?? '').split('\n').length;
        const lineH = tFontSize * (element.lineHeight ?? LINE_HEIGHT);
        const legacyWrapped =
          element.wrap ?? element.height > explicitLines * lineH + 4 + lineH * 0.5;
        base.text = layoutTextBlock(element.text ?? '', base.bbox, {
          fontSize: tFontSize,
          fontFamilyKey: element.fontFamily,
          fontWeight: tWeight,
          italic: element.italic,
          color: stroke,
          align: element.textAlign ?? 'left',
          vAlign: element.verticalAlign ?? 'top',
          padding: 2,
          wrap: legacyWrapped,
          lineHeight: element.lineHeight,
          runs: usableRuns(element.text ?? '', element.runs),
          resolveColor: (c) => contrastSafe(c, theme),
        });
        const contentH =
          base.text.lines.length * tFontSize * (element.lineHeight ?? LINE_HEIGHT) + 4;
        base.bbox = { ...base.bbox, height: contentH };
        break;
      }
    }
    return base;
  });
  // Frames are page backdrops: draw them beneath everything else (stable sort).
  return views.sort((a, b) => Number(b.type === 'frame') - Number(a.type === 'frame'));
}
