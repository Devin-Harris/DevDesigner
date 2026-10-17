// Standard layout kinds: a fixed list the app owns, so a deck built with one theme's
// layouts can move to another theme that provides the same kinds (a slide keeps its
// kind; placeholder copies re-pair by role). The specs here build each kind from theme
// tokens and placeholder roles only, so they restyle with whatever theme is active.

import type { TextAlign } from '../enums';
import type { PlaceholderRole } from '../models';
import type { CreateElementDto } from '../dto';

export const LAYOUT_KINDS = [
  'blank',
  'title',
  'section',
  'content',
  'two-column',
  'three-column',
  'comparison',
  'statement',
  'quote',
] as const;
export type LayoutKind = (typeof LAYOUT_KINDS)[number];

export const LAYOUT_KIND_LABELS: Record<LayoutKind, string> = {
  blank: 'Blank',
  title: 'Title',
  section: 'Section header',
  content: 'Title and content',
  'two-column': 'Two columns',
  'three-column': 'Three columns',
  comparison: 'Comparison',
  statement: 'Statement',
  quote: 'Quote',
};

/** One item of a standard layout. Geometry is in fractions of the slide; sizes in px at a 720 px tall slide. */
export type LayoutSpecItem =
  | {
      kind: 'text';
      role: PlaceholderRole;
      prompt: string;
      x: number;
      y: number;
      w: number;
      size: number;
      font: 'heading' | 'body';
      color: string;
      bold?: boolean;
      italic?: boolean;
      align?: TextAlign;
    }
  | { kind: 'bar'; x: number; y: number; w: number; h: number; color: string }
  /**
   * Any element captured from a deck's own layout ("Save as theme"). Geometry is in
   * fractions of the slide (`h` too); `el` holds the rest of the element, with font
   * sizes and point offsets as at a 720 px tall slide.
   */
  | { kind: 'element'; x: number; y: number; w: number; h: number; el: LayoutElementProps };

/** An element's own properties, without its place, owner or identity. */
export type LayoutElementProps = Omit<
  CreateElementDto,
  'id' | 'x' | 'y' | 'width' | 'height' | 'slideId' | 'slide' | 'zIndex' | 'fileId' | 'startBinding' | 'endBinding'
>;

export interface LayoutSpec {
  kind: LayoutKind;
  items: LayoutSpecItem[];
}

const M = 0.0625; // side margin (80 px at 1280 wide)
const W = 1 - 2 * M;

const title = (y = 0.08): LayoutSpecItem => ({
  kind: 'text',
  role: 'title',
  prompt: 'Click to add title',
  x: M,
  y,
  w: W,
  size: 40,
  font: 'heading',
  color: '$heading',
  bold: true,
});
const body = (x: number, w: number, y = 0.26): LayoutSpecItem => ({
  kind: 'text',
  role: 'body',
  prompt: 'Click to add text',
  x,
  y,
  w,
  size: 22,
  font: 'body',
  color: '$text',
});
const columns = (n: number, y = 0.26): LayoutSpecItem[] => {
  const gap = 0.04;
  const cw = (W - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => body(M + i * (cw + gap), cw, y));
};

export const STANDARD_LAYOUT_SPECS: readonly LayoutSpec[] = [
  {
    kind: 'title',
    items: [
      { ...(title(0.36) as Extract<LayoutSpecItem, { kind: 'text' }>), size: 60, align: 'center' },
      { kind: 'bar', x: 0.46, y: 0.53, w: 0.08, h: 6, color: '$accent1' },
      {
        kind: 'text',
        role: 'subtitle',
        prompt: 'Click to add subtitle',
        x: M,
        y: 0.58,
        w: W,
        size: 26,
        font: 'body',
        color: '$muted',
        align: 'center',
      },
    ],
  },
  {
    kind: 'section',
    items: [
      { kind: 'bar', x: M, y: 0.36, w: 0.06, h: 8, color: '$accent1' },
      { ...(title(0.4) as Extract<LayoutSpecItem, { kind: 'text' }>), size: 54 },
      {
        kind: 'text',
        role: 'subtitle',
        prompt: 'Click to add subtitle',
        x: M,
        y: 0.58,
        w: W,
        size: 24,
        font: 'body',
        color: '$muted',
      },
    ],
  },
  { kind: 'content', items: [title(), body(M, W)] },
  { kind: 'two-column', items: [title(), ...columns(2)] },
  { kind: 'three-column', items: [title(), ...columns(3)] },
  {
    kind: 'comparison',
    items: [
      title(),
      ...columns(2, 0.24).map((c) => ({
        ...(c as Extract<LayoutSpecItem, { kind: 'text' }>),
        role: 'subtitle' as const,
        prompt: 'Click to add heading',
        size: 26,
        font: 'heading' as const,
        color: '$accent1',
        bold: true,
      })),
      ...columns(2, 0.36),
    ],
  },
  {
    kind: 'statement',
    items: [
      {
        kind: 'text',
        role: 'emphasis',
        prompt: 'Click to add a statement',
        x: 0.1,
        y: 0.38,
        w: 0.8,
        size: 52,
        font: 'heading',
        color: '$heading',
        bold: true,
        align: 'center',
      },
    ],
  },
  {
    kind: 'quote',
    items: [
      { kind: 'bar', x: 0.1, y: 0.3, w: 0.006, h: 160, color: '$accent1' },
      {
        kind: 'text',
        role: 'emphasis',
        prompt: 'Click to add a quote',
        x: 0.13,
        y: 0.3,
        w: 0.77,
        size: 40,
        font: 'heading',
        color: '$heading',
        italic: true,
      },
      {
        kind: 'text',
        role: 'caption',
        prompt: 'Attribution',
        x: 0.13,
        y: 0.62,
        w: 0.77,
        size: 22,
        font: 'body',
        color: '$muted',
      },
    ],
  },
];

