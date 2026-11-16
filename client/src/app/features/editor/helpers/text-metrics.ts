import { resolveThemeFont, type CanvasElementModel, type TextRun } from '@devdesigner/shared';
import { runLines, runWeight, usableRuns } from './rich-text.helper';
import { fontStack, fontWeightFor } from './render/fonts';
import { clearShapeRenderCaches } from './render/text-layout';

/** Default line height multiple, and the options offered in the UI. */
export const DEFAULT_LINE_HEIGHT = 1.25;
export const LINE_HEIGHTS: readonly number[] = [1, 1.25, 1.5, 1.75, 2];

/** Default size of a freshly created text element. */
export const TEXT_DEFAULT_FONT_SIZE = 20;
/** Bounds for a text element's font size when it is scaled by dragging its handles. */
export const TEXT_MIN_FONT_SIZE = 6;
export const TEXT_MAX_FONT_SIZE = 600;

/** Hidden element used to measure text in the real web font (1x, outside any zoom). */
let measureEl: HTMLDivElement | null | undefined;

function ensureMeasureEl(): HTMLDivElement | null {
   if (measureEl !== undefined) {
      return measureEl;
   }
   if (typeof document === 'undefined') {
      measureEl = null;
      return null;
   }
   const el = document.createElement('div');
   Object.assign(el.style, {
      position: 'absolute',
      left: '-9999px',
      top: '-9999px',
      visibility: 'hidden',
      pointerEvents: 'none',
      whiteSpace: 'pre',
      lineHeight: String(DEFAULT_LINE_HEIGHT),
      padding: '0',
      margin: '0',
      border: '0',
      boxSizing: 'content-box',
   } as Partial<CSSStyleDeclaration>);
   el.setAttribute('aria-hidden', 'true');
   document.body.appendChild(el);
   measureEl = el;
   return el;
}

/**
 * Natural (never wrapped) size of a block of text, measured in the ACTUAL
 * rendered web font — canvas `measureText` falls back to a narrower face for
 * script fonts and under-measures. Styled `runs` are measured as the same span
 * structure the editor and renderer produce (bold changes glyph widths).
 * Includes the 2px layout padding on each side so glyphs never touch the edge.
 */
export function measureTextBox(
   text: string,
   fontSize: number,
   fontFamilyKey: string | undefined,
   fontWeight = 400,
   italic = false,
   lineHeight = DEFAULT_LINE_HEIGHT,
   runs: readonly TextRun[] | null = null,
   /** Outer box width to wrap to (fixed-width text); omitted = natural, unwrapped. */
   wrapWidth?: number
): { width: number; height: number } {
   const el = ensureMeasureEl();
   if (!el) {
      const lines = text.split('\n');
      const width = Math.max(1, ...lines.map((l) => l.length)) * fontSize * 0.6;
      return {
         width: Math.ceil(width) + 6,
         height: Math.ceil(lines.length * fontSize * lineHeight) + 4,
      };
   }
   el.style.fontFamily = fontStack(fontFamilyKey);
   el.style.fontSize = `${fontSize}px`;
   el.style.fontWeight = String(fontWeight);
   el.style.fontStyle = italic ? 'italic' : 'normal';
   el.style.lineHeight = String(lineHeight);
   if (wrapWidth !== undefined) {
      el.style.whiteSpace = 'pre-wrap';
      el.style.wordBreak = 'break-word';
      el.style.width = `${Math.max(8, wrapWidth - 4)}px`;
   } else {
      el.style.whiteSpace = 'pre';
      el.style.wordBreak = 'normal';
      el.style.width = 'auto';
   }
   el.textContent = '';
   if (runs?.length && text.length) {
      for (const run of runs) {
         const span = document.createElement('span');
         span.style.fontWeight = String(runWeight(fontWeight, run));
         if (run.italic !== undefined) {
            span.style.fontStyle = run.italic ? 'italic' : 'normal';
         }
         span.textContent = run.text;
         el.appendChild(span);
      }
   } else {
      el.textContent = text.length ? text : ' ';
   }
   const rect = el.getBoundingClientRect();
   return {
      // Fixed-width text keeps the box width it was given.
      width: wrapWidth !== undefined ? wrapWidth : Math.max(8, Math.ceil(rect.width) + 6),
      height: Math.ceil(rect.height) + 4,
   };
}

