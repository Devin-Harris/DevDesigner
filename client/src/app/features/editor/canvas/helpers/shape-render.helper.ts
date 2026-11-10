import { THEME_STROKE } from '@devdesigner/shared';
import type {
   CanvasElementModel,
   CodeLanguage,
   ElementBinding,
   TableModel,
   TextAlign,
   TextRun,
   VerticalAlign,
} from '@devdesigner/shared';
import type { Box, Point } from '../models/geometry.model';
import { runLines, runWeight, usableRuns } from './rich-text.helper';
import { isFullCrop, mediaSourceRect } from './media.helper';
import type {
   CodeBlockView,
   CodeDotAction,
   CodeLineView,
   GridTableView,
   ImageView,
   ShapeView,
   TextBlockView,
   TextLineView,
} from '../models/shape-view.model';
import {
   CODE_LANGUAGE_EXTENSIONS,
   TAB_SIZE,
   codePalette,
   expandTabs,
   isElisionLine,
   tokenColor,
   tokenizeCode,
   type CodeToken,
   type CodePalette,
} from './code-highlight.helper';
import { changedSpan, diffLines, splitLines, splitRows } from './code-diff.helper';
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
import { GRID_CELL_PAD, cellKey, edges, gridSizes, mergeAt, parseGrid, type GridData } from './grid-table.helper';
import { curvedPath, freehandFillPath, polylinePath } from './freedraw-path.helper';
import { textInkInsets } from './text-metrics';
import { ANCHOR_GAP } from '../constants/canvas.constants';
import { LruCache } from '../../../../shared/helpers/lru';

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

export function fontStack(key: string | undefined): string {
   return FONT_STACKS[key ?? 'normal'] ?? FONT_STACKS['normal'];
}

/** Live theme colors used by the contrast guard (resolved CSS values). */
export interface ThemeColors {
   /** The canvas background a shape sits on (`--dd-canvas-bg`). */
   canvasBg: string;
   /** The theme's foreground/text color to fall back to (`--dd-text`). */
   text: string;
   /** The raised surface color (`--dd-surface`) used by the "surface" fill. */
   surface?: string;
}

/**
 * Sentinel `backgroundColor` meaning "the theme surface" (`--dd-surface`). It is
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
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
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
   if (color === THEME_STROKE || color === SURFACE_FILL) {
      return sentinelColor(color, theme);
   }
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

/** The theme sentinels (`surface` / `theme`) as concrete colors; either can be a fill or a stroke. */
function sentinelColor(color: string, theme: ThemeColors | undefined): string {
   if (color === SURFACE_FILL) return theme?.surface ?? '#ffffff';
   if (color === THEME_STROKE) return theme?.text ?? '#1e293b';
   return color;
}

/** Text stroke-width maps to font weight (so the width control affects text). */
export function fontWeightFor(strokeWidth: number): number {
   return strokeWidth <= 1 ? 400 : strokeWidth <= 2 ? 600 : 800;
}

const DEFAULT_FONT_SIZE = 20;
const LINE_HEIGHT = 1.25;

const measureCtx: CanvasRenderingContext2D | null =
   typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;

/**
 * Where a browser puts the baseline inside a line box of `lineHeight` px: the
 * font's ascent+descent is centred in the box (half-leading above and below),
 * so the baseline is half-leading + ascent. Using the font's real metrics keeps
 * the SVG glyphs exactly where the contenteditable editor draws them.
 */
export function baselineInLine(cssFont: string, fontSize: number, lineHeight: number): number {
   if (measureCtx) {
      measureCtx.font = cssFont;
      const m = measureCtx.measureText('Hg');
      const asc = m.fontBoundingBoxAscent;
      const desc = m.fontBoundingBoxDescent;
      if (Number.isFinite(asc) && Number.isFinite(desc) && asc + desc > 0) {
         return (lineHeight - (asc + desc)) / 2 + asc;
      }
   }
   return lineHeight / 2 + fontSize * 0.175;
}

/** (font, text) -> width. Wrapping measures the same words over and over. */
const widthCache = new LruCache<string, number>(8000);
/** Grid text -> parsed grid, for drawing only (never mutate the result). */
const gridCache = new LruCache<string, GridData>(300);

/**
 * Drop text measurements (taken with a fallback face before a web font loaded). Called by
 * `clearTextMetricsCaches` when fonts finish loading.
 */
export function clearShapeRenderCaches(): void {
   widthCache.clear();
}

function measureWidth(text: string, cssFont: string): number {
   if (!measureCtx || text === '') {
      return text.length * 8;
   }
   return widthCache.getOrSet(cssFont + '\u0001' + text, () => {
      measureCtx.font = cssFont;
      return measureCtx.measureText(text).width;
   });
}

