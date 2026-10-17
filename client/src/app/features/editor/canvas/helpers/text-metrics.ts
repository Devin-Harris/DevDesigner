import { resolveThemeFont, type CanvasElementModel, type TextRun } from '@dbdesigner/shared';
import { runWeight, usableRuns } from './rich-text.helper';
import { fontStack, fontWeightFor } from './shape-render.helper';

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
  wrapWidth?: number,
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
    | 'fontSize'
    | 'fontFamily'
    | 'bold'
    | 'italic'
    | 'strokeWidth'
    | 'text'
    | 'lineHeight'
    | 'runs'
    | 'wrap'
    | 'width'
  >,
  overrides: {
    text?: string;
    fontSize?: number;
    runs?: readonly TextRun[] | null;
    width?: number;
  } = {},
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
    el.wrap ? Math.max(16, overrides.width ?? el.width) : undefined,
  );
}

/** Make sure a font family (regular, bold, italic) is downloaded before measuring with it. */
export async function ensureFontLoaded(
  fontFamilyKey: string | undefined,
  fontSize = TEXT_DEFAULT_FONT_SIZE,
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