/** The box a text element takes for its content at its current typography. */
/** Resolves a theme font token (`$heading`) for an element; the project store registers the deck-aware one. */
let themeFont: (el: { id?: string; slideId?: string; fontFamily?: string }) => string | undefined = (el) =>
   resolveThemeFont(el.fontFamily);

export function setThemeFontResolver(fn: typeof themeFont): void {
   themeFont = fn;
}

export function fitTextElement(
   el: Pick<
      CanvasElementModel,
      'fontSize' | 'fontFamily' | 'bold' | 'italic' | 'strokeWidth' | 'text' | 'lineHeight' | 'runs' | 'wrap' | 'width'
   >,
   overrides: {
      text?: string;
      fontSize?: number;
      runs?: readonly TextRun[] | null;
      width?: number;
   } = {}
): { width: number; height: number } {
   const text = overrides.text ?? el.text ?? '';
   const runs = 'runs' in overrides ? overrides.runs : el.runs;
   return measureTextBox(
      text,
      overrides.fontSize ?? el.fontSize ?? TEXT_DEFAULT_FONT_SIZE,
      themeFont(el),
      el.bold ? 800 : fontWeightFor(el.strokeWidth),
      !!el.italic,
      el.lineHeight ?? DEFAULT_LINE_HEIGHT,
      usableRuns(text, runs),
      el.wrap ? Math.max(16, overrides.width ?? el.width) : undefined
   );
}

/** Make sure a font family (regular, bold, italic) is downloaded before measuring with it. */
export async function ensureFontLoaded(
   fontFamilyKey: string | undefined,
   fontSize = TEXT_DEFAULT_FONT_SIZE
): Promise<void> {
   if (typeof document === 'undefined' || !document.fonts) {
      return;
   }
   const stack = fontStack(fontFamilyKey);
   try {
      await Promise.all([
         document.fonts.load(`400 ${fontSize}px ${stack}`),
         document.fonts.load(`700 ${fontSize}px ${stack}`),
         document.fonts.load(`italic 400 ${fontSize}px ${stack}`),
      ]);
   } catch {
      /* measuring with the fallback face is still better than failing */
   }
}

/** Style keys that change a text element's natural size. */
const LAYOUT_KEYS = [
   'fontSize',
   'fontFamily',
   'bold',
   'italic',
   'strokeWidth',
   'text',
   'lineHeight',
   'runs',
   'wrap',
] as const;

/**
 * For a style/content patch aimed at a text element, the patch extended with the
 * refit width/height (top-left stays put), so text boxes always hug their glyphs
 * instead of keeping a stale width after a font or size change.
 */
export function withTextFit<T extends object>(el: CanvasElementModel, patch: T): T {
   if (el.type !== 'text' || !LAYOUT_KEYS.some((k) => k in patch)) {
      return patch;
   }
   const next = { ...el, ...patch } as CanvasElementModel;
   const size = fitTextElement(next);
   return { ...patch, width: size.width, height: size.height };
}

/** Insets from a text element's layout box (x/y/width/height) in to its glyph ink. */
export interface TextInk {
   top: number;
   right: number;
   bottom: number;
   left: number;
}

const NO_INK: TextInk = { top: 0, right: 0, bottom: 0, left: 0 };
const inkCache = new Map<string, TextInk>();
let inkCtx: CanvasRenderingContext2D | null | undefined;

/**
 * Drop measurements taken before a web font arrived (they used the fallback face).
 * `FontMetricsService` calls this on `document.fonts` `loadingdone`.
 */
export function clearTextMetricsCaches(): void {
   inkCache.clear();
   clearShapeRenderCaches();
}

/**
 * How far a text element's glyphs sit inside its layout box, measured with the
 * font's real metrics, so the selection outline, snapping and spacing hug the
 * characters while the stored position (and the editor) stay where they were.
 * The layout mirrors `layoutTextBlock`: 2px padding, lines of `fontSize *
 * lineHeight`, each baseline at half-leading + ascent.
 */
