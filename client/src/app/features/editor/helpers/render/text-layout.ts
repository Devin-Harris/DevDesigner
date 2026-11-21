import type { TextAlign, TextRun, VerticalAlign } from '@devdesigner/shared';
import type { TextBlockView, TextLineView } from '../../models/shape-view.model';
import { runLines, runWeight } from '../rich-text.helper';
import { LruCache } from '../../../../shared/helpers/lru';
import { fontStack } from './fonts';

export const DEFAULT_FONT_SIZE = 20;
export const LINE_HEIGHT = 1.25;

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

/**
 * Drop text measurements (taken with a fallback face before a web font loaded). Called by
 * `clearTextMetricsCaches` when fonts finish loading.
 */
export function clearShapeRenderCaches(): void {
   widthCache.clear();
}

export function measureWidth(text: string, cssFont: string): number {
   if (!measureCtx || text === '') {
      return text.length * 8;
   }
   return widthCache.getOrSet(cssFont + '\u0001' + text, () => {
      measureCtx.font = cssFont;
      return measureCtx.measureText(text).width;
   });
}

/** Greedily wrap a paragraph to a maximum width (word wrap, hard-breaks long words). */
export function wrapParagraph(para: string, maxWidth: number, cssFont: string, breakWords = false): string[] {
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
): { runs: TextRun[]; indent: number; para: number }[] {
   const out: { runs: TextRun[]; indent: number; para: number }[] = [];
   for (const [paraIndex, para] of paragraphs.entries()) {
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
         out.push({ runs: line.filter((r) => r.text), indent, para: paraIndex });
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
      out.push({ runs: line, indent, para: paraIndex });
   }
   return out;
}

/**
 * Lay out a text block inside a box with wrapping and horizontal/vertical
 * alignment. `wrap` false keeps explicit lines only (auto-size text); true wraps
 * to the box width (a resized text box or a shape label).
 */
export function layoutTextBlock(
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
         : runLines(opts.runs).map((runs, para) => ({ runs, indent: 0, para }))
      : null;
   const rich = wrapped?.map((l) => l.runs) ?? null;
   const lines: string[] = [];
   const indents: number[] = [];
   /** The source paragraph (line of `text`) each laid-out line comes from. */
   const paras: number[] = [];
   if (wrapped) {
      for (const line of wrapped) {
         lines.push(line.runs.map((r) => r.text).join(''));
         indents.push(line.indent);
         paras.push(line.para);
      }
   } else {
      for (const [paraIndex, para] of text.split('\n').entries()) {
         const before = lines.length;
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
         for (let i = before; i < lines.length; i += 1) {
            paras.push(paraIndex);
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
      const view: TextLineView = { text: t, x: lx, y: top + i * lineHeight + baseline, para: paras[i] };
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