export function layoutSpec(kind: LayoutKind): LayoutSpec | undefined {
  return STANDARD_LAYOUT_SPECS.find((s) => s.kind === kind);
}

// ---- Built-in layout variants ----
// Every variant designs every standard kind with the same placeholder roles, so a deck
// moves between built-in designs with each slide keeping its kind and content.

type TextItem = Extract<LayoutSpecItem, { kind: 'text' }>;
export type LayoutVariant = Record<Exclude<LayoutKind, 'blank'>, LayoutSpecItem[]>;

const txt = (
  role: PlaceholderRole,
  prompt: string,
  x: number,
  y: number,
  w: number,
  size: number,
  font: 'heading' | 'body',
  color: string,
  extra: Partial<TextItem> = {},
): TextItem => ({ kind: 'text', role, prompt, x, y, w, size, font, color, ...extra });
const bar = (x: number, y: number, w: number, h: number, color: string): LayoutSpecItem => ({
  kind: 'bar',
  x,
  y,
  w,
  h,
  color,
});
const cols = (n: number, x: number, w: number, make: (cx: number, cw: number) => TextItem): TextItem[] => {
  const gap = 0.04;
  const cw = (w - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => make(x + i * (cw + gap), cw));
};

/** Sidebar: an accent rail down the left edge (on the master), left-aligned titles. */
const SL = 0.1;
const SW = 1 - SL - M;
export const SIDEBAR_MASTER: LayoutSpecItem[] = [bar(0, 0, 0.014, 720, '$accent1')];
export const SIDEBAR_LAYOUTS: LayoutVariant = (() => {
  const head = (): TextItem => txt('title', 'Click to add title', SL, 0.09, SW, 40, 'heading', '$heading', { bold: true });
  const under = (): LayoutSpecItem => bar(SL, 0.2, 0.05, 4, '$accent1');
  const bodyAt = (x: number, w: number, y = 0.27): TextItem => txt('body', 'Click to add text', x, y, w, 22, 'body', '$text');
  return {
    title: [
      txt('title', 'Click to add title', SL, 0.34, SW, 64, 'heading', '$heading', { bold: true }),
      txt('subtitle', 'Click to add subtitle', SL, 0.56, SW, 26, 'body', '$muted'),
    ],
    section: [
      txt('subtitle', 'Click to add subtitle', SL, 0.32, SW, 22, 'body', '$accent1', { bold: true }),
      txt('title', 'Click to add title', SL, 0.4, SW, 56, 'heading', '$heading', { bold: true }),
    ],
    content: [head(), under(), bodyAt(SL, SW)],
    'two-column': [head(), under(), ...cols(2, SL, SW, (x, w) => bodyAt(x, w))],
    'three-column': [head(), under(), ...cols(3, SL, SW, (x, w) => bodyAt(x, w))],
    comparison: [
      head(),
      under(),
      ...cols(2, SL, SW, (x, w) =>
        txt('subtitle', 'Click to add heading', x, 0.26, w, 26, 'heading', '$accent1', { bold: true }),
      ),
      ...cols(2, SL, SW, (x, w) => bodyAt(x, w, 0.37)),
    ],
    statement: [txt('emphasis', 'Click to add a statement', SL, 0.38, SW - 0.1, 52, 'heading', '$heading', { bold: true })],
    quote: [
      txt('emphasis', 'Click to add a quote', SL, 0.3, SW - 0.1, 40, 'heading', '$heading', { italic: true }),
      txt('caption', 'Attribution', SL, 0.62, SW, 22, 'body', '$accent1'),
    ],
  };
})();