export function textInkInsets(el: CanvasElementModel): TextInk {
   const text = el.text ?? '';
   if (!text.trim()) {
      return NO_INK;
   }
   if (inkCtx === undefined) {
      inkCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
   }
   const ctx = inkCtx;
   if (!ctx) {
      return NO_INK;
   }
   const fontSize = el.fontSize ?? TEXT_DEFAULT_FONT_SIZE;
   const weight = el.bold ? 800 : fontWeightFor(el.strokeWidth);
   const italic = !!el.italic;
   const lh = el.lineHeight ?? DEFAULT_LINE_HEIGHT;
   const stack = fontStack(themeFont(el));
   const runs = usableRuns(text, el.runs);
   const key = JSON.stringify([text, runs, fontSize, weight, italic, lh, stack, el.textAlign, el.wrap, el.width]);
   const hit = inkCache.get(key);
   if (hit) {
      return hit;
   }
   const fontOf = (w: number, it: boolean) => `${it ? 'italic ' : ''}${w} ${fontSize}px ${stack}`;
   // Each line as styled segments (plain text is one segment in the base font).
   const lines: { text: string; font: string }[][] = runs
      ? runLines(runs).map((line) =>
           line.map((r) => ({ text: r.text, font: fontOf(runWeight(weight, r), r.italic ?? italic) }))
        )
      : text.split('\n').map((t) => [{ text: t, font: fontOf(weight, italic) }]);

   ctx.font = fontOf(weight, italic);
   const fm = ctx.measureText('Hg');
   const L = fontSize * lh;
   const asc = Number.isFinite(fm.fontBoundingBoxAscent) ? fm.fontBoundingBoxAscent : fontSize * 0.8;
   const desc = Number.isFinite(fm.fontBoundingBoxDescent) ? fm.fontBoundingBoxDescent : fontSize * 0.2;
   const half = (L - (asc + desc)) / 2;

   const PAD = 2;
   const align = el.textAlign ?? 'left';
   let inkL = Infinity;
   let inkR = -Infinity;
   const vert: { a: number; d: number }[] = [];
   for (const segs of lines) {
      let x = 0;
      let l = Infinity;
      let r = -Infinity;
      let a = -Infinity;
      let d = -Infinity;
      for (const s of segs) {
         if (!s.text) continue;
         ctx.font = s.font;
         const m = ctx.measureText(s.text);
         if (s.text.trim()) {
            l = Math.min(l, x - m.actualBoundingBoxLeft);
            r = Math.max(r, x + m.actualBoundingBoxRight);
            a = Math.max(a, m.actualBoundingBoxAscent);
            d = Math.max(d, m.actualBoundingBoxDescent);
         }
         x += m.width;
      }
      vert.push({ a, d });
      if (l === Infinity) continue;
      const start = align === 'center' ? el.width / 2 - x / 2 : align === 'right' ? el.width - PAD - x : PAD;
      inkL = Math.min(inkL, start + l);
      inkR = Math.max(inkR, start + r);
   }
   const first = vert.findIndex((v) => v.a > -Infinity);
   let last = -1;
   for (let i = vert.length - 1; i >= 0; i--) {
      if (vert[i].a > -Infinity) {
         last = i;
         break;
      }
   }
   if (first < 0) {
      return NO_INK;
   }
   const baseline = PAD + half + asc;
   const top = baseline + first * L - vert[first].a;
   const bottomInk = baseline + last * L + vert[last].d;
   // Unwrapped text is drawn as exactly its lines; wrapped (or legacy-wrapped)
   // text keeps its stored height, and its breaks aren't known here, so only
   // the top/bottom are trimmed.
   const natural = lines.length * L + PAD * 2;
   const wrapped = !!el.wrap || el.height > natural + L * 0.5;
   const horiz = !wrapped && inkL < Infinity;
   const ink: TextInk = {
      top: Math.max(0, top),
      // Relative to the STORED height (it may lag the drawn lines until refit).
      bottom: wrapped ? 0 : el.height - bottomInk,
      left: horiz ? inkL : 0,
      right: horiz ? el.width - inkR : 0,
   };
   if (inkCache.size > 2000) inkCache.clear();
   inkCache.set(key, ink);
   return ink;
}