/** Greedily wrap a paragraph to a maximum width (word wrap, hard-breaks long words). */
function wrapParagraph(para: string, maxWidth: number, cssFont: string, breakWords = false): string[] {
   if (para === '') {
      return [''];
   }
   const words = para.split(/\s+/);
   const lines: string[] = [];
   let current = '';
   for (const word of words) {
      if (breakWords && measureWidth(word, cssFont) > maxWidth) {
         // A word wider than the box breaks by character (as the editor's CSS does).
         // The word starts its own line first, then breaks.
         if (current) {
            lines.push(current);
         }
         let chunk = '';
         for (const ch of word) {
            if (chunk && measureWidth(chunk + ch, cssFont) > maxWidth) {
               lines.push(chunk);
               chunk = '';
            }
            chunk += ch;
         }
         current = chunk;
         continue;
      }
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
/** A list item's leading indent + marker ("  • ", "1. "), whose width continuation lines hang under. */
const LIST_PREFIX = /^ *(?:[•◦▪]|\d+\.) /;

function wrapRunLines(
   paragraphs: TextRun[][],
   maxWidth: number,
   baseWeight: number,
   baseItalic: boolean,
   fontFor: (weight: number, italic: boolean) => string
): { runs: TextRun[]; indent: number }[] {
   const out: { runs: TextRun[]; indent: number }[] = [];
   for (const para of paragraphs) {
      let line: TextRun[] = [];
      let width = 0;
      // Wrapped lines of a list item start under its text, not under the marker.
      let hang = 0;
      const prefix = LIST_PREFIX.exec(para.map((r) => r.text).join(''))?.[0];
      if (prefix && para[0]) {
         hang = measureWidth(prefix, fontFor(runWeight(baseWeight, para[0]), para[0].italic ?? baseItalic));
      }
      // Every line of the item's text gets the width beside the marker; the marker
      // itself is never left alone on a line.
      const limit = Math.max(8, maxWidth - hang);
      let markerLeft = prefix?.length ?? 0;
      let indent = 0;
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
         out.push({ runs: line.filter((r) => r.text), indent });
         line = [];
         width = 0;
         indent = hang;
      };
      for (const run of para) {
         const font = fontFor(runWeight(baseWeight, run), run.italic ?? baseItalic);
         for (let tok of run.text.match(/\S+\s*|\s+/g) ?? []) {
            if (markerLeft > 0) {
               // Marker characters sit in the hang, outside the width the text wraps to.
               const head = tok.slice(0, markerLeft);
               add(run, head);
               markerLeft -= head.length;
               tok = tok.slice(head.length);
               if (!tok) {
                  continue;
               }
            }
            const max = hang ? limit : maxWidth;
            const wordW = measureWidth(tok.replace(/\s+$/, ''), font);
            if (width > 0 && width + wordW > max) {
               flush();
            }
            if (wordW > max) {
               // A word wider than the box: break it by character.
               for (const ch of tok) {
                  const cw = measureWidth(ch, font);
                  if (width > 0 && width + cw > max) {
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
      out.push({ runs: line, indent });
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
   }
): TextBlockView {
   const stack = fontStack(opts.fontFamilyKey);
   const style = opts.italic ? 'italic ' : '';
   const cssFont = `${style}${opts.fontWeight} ${opts.fontSize}px ${stack}`;
   const maxWidth = Math.max(8, box.width - opts.padding * 2);
   const wrapped = opts.runs?.length
      ? opts.wrap
         ? wrapRunLines(runLines(opts.runs), maxWidth, opts.fontWeight, !!opts.italic, cssFontFor(opts))
         : runLines(opts.runs).map((runs) => ({ runs, indent: 0 }))
      : null;
   const rich = wrapped?.map((l) => l.runs) ?? null;
   const lines: string[] = [];
   const indents: number[] = [];
   if (wrapped) {
      for (const line of wrapped) {
         lines.push(line.runs.map((r) => r.text).join(''));
         indents.push(line.indent);
      }
   } else {
      for (const para of text.split('\n')) {
         if (opts.wrap) {
            const prefix = LIST_PREFIX.exec(para)?.[0];
            if (prefix) {
               // The item's text wraps beside the marker; the marker stays on the first line.
               const hang = measureWidth(prefix, cssFont);
               const body = wrapParagraph(para.slice(prefix.length), Math.max(8, maxWidth - hang), cssFont, true);
               lines.push(prefix + body[0], ...body.slice(1));
               indents.push(0, ...body.slice(1).map(() => hang));
            } else {
               const wrapped = wrapParagraph(para, maxWidth, cssFont, true);
               lines.push(...wrapped);
               indents.push(...wrapped.map(() => 0));
            }
         } else {
            lines.push(para);
            indents.push(0);
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
   const baseline = baselineInLine(cssFont, opts.fontSize, lineHeight);
   const lineViews: TextLineView[] = lines.map((t, i) => {
      // Hanging indent only reads as one with left-aligned text.
      const lx = anchor === 'start' ? x + indents[i] : x;
      const view: TextLineView = { text: t, x: lx, y: top + i * lineHeight + baseline };
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

/** Window-style dots on a title bar: close deletes, minimize collapses, zoom fits to content. */
const TRAFFIC_LIGHT_GAP = 18;
const TRAFFIC_LIGHTS: { color: string; action: CodeDotAction }[] = [
   { color: '#ff5f57', action: 'delete' },
   { color: '#febc2e', action: 'collapse' },
   { color: '#28c840', action: 'fit' },
];
/** Width of the dot cluster from the card's left edge (used to keep the title clear of it). */
export const CODE_DOTS_WIDTH = CODE_PADDING + 2 + TRAFFIC_LIGHT_GAP * 3;

/** Height of a code card's title bar. */
export function codeHeaderHeight(fontSize: number): number {
   return Math.round(fontSize * 1.5 + 14);
}

/**
 * The title shown in a code card's bar: the file name, with the language's extension
 * appended when it has none. Empty when no file name is set.
 */
export function codeTitle(el: { fileName?: string; language?: CodeLanguage }): string {
   const name = el.fileName?.trim();
   if (!name) {
      return '';
   }
   if (/\.[A-Za-z0-9]+$/.test(name)) {
      return name;
   }
   return `${name}.${CODE_LANGUAGE_EXTENSIONS[el.language ?? 'typescript']}`;
}

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
   lineCount: number
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
   fontSize: number
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

// --- code diffs ---

/** The original (left) side's share of a split diff's width, clamped to keep both panes usable. */
export function codeDiffSplit(el: Pick<CanvasElementModel, 'diffSplit'>): number {
   return Math.min(0.85, Math.max(0.15, el.diffSplit ?? 0.5));
}

/** True when a code block shows a diff (it has a changed side and the view isn't off). */
export function codeDiffActive(el: Pick<CanvasElementModel, 'diffText' | 'diffView'>): boolean {
   return el.diffText != null && !!el.diffView && el.diffView !== 'off';
}

interface DiffColors {
   removed: string;
   added: string;
   removedStrong: string;
   addedStrong: string;
   removedSign: string;
   addedSign: string;
   filler: string;
   divider: string;
}

function diffColors(dark: boolean, palette: CodePalette): DiffColors {
   return {
      removed: dark ? 'rgba(248,81,73,0.16)' : 'rgba(255,129,130,0.22)',
      added: dark ? 'rgba(46,160,67,0.18)' : 'rgba(74,194,107,0.22)',
      removedStrong: dark ? 'rgba(248,81,73,0.4)' : 'rgba(255,129,130,0.5)',
      addedStrong: dark ? 'rgba(46,160,67,0.45)' : 'rgba(74,194,107,0.5)',
      removedSign: dark ? '#ff7b72' : '#cf222e',
      addedSign: dark ? '#56d364' : '#1a7f37',
      filler: dark ? 'rgba(110,118,129,0.12)' : 'rgba(175,184,193,0.18)',
      divider: palette.muted,
   };
}

function codeTokenViews(tokens: CodeToken[], palette: CodePalette): CodeLineView['tokens'] {
   return tokens.map((t) => ({
      // An elision reads as a muted "···" (same width as the "..." typed).
      text: t.kind === 'elision' ? '···' : t.text,
      color: tokenColor(palette, t.kind),
      italic: t.kind === 'comment',
   }));
}

/** Cut a line's tokens to its first `cols` characters (split halves can't overflow each other). */
function truncateTokens(tokens: CodeToken[], cols: number): CodeToken[] {
   const out: CodeToken[] = [];
   let left = cols;
   for (const t of tokens) {
      if (left <= 0) break;
      out.push(t.text.length > left ? { ...t, text: t.text.slice(0, left) } : t);
      left -= t.text.length;
   }
   return out;
}

const rowText = (tokens: CodeToken[]): string => tokens.map((t) => t.text).join('');

/** Both sides of a diff laid out (tokenized rows) and aligned. */
function codeDiffModel(element: CanvasElementModel, language: string, fontSize: number) {
   const a = layoutCodeRows(element.text ?? '', language, fontSize);
   const b = layoutCodeRows(element.diffText ?? '', language, fontSize);
   const unified = diffLines(
      splitLines(element.text ?? ''),
      splitLines(element.diffText ?? ''),
      !element.diffShowWhitespace
   );
   const digits = Math.max(a.digits, b.digits);
   const cw = a.metrics.charWidth;
   return { a, b, unified, digits, cw, lineHeight: a.metrics.lineHeight };
}

/** Gutter width of a diff pane: one number column plus a sign column. */
function diffGutters(digits: number, cw: number): { inline: number; split: number } {
   return {
      inline: CODE_PADDING + digits * cw + 3 * cw,
      split: CODE_PADDING + digits * cw + 3 * cw,
   };
}

/** The rows of a diff view (inline or split), with highlight bands and the split divider. */
function codeDiffLines(
   element: CanvasElementModel,
   palette: CodePalette,
   dark: boolean,
   language: string,
   fontSize: number,
   firstBaseline: number,
   editing = false
): {
   lines: CodeLineView[];
   bands: NonNullable<CodeBlockView['bands']>;
   divider?: CodeBlockView['divider'];
} {
   const { a, b, unified, digits, cw, lineHeight } = codeDiffModel(element, language, fontSize);
   const colors = diffColors(dark, palette);
   const gut = diffGutters(digits, cw);
   const lines: CodeLineView[] = [];
   const bands: NonNullable<CodeBlockView['bands']> = [];
   const rowTop = (i: number): number => firstBaseline - codeBaseline(fontSize) + i * lineHeight;
   const band = (i: number, x: number, width: number, fill: string): void => {
      if (width > 0) bands.push({ x, y: rowTop(i), width, height: lineHeight, fill });
   };
   const spanBand = (i: number, textX: number, span: [number, number], fill: string): void =>
      band(i, textX + span[0] * cw, (span[1] - span[0]) * cw, fill);

   if (editing) {
      // Each side keeps its own rows (so they stay under its textarea), still styled as a
      // diff: removed lines red on the left, added green on the right, changed words marked.
      const ed = codeDiffEditLayout(element);
      const cols = Math.max(1, Math.floor((ed.left - ed.textOffset - CODE_PADDING / 2) / cw));
      const changedA = new Set(unified.filter((d) => d.op === 'removed').map((d) => d.a));
      const changedB = new Set(unified.filter((d) => d.op === 'added').map((d) => d.b));
      const spansA = new Map<number, [number, number]>();
      const spansB = new Map<number, [number, number]>();
      for (const r of splitRows(unified)) {
         if (r.op !== 'change' || r.a < 0 || r.b < 0) continue;
         const sp = changedSpan(rowText(a.rows[r.a].tokens), rowText(b.rows[r.b].tokens), !element.diffShowWhitespace);
         if (sp) {
            spansA.set(r.a, sp.a);
            spansB.set(r.b, sp.b);
         }
      }
      const sides = [
         {
            side: a,
            changed: changedA,
            spans: spansA,
            sign: '-',
            signColor: colors.removedSign,
            fill: colors.removed,
            strong: colors.removedStrong,
         },
         {
            side: b,
            changed: changedB,
            spans: spansB,
            sign: '+',
            signColor: colors.addedSign,
            fill: colors.added,
            strong: colors.addedStrong,
         },
      ];
      sides.forEach((s, k) => {
         const x0 = element.x + k * ed.left;
         const w = k === 0 ? ed.left : element.width - ed.left;
         const numberX = x0 + CODE_PADDING + digits * cw;
         const textX = x0 + ed.textOffset;
         s.side.rows.forEach((row, i) => {
            const changed = s.changed.has(i);
            lines.push({
               y: firstBaseline + i * lineHeight,
               number: row.number,
               numberX,
               textX,
               sign: changed ? { x: numberX + cw, text: s.sign, color: s.signColor } : undefined,
               // The right pane is clipped by the card; the left must not run into it.
               tokens: codeTokenViews(k === 0 ? truncateTokens(row.tokens, cols) : row.tokens, palette),
            });
            if (changed) {
               band(i, x0, w, s.fill);
               const sp = s.spans.get(i);
               const end = sp ? (k === 0 ? Math.min(sp[1], cols) : sp[1]) : 0;
               if (sp && end > sp[0]) spanBand(i, textX, [sp[0], end], s.strong);
            }
         });
      });
      return {
         lines,
         bands,
         divider: {
            x: element.x + ed.left,
            y1: element.y + codeHeaderHeight(fontSize),
            y2: element.y + element.height,
            color: colors.divider,
         },
      };
   }

   if (element.diffView === 'inline') {
      // One number column: a removed line shows its original number, the rest their new one.
      const numberX = element.x + CODE_PADDING + digits * cw;
      const signX = numberX + cw;
      const textX = element.x + gut.inline;
      unified.forEach((d, i) => {
         const ra = d.a >= 0 ? a.rows[d.a] : null;
         const rb = d.b >= 0 ? b.rows[d.b] : null;
         const row = (rb ?? ra)!;
         lines.push({
            y: firstBaseline + i * lineHeight,
            number: rb?.number ?? ra?.number ?? '',
            numberX,
            textX,
            sign:
               d.op === 'equal'
                  ? undefined
                  : d.op === 'added'
                    ? { x: signX, text: '+', color: colors.addedSign }
                    : { x: signX, text: '-', color: colors.removedSign },
            tokens: codeTokenViews(row.tokens, palette),
         });
         if (d.op !== 'equal') {
            band(i, element.x, element.width, d.op === 'added' ? colors.added : colors.removed);
         }
      });
      // Word-level emphasis where removed lines are directly followed by their replacements.
      for (let i = 0; i < unified.length; i++) {
         if (unified[i].op !== 'removed') continue;
         let j = i;
         while (j < unified.length && unified[j].op === 'removed') j++;
         for (let k = 0; k < j - i && unified[j + k]?.op === 'added'; k++) {
            const span = changedSpan(
               rowText(a.rows[unified[i + k].a].tokens),
               rowText(b.rows[unified[j + k].b].tokens),
               !element.diffShowWhitespace
            );
            if (span) {
               spanBand(i + k, textX, span.a, colors.removedStrong);
               spanBand(j + k, textX, span.b, colors.addedStrong);
            }
         }
         i = j - 1;
      }
      return { lines, bands };
   }

   // Split: original on the left half, changed on the right, change blocks paired row by row.
   const left = element.width * codeDiffSplit(element);
   const cols = Math.max(1, Math.floor((left - gut.split - CODE_PADDING / 2) / cw));
   splitRows(unified).forEach((r, i) => {
      const ra = r.a >= 0 ? a.rows[r.a] : null;
      const rb = r.b >= 0 ? b.rows[r.b] : null;
      const sides = [
         { row: ra, x0: element.x, w: left, sign: '-', signColor: colors.removedSign, fill: colors.removed },
         {
            row: rb,
            x0: element.x + left,
            w: element.width - left,
            sign: '+',
            signColor: colors.addedSign,
            fill: colors.added,
         },
      ];
      const span =
         r.op === 'change' && ra && rb
            ? changedSpan(rowText(ra.tokens), rowText(rb.tokens), !element.diffShowWhitespace)
            : null;
      sides.forEach((s, k) => {
         const numberX = s.x0 + CODE_PADDING + digits * cw;
         const textX = s.x0 + gut.split;
         if (!s.row) {
            band(i, s.x0, s.w, colors.filler);
            return;
         }
         lines.push({
            y: firstBaseline + i * lineHeight,
            number: s.row.number,
            numberX,
            textX,
            sign: r.op === 'change' ? { x: numberX + cw, text: s.sign, color: s.signColor } : undefined,
            // The right pane is clipped by the card; the left must not run into it.
            tokens: codeTokenViews(k === 0 ? truncateTokens(s.row.tokens, cols) : s.row.tokens, palette),
         });
         if (r.op === 'change') {
            band(i, s.x0, s.w, s.fill);
            const sp = span ? (k === 0 ? span.a : span.b) : null;
            if (sp) {
               const end = k === 0 ? Math.min(sp[1], cols) : sp[1];
               if (end > sp[0]) {
                  spanBand(i, textX, [sp[0], end], k === 0 ? colors.removedStrong : colors.addedStrong);
               }
            }
         }
      });
   });
   return {
      lines,
      bands,
      divider: {
         x: element.x + left,
         y1: element.y + codeHeaderHeight(fontSize),
         y2: element.y + element.height,
         color: colors.divider,
      },
   };
}

/**
 * Geometry of a diff card while both sides are edited: two halves, each a plain code
 * pane with a shared gutter width (shared by the renderer and the two textareas).
 */
export function codeDiffEditLayout(el: CanvasElementModel): {
   /** Width of the left (original) pane; the right pane takes the rest. */
   left: number;
   textOffset: number;
   lineHeight: number;
   rows: number;
} {
   const fontSize = el.fontSize ?? CODE_FONT_SIZE;
   const count = Math.max(codeLineCount(el.text ?? ''), codeLineCount(el.diffText ?? ''));
   const m = codeLayoutMetrics(fontSize, count);
   // Same gutter as the split view (numbers + a sign column), so code doesn't jump on commit.
   const digits = Math.max(2, String(count).length);
   const textOffset = diffGutters(digits, m.charWidth).split;
   const rows = Math.max(splitLines(el.text ?? '').length, splitLines(el.diffText ?? '').length);
   return { left: el.width * codeDiffSplit(el), textOffset, lineHeight: m.lineHeight, rows };
}

/** Diff-aware content size: the plain size, or the inline/split diff's when a diff is shown. */
export function codeElementContentSize(el: CanvasElementModel): { width: number; height: number } {
   const fontSize = el.fontSize ?? CODE_FONT_SIZE;
   const title = codeTitle(el);
   if (!codeDiffActive(el)) {
      return codeContentSize(el.text ?? '', fontSize, title);
   }
   const { a, b, unified, digits, cw, lineHeight } = codeDiffModel(el, 'plaintext', fontSize);
   const gut = diffGutters(digits, cw);
   const longestOf = (rows: CodeRow[]): number => Math.max(1, ...rows.map((r) => rowText(r.tokens).length));
   const longest = Math.max(longestOf(a.rows), longestOf(b.rows));
   // Each split pane must fit its own side at the divider's position.
   const pane = (n: number): number => gut.split + n * cw + CODE_PADDING / 2 + 1;
   const r = codeDiffSplit(el);
   const header = codeHeaderHeight(fontSize);
   const nameWidth = 2 * CODE_DOTS_WIDTH + title.length * 12 * 0.62 + 8;
   const inline = el.diffView === 'inline';
   const width = inline
      ? gut.inline + longest * cw + CODE_PADDING
      : Math.max(pane(longestOf(a.rows)) / r, pane(longestOf(b.rows)) / (1 - r));
   const rows = inline ? unified.length : splitRows(unified).length;
   return {
      width: Math.ceil(Math.max(width, nameWidth)),
      height: Math.ceil(header + rows * lineHeight + CODE_PADDING * 2),
   };
}

/** The smallest box that shows all of `text` without clipping. */
export function codeContentSize(text: string, fontSize: number, title = ''): { width: number; height: number } {
   const { rows, metrics } = layoutCodeRows(text, 'plaintext', fontSize);
   const longest = Math.max(1, ...rows.map((r) => r.tokens.reduce((c, t) => c + t.text.length, 0)));
   const header = codeHeaderHeight(fontSize);
   // The title bar needs room for the centered title between its dot cluster and an
   // equal margin on the right, as well as the code.
   const nameWidth = 2 * CODE_DOTS_WIDTH + title.length * 12 * 0.62 + 8;
   return {
      width: Math.ceil(Math.max(metrics.textOffset + longest * metrics.charWidth + CODE_PADDING, nameWidth)),
      height: Math.ceil(header + rows.length * metrics.lineHeight + CODE_PADDING * 2),
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
      return sentinelColor(element.backgroundColor, theme);
   }
   const canvasDark = theme ? isDarkColor(theme.canvasBg) : false;
   return codePalette(canvasDark).background;
}

function codeBlockView(
   element: CanvasElementModel,
   theme: ThemeColors | undefined,
   diffEditing = false
): CodeBlockView {
   const fontSize = element.fontSize ?? CODE_FONT_SIZE;
   const background = codeBackground(element, theme);
   const palette = codePalette(isDarkColor(background));
   const language = element.language ?? 'typescript';
   const { rows, metrics: m, digits } = layoutCodeRows(element.text ?? '', language, fontSize);
   const baseline = codeBaseline(fontSize);
   const header = codeHeaderHeight(fontSize);
   const collapsed = element.expandedHeight != null;
   const top = element.y + header + CODE_PADDING;
   const diff =
      !collapsed && codeDiffActive(element)
         ? codeDiffLines(element, palette, isDarkColor(background), language, fontSize, top + baseline, diffEditing)
         : null;
   const lines = collapsed
      ? []
      : (diff?.lines ??
        rows.map((row, i) => ({
           y: top + i * m.lineHeight + baseline,
           number: row.number,
           tokens: codeTokenViews(row.tokens, palette),
        })));
   return {
      ...(diff ? { bands: diff.bands, divider: diff.divider } : {}),
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
      clipId: `code-clip-${element.id}-${clipKey(element)}`,
      numberX: element.x + CODE_PADDING + digits * m.charWidth,
      textX: element.x + m.textOffset,
      numberColor: palette.muted,
      lines,
      collapsed,
      header: {
         height: header,
         text: codeTitle({ fileName: element.fileName, language }),
         x: element.x + element.width / 2,
         y: element.y + header / 2 + 4.5,
         color: palette.plain,
         tint: palette.muted,
         dots: TRAFFIC_LIGHTS.map((d, i) => ({
            x: element.x + CODE_PADDING + 2 + i * TRAFFIC_LIGHT_GAP,
            y: element.y + header / 2,
            r: 5.5,
            color: d.color,
            action: d.action,
         })),
      },
   };
}

/** Typography shared by grid cells (renderer, auto-grow and the cell editor). */
export function gridFont(element: CanvasElementModel): {
   fontSize: number;
   family: string;
   lineHeight: number;
} {
   const fontSize = element.fontSize ?? 14;
   return {
      fontSize,
      family: fontStack(element.fontFamily),
      lineHeight: fontSize * (element.lineHeight ?? LINE_HEIGHT),
   };
}

/**
 * Height each row needs so its tallest cell's wrapped text fits (world px).
 * Used to grow rows while typing; rows never shrink automatically.
 */
export function gridRowNeeds(element: CanvasElementModel, g: GridData, colPx: number[]): number[] {
   const f = gridFont(element);
   const textHeight = (r: number, c: number, width: number): number => {
      const text = g.cells[r][c];
      const st = g.styles?.[cellKey(r, c)] ?? {};
      const bold = st.bold ?? (g.header && r === 0 ? true : !!element.bold);
      const italic = st.italic ?? !!element.italic;
      const css = `${italic ? 'italic ' : ''}${bold ? 700 : 400} ${f.fontSize}px ${f.family}`;
      const max = Math.max(8, width - GRID_CELL_PAD * 2);
      const n = text.split('\n').reduce((acc, para) => acc + wrapParagraph(para, max, css).length, 0);
      return Math.max(1, n) * f.lineHeight + GRID_CELL_PAD * 2;
   };
   const needs = g.cells.map((row, r) => {
      let need = f.lineHeight + GRID_CELL_PAD * 2;
      row.forEach((_, c) => {
         const m = mergeAt(g, r, c);
         if (m && (m.r !== r || m.c !== c || m.rs > 1)) {
            return; // covered cells, and tall merges (handled below)
         }
         const width = m ? colPx.slice(c, c + m.cs).reduce((a, b) => a + b, 0) : (colPx[c] ?? 0);
         need = Math.max(need, textHeight(r, c, width));
      });
      return need;
   });
   // A merge spanning rows: whatever its text needs beyond its other rows goes on its last row.
   for (const m of g.merges ?? []) {
      if (m.rs < 2) continue;
      const width = colPx.slice(m.c, m.c + m.cs).reduce((a, b) => a + b, 0);
      const others = g.rows.slice(m.r, m.r + m.rs - 1).reduce((a, b) => a + b, 0);
      const last = m.r + m.rs - 1;
      needs[last] = Math.max(needs[last], textHeight(m.r, m.c, width) - others);
   }
   return needs;
}

function gridTableView(
   element: CanvasElementModel,
   theme: ThemeColors | undefined,
   stroke: string,
   fill: string
): GridTableView {
   const text = element.text ?? '';
   const g = gridCache.getOrSet(text, () => parseGrid(text));
   const { cols, rows } = gridSizes(g, element.width, element.height);
   const colEdges = edges(cols).map((e) => element.x + e);
   const rowEdges = edges(rows).map((e) => element.y + e);
   const x0 = element.x;
   const y0 = element.y;
   // Inner borders, broken where a merged block spans across them.
   const lines: GridTableView['lines'] = [];
   const inMerge = (r: number, c: number): ReturnType<typeof mergeAt> => mergeAt(g, r, c);
   for (let i = 1; i < colEdges.length - 1; i += 1) {
      let start: number | null = null;
      for (let r = 0; r <= rows.length; r += 1) {
         const m = r < rows.length ? inMerge(r, i - 1) : null;
         const open = r < rows.length && !(m && m.c + m.cs - 1 >= i);
         if (open && start === null) start = r;
         if (!open && start !== null) {
            lines.push({ x1: colEdges[i], y1: rowEdges[start], x2: colEdges[i], y2: rowEdges[r] });
            start = null;
         }
      }
   }
   for (let i = 1; i < rowEdges.length - 1; i += 1) {
      let start: number | null = null;
      for (let c = 0; c <= cols.length; c += 1) {
         const m = c < cols.length ? inMerge(i - 1, c) : null;
         const open = c < cols.length && !(m && m.r + m.rs - 1 >= i);
         if (open && start === null) start = c;
         if (!open && start !== null) {
            lines.push({ x1: colEdges[start], y1: rowEdges[i], x2: colEdges[c], y2: rowEdges[i] });
            start = null;
         }
      }
   }
   const textColor = contrastSafe(element.strokeColor, theme);
   const cells: TextBlockView[] = [];
   const fills: GridTableView['fills'] = [];
   g.cells.forEach((row, r) =>
      row.forEach((text, c) => {
         const m = mergeAt(g, r, c);
         if (m && (m.r !== r || m.c !== c)) {
            return; // covered by a merge: the origin draws for the whole block
         }
         const rEnd = m ? r + m.rs : r + 1;
         const cEnd = m ? c + m.cs : c + 1;
         const st = g.styles?.[cellKey(r, c)] ?? {};
         const box = {
            x: colEdges[c],
            y: rowEdges[r],
            width: colEdges[cEnd] - colEdges[c],
            height: rowEdges[rEnd] - rowEdges[r],
         };
         if (st.fill) {
            fills.push({ ...box, fill: st.fill === SURFACE_FILL ? (theme?.surface ?? '#ffffff') : st.fill });
         }
         if (!text) {
            return;
         }
         const isHeader = g.header && r === 0;
         cells.push(
            layoutTextBlock(text, box, {
               fontSize: element.fontSize ?? 14,
               fontFamilyKey: element.fontFamily,
               fontWeight: (st.bold ?? (isHeader || !!element.bold)) ? 700 : 400,
               italic: st.italic ?? element.italic,
               color: st.color ? contrastSafe(st.color, theme) : textColor,
               align: st.align ?? element.textAlign ?? 'left',
               vAlign: st.vAlign ?? element.verticalAlign ?? 'top',
               padding: GRID_CELL_PAD,
               wrap: true,
               lineHeight: element.lineHeight,
            })
         );
      })
   );
   const mode = g.borders ?? 'all';
   const shownLines =
      mode === 'all' || mode === 'inner' ? lines : mode === 'rows' ? lines.filter((l) => l.y1 === l.y2) : [];
   return {
      rect: { x: x0, y: y0, width: element.width, height: element.height, rx: element.cornerRadius ?? 4 },
      background: fill,
      // The header row is marked by bold text only, no tinted band.
      header: null,
      lines: shownLines,
      outline: mode === 'all' || mode === 'outer' || mode === 'rows',
      cells,
      fills,
      clipId: `grid-clip-${element.id}-${clipKey(element)}`,
      colEdges,
      rowEdges,
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
function resolveEnds(element: CanvasElementModel, targetBox: (binding: ElementBinding) => RotatedBox | null): Point[] {
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
   theme: ThemeColors | undefined
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
function routeBoundConnector(sBox: RotatedBox, tBox: RotatedBox): Point[] {
   const sc: Point = { x: (sBox.x0 + sBox.x1) / 2, y: (sBox.y0 + sBox.y1) / 2 };
   const tc: Point = { x: (tBox.x0 + tBox.x1) / 2, y: (tBox.y0 + tBox.y1) / 2 };
   return [boundaryPoint(sBox, tc, ANCHOR_GAP), boundaryPoint(tBox, sc, ANCHOR_GAP)];
}

interface ViewMemo {
   el: CanvasElementModel;
   key: string;
   view: ShapeView;
   clip?: { key: string; view: ShapeView; base: ShapeView };
}

/**
 * Per-element memo for `buildShapeViews` (one per caller, e.g. the editor canvas). An element
 * whose model and inputs (selection, theme guard, bound-end boxes, font generation) are
 * unchanged keeps its previous view object, so layout work runs only for what changed and
 * `@for` sees the same object.
 */
export class ShapeViewCache {
   readonly entries = new Map<string, ViewMemo>();
}

/** Two values equal by reference, or arrays/plain objects equal one level down. */
function sameField(a: unknown, b: unknown): boolean {
   if (a === b) return true;
   if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((x, i) => x === b[i] || sameShallow(x, b[i]));
   }
   return sameShallow(a, b);
}

function sameShallow(a: unknown, b: unknown): boolean {
   if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) {
      return false;
   }
   const ka = Object.keys(a);
   if (ka.length !== Object.keys(b).length) return false;
   return ka.every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k]);
}

/** Same element content (derived copies such as themed or placeholder elements count as equal). */
function sameElement(a: CanvasElementModel, b: CanvasElementModel): boolean {
   if (a === b) return true;
   const ka = Object.keys(a) as (keyof CanvasElementModel)[];
   if (ka.length !== Object.keys(b).length) return false;
   return ka.every((k) => sameField(a[k], b[k]));
}

const boxKey = (b: RotatedBox | null): string => (b ? `${b.x0},${b.y0},${b.x1},${b.y1},${b.angle ?? 0}` : '-');

/**
 * Build render views for every element, resolving styling, rotation, bound arrow
 * endpoints, text layout, and shape labels. Bound connectors route around other
 * shapes/tables. `tables`/`elements` supply binding targets and obstacles.
 */
export function buildShapeViews(
   elements: readonly CanvasElementModel[],
   tables: readonly TableModel[],
   selectedIds: ReadonlySet<string>,
   canvasTheme?: ThemeColors,
   messageBoxes?: ReadonlyMap<string, Box>,
   /** A diff code block being edited: drawn as two plain halves under its two editors. */
   diffEditingId?: string | null,
   /** Reuse unchanged views from earlier calls; `generation` changes when web fonts load. */
   memo?: { cache: ShapeViewCache; generation: number }
): ShapeView[] {
   const tableById = new Map(tables.map((t) => [t.id, t]));
   const elementById = new Map(elements.map((e) => [e.id, e]));
   // Items on a filled slide are kept readable against the slide, not the canvas
   // (a deck theme's dark text on a light slide must not flip in dark mode).
   const guardFor = (element: CanvasElementModel): ThemeColors | undefined => {
      const frame = element.slideId ? elementById.get(element.slideId) : undefined;
      return canvasTheme &&
         frame &&
         frame.fillStyle !== 'none' &&
         frame.backgroundColor &&
         frame.backgroundColor !== SURFACE_FILL &&
         frame.backgroundColor !== 'transparent'
         ? { ...canvasTheme, canvasBg: frame.backgroundColor }
         : canvasTheme;
   };
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

   const seen = memo ? new Map<string, ViewMemo>() : null;
   const views = elements.map((element) => {
      if (!memo || !seen) return buildView(element);
      const theme = guardFor(element);
      const bound =
         element.type === 'line' || element.type === 'arrow'
            ? `|${element.startBinding ? boxKey(targetBox(element.startBinding)) : ''}|${element.endBinding ? boxKey(targetBox(element.endBinding)) : ''}`
            : '';
      const key = `${memo.generation}|${selectedIds.has(element.id) ? 1 : 0}|${element.id === diffEditingId ? 1 : 0}|${theme?.canvasBg}|${theme?.text}|${theme?.surface}${bound}`;
      const prev = memo.cache.entries.get(element.id);
      const hit = prev && prev.key === key && sameElement(prev.el, element) ? prev : null;
      const entry: ViewMemo = hit ?? { el: element, key, view: buildView(element) };
      seen.set(element.id, entry);
      return entry.view;
   });
   if (memo && seen) {
      memo.cache.entries.clear();
      for (const [id, entry] of seen) memo.cache.entries.set(id, entry);
   }

   function buildView(element: CanvasElementModel): ShapeView {
      const theme = guardFor(element);
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
               rx: rectCornerRadius(element),
            };
            base.label = shapeLabel(element, base.bbox, theme);
            break;
         case 'code':
            base.code = codeBlockView(element, theme, element.id === diffEditingId);
            // The card carries its own fill; the SVG layer draws the border from stroke.
            base.fill = base.code.background;
            break;
         case 'grid':
            base.grid = gridTableView(element, theme, stroke, fill);
            break;
         case 'image':
            if (element.fileId) {
               base.image = imageView(element, element.fileId);
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
                  }
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
            // Non-finite points are gaps a live eraser drag has cut; draw each piece apart.
            base.path = splitAtGaps(absolutePoints(element))
               .map((run) => freehandFillPath(run, element.strokeWidth))
               .join(' ');
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
            const curvature = ends.length >= 2 && !element.elbow ? (element.curvature ?? 0) : 0;
            let labelAt: Point | undefined;
            if (element.elbow && ends.length >= 2) {
               // Right-angle route: out along the longer axis, across at the midpoint, then in.
               const s = ends[0];
               const t = ends[ends.length - 1];
               const across = Math.abs(t.x - s.x) >= Math.abs(t.y - s.y);
               const mx = (s.x + t.x) / 2;
               const my = (s.y + t.y) / 2;
               base.path = across ? `M${s.x} ${s.y} H${mx} V${t.y} H${t.x}` : `M${s.x} ${s.y} V${my} H${t.x} V${t.y}`;
               base.bend = { x: mx, y: my };
               labelAt = { x: mx, y: my };
            } else if (Math.abs(curvature) > 0.5) {
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
            const legacyWrapped = element.wrap ?? element.height > explicitLines * lineH + 4 + lineH * 0.5;
            // Lay out in the stored layout box (where the editor draws it), not the
            // glyph-trimmed `elementBox`, or the glyphs shift down by the top inset.
            const layoutBox = { x: element.x, y: element.y, width: element.width, height: element.height };
            base.text = layoutTextBlock(element.text ?? '', layoutBox, {
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
            const contentH = base.text.lines.length * tFontSize * (element.lineHeight ?? LINE_HEIGHT) + 4;
            // The outline hugs the glyphs (the layout box keeps its line-height padding).
            const ink = textInkInsets(element);
            const bottom = legacyWrapped ? contentH : element.height - ink.bottom;
            base.bbox = {
               x: element.x + ink.left,
               y: element.y + ink.top,
               width: Math.max(1, element.width - ink.left - ink.right),
               height: Math.max(1, bottom - ink.top),
            };
            break;
         }
      }
      return base;
   }
   // Frames are page backdrops: draw them beneath everything else (stable sort).
   // Frames set to clip their content: shapes whose centre lies inside the (smallest)
   // such frame are cut to its box. Slides keep their own clipping.
   const clipFrames = elements
      .filter((e) => e.type === 'frame' && e.clipContent && !e.slide)
      .sort((a, b) => a.width * a.height - b.width * b.height);
   // Views can be shared through the memo, so a clipped one is a copy (itself memoized).
   const out = clipFrames.length
      ? views.map((v) => {
           const el = elementById.get(v.id);
           if (!el || el.type === 'frame' || el.slideId) return v;
           const c = elementCenter(el);
           const f = clipFrames.find(
              (fr) => c.x >= fr.x && c.x <= fr.x + fr.width && c.y >= fr.y && c.y <= fr.y + fr.height
           );
           if (!f) return v;
           const frameClip = { x: f.x, y: f.y, width: f.width, height: f.height };
           const entry = seen?.get(v.id);
           const key = `${f.x},${f.y},${f.width},${f.height}`;
           if (entry?.clip && entry.clip.key === key && entry.clip.base === v) return entry.clip.view;
           const clipped = { ...v, frameClip };
           if (entry) entry.clip = { key, view: clipped, base: v };
           return clipped;
        })
      : views;
   return out.sort((a, b) => Number(b.type === 'frame') - Number(a.type === 'frame'));
}

/**
 * Part of a clip path's id that changes with the box it clips to. Chrome does not always
 * repaint the area a clipped group used to cover when only the clip rect moves, leaving
 * a faded copy behind mid-drag; a fresh clipPath per box forces a clean repaint.
 */
function clipKey(el: { x: number; y: number; width: number; height: number }): string {
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