/** Centered: everything centered, with a short accent rule under each title. */
export const CENTERED_LAYOUTS: LayoutVariant = (() => {
  const c = { align: 'center' as const };
  const head = (): TextItem => txt('title', 'Click to add title', M, 0.08, W, 40, 'heading', '$heading', { bold: true, ...c });
  const rule = (y = 0.19): LayoutSpecItem => bar(0.47, y, 0.06, 4, '$accent1');
  const bodyAt = (x: number, w: number, y = 0.27): TextItem => txt('body', 'Click to add text', x, y, w, 22, 'body', '$text', c);
  return {
    title: [
      rule(0.3),
      txt('title', 'Click to add title', M, 0.36, W, 60, 'heading', '$heading', { bold: true, ...c }),
      txt('subtitle', 'Click to add subtitle', M, 0.56, W, 26, 'body', '$muted', c),
    ],
    section: [
      txt('title', 'Click to add title', M, 0.38, W, 54, 'heading', '$heading', { bold: true, ...c }),
      rule(0.55),
      txt('subtitle', 'Click to add subtitle', M, 0.6, W, 24, 'body', '$muted', c),
    ],
    content: [head(), rule(), bodyAt(0.15, 0.7)],
    'two-column': [head(), rule(), ...cols(2, M, W, (x, w) => bodyAt(x, w))],
    'three-column': [head(), rule(), ...cols(3, M, W, (x, w) => bodyAt(x, w))],
    comparison: [
      head(),
      rule(),
      ...cols(2, M, W, (x, w) =>
        txt('subtitle', 'Click to add heading', x, 0.26, w, 26, 'heading', '$accent1', { bold: true, ...c }),
      ),
      ...cols(2, M, W, (x, w) => bodyAt(x, w, 0.37)),
    ],
    statement: [
      txt('emphasis', 'Click to add a statement', 0.1, 0.36, 0.8, 52, 'heading', '$heading', { bold: true, ...c }),
      rule(0.62),
    ],
    quote: [
      txt('emphasis', 'Click to add a quote', 0.12, 0.3, 0.76, 40, 'heading', '$heading', { italic: true, ...c }),
      rule(0.58),
      txt('caption', 'Attribution', 0.12, 0.62, 0.76, 22, 'body', '$muted', c),
    ],
  };
})();

/** Banner: titles sit in a surface-colored band across the top. */
export const BANNER_LAYOUTS: LayoutVariant = (() => {
  const band = (): LayoutSpecItem[] => [bar(0, 0, 1, 150, '$surface'), bar(0, 0.208, 1, 4, '$accent1')];
  const head = (): TextItem => txt('title', 'Click to add title', M, 0.06, W, 40, 'heading', '$heading', { bold: true });
  const bodyAt = (x: number, w: number, y = 0.29): TextItem => txt('body', 'Click to add text', x, y, w, 22, 'body', '$text');
  return {
    title: [
      bar(0, 0.28, 1, 300, '$surface'),
      bar(0, 0.7, 1, 6, '$accent1'),
      txt('title', 'Click to add title', M, 0.35, W, 60, 'heading', '$heading', { bold: true }),
      txt('subtitle', 'Click to add subtitle', M, 0.55, W, 26, 'body', '$muted'),
    ],
    section: [
      bar(0, 0, 0.36, 720, '$surface'),
      bar(0.36, 0, 0.006, 720, '$accent1'),
      txt('title', 'Click to add title', 0.42, 0.38, 0.52, 52, 'heading', '$heading', { bold: true }),
      txt('subtitle', 'Click to add subtitle', 0.42, 0.58, 0.52, 24, 'body', '$muted'),
    ],
    content: [...band(), head(), bodyAt(M, W)],
    'two-column': [...band(), head(), ...cols(2, M, W, (x, w) => bodyAt(x, w))],
    'three-column': [...band(), head(), ...cols(3, M, W, (x, w) => bodyAt(x, w))],
    comparison: [
      ...band(),
      head(),
      ...cols(2, M, W, (x, w) =>
        txt('subtitle', 'Click to add heading', x, 0.28, w, 26, 'heading', '$accent1', { bold: true }),
      ),
      ...cols(2, M, W, (x, w) => bodyAt(x, w, 0.39)),
    ],
    statement: [
      bar(0, 0.3, 1, 290, '$surface'),
      txt('emphasis', 'Click to add a statement', 0.1, 0.4, 0.8, 50, 'heading', '$heading', { bold: true, align: 'center' }),
    ],
    quote: [
      bar(0, 0, 1, 720, '$surface'),
      txt('emphasis', 'Click to add a quote', 0.12, 0.3, 0.76, 40, 'heading', '$heading', { italic: true }),
      bar(0.12, 0.6, 0.06, 4, '$accent1'),
      txt('caption', 'Attribution', 0.12, 0.64, 0.76, 22, 'body', '$muted'),
    ],
  };
})();
