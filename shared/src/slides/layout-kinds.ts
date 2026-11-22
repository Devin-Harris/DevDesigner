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

// ---- Decorations: shapes that are part of a layout's look (never placeholders) ----
/** A filled shape in fractions of the slide (`h` too), tinted with a theme color. */
const deco = (
  type: 'rectangle' | 'ellipse',
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  opts: { opacity?: number; radius?: number; angle?: number } = {},
): LayoutSpecItem => ({
  kind: 'element',
  x,
  y,
  w,
  h,
  el: {
    type,
    strokeColor: color,
    backgroundColor: color,
    fillStyle: 'solid',
    strokeWidth: 0,
    strokeStyle: 'solid',
    opacity: opts.opacity ?? 100,
    angle: opts.angle ?? 0,
    cornerRadius: opts.radius ?? 0,
  } as LayoutElementProps,
});
/** An unfilled outline rectangle (fractions of the slide), e.g. an inset frame. */
const outline = (x: number, y: number, w: number, h: number, color: string, width = 2, opacity = 100): LayoutSpecItem => ({
  kind: 'element',
  x,
  y,
  w,
  h,
  el: {
    type: 'rectangle',
    strokeColor: color,
    backgroundColor: 'transparent',
    fillStyle: 'none',
    strokeWidth: width,
    strokeStyle: 'solid',
    opacity,
    angle: 0,
    cornerRadius: 0,
  } as LayoutElementProps,
});
/** A large faint opening quote mark. */
const quoteMark = (x: number, y: number, align: 'left' | 'center' = 'left'): LayoutSpecItem => ({
  kind: 'element',
  x,
  y,
  w: align === 'center' ? 0.12 : 0.08,
  h: 0.22,
  el: {
    type: 'text',
    text: '“',
    fontSize: 150,
    fontFamily: '$heading',
    strokeColor: '$accent1',
    backgroundColor: 'transparent',
    fillStyle: 'none',
    strokeWidth: 1,
    strokeStyle: 'solid',
    opacity: 30,
    angle: 0,
    cornerRadius: 0,
    bold: true,
    textAlign: align,
  } as LayoutElementProps,
});
/** Column accents: a short bar in a different accent above each column. */
const ACCENTS = ['$accent1', '$accent2', '$accent3', '$accent4'];

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
      { ...(title(0.3) as Extract<LayoutSpecItem, { kind: 'text' }>), size: 66, w: W * 0.8 },
      // A single accent line under the title (like the section header's), no blocks.
      { kind: 'bar', x: M, y: 0.47, w: 0.12, h: 5, color: '$accent1' },
      {
        kind: 'text',
        role: 'subtitle',
        prompt: 'Click to add subtitle',
        x: M,
        y: 0.52,
        w: W * 0.7,
        size: 26,
        font: 'body',
        color: '$muted',
      },
    ],
  },
  {
    kind: 'section',
    items: [
      { kind: 'bar' as const, x: M, y: 0.35, w: 0.09, h: 8, color: '$accent1' },
      { ...(title(0.4) as Extract<LayoutSpecItem, { kind: 'text' }>), size: 54 },
      {
        kind: 'text',
        role: 'subtitle',
        prompt: 'Click to add subtitle',
        x: M,
        y: 0.58,
        w: W * 0.7,
        size: 24,
        font: 'body',
        color: '$muted',
      },
    ],
  },
  { kind: 'content', items: [title(), { kind: 'bar' as const, x: M, y: 0.19, w: 0.06, h: 5, color: '$accent1' }, body(M, W, 0.27)] },
  {
    kind: 'two-column',
    items: [
      title(),
      { kind: 'bar' as const, x: M, y: 0.19, w: 0.06, h: 5, color: '$accent1' },
      ...columns(2, 0.31).flatMap((c, i) => [{ kind: 'bar' as const, x: c.x, y: 0.27, w: 0.035, h: 4, color: ACCENTS[i] }, c]),
    ],
  },
  {
    kind: 'three-column',
    items: [
      title(),
      { kind: 'bar' as const, x: M, y: 0.19, w: 0.06, h: 5, color: '$accent1' },
      ...columns(3, 0.31).flatMap((c, i) => [{ kind: 'bar' as const, x: c.x, y: 0.27, w: 0.035, h: 4, color: ACCENTS[i] }, c]),
    ],
  },
  {
    kind: 'comparison',
    items: [
      title(),
      { kind: 'bar' as const, x: M, y: 0.19, w: 0.06, h: 5, color: '$accent1' },
      // A faint divider between the two sides.
      deco('rectangle', 0.4985, 0.27, 0.003, 0.6, '$muted', { opacity: 35 }),
      ...columns(2, 0.27).map((c, i) => ({
        ...(c as Extract<LayoutSpecItem, { kind: 'text' }>),
        role: 'subtitle' as const,
        prompt: 'Click to add heading',
        size: 26,
        font: 'heading' as const,
        color: ACCENTS[i],
        bold: true,
      })),
      ...columns(2, 0.38),
    ],
  },
  {
    kind: 'statement',
    items: [
      { kind: 'bar' as const, x: 0.45, y: 0.3, w: 0.1, h: 6, color: '$accent1' },
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
      quoteMark(0.085, 0.1),
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

/**
 * Sidebar: a solid surface column down the left of every slide (on the master) with
 * an accent rail; content slides put their title in that column and the body beside it.
 */
const SL = 0.3; // content starts right of the column
const SW = 1 - SL - M;
const COLW = 0.24; // the column's width
export const SIDEBAR_MASTER: LayoutSpecItem[] = [
  deco('rectangle', 0, 0, COLW, 1, '$surface'),
  bar(COLW, 0, 0.006, 720, '$accent1'),
];
export const SIDEBAR_LAYOUTS: LayoutVariant = (() => {
  const inCol = (y = 0.12, size = 34): TextItem =>
    txt('title', 'Click to add title', 0.035, y, COLW - 0.06, size, 'heading', '$heading', { bold: true });
  const colRule = (y = 0.12): LayoutSpecItem => bar(0.035, y - 0.03, 0.05, 5, '$accent1');
  const bodyAt = (x: number, w: number, y = 0.12): TextItem => txt('body', 'Click to add text', x, y, w, 22, 'body', '$text');
  const stacked = (n: number): LayoutSpecItem[] => {
    // Columns become rows beside the sidebar: each with its own accent marker.
    const h = 0.76 / n;
    return Array.from({ length: n }, (_, i) => [
      deco('rectangle', SL, 0.12 + i * h, 0.008, h - 0.04, ACCENTS[i]),
      bodyAt(SL + 0.03, SW - 0.03, 0.12 + i * h),
    ]).flat();
  };
  return {
    title: [
      deco('rectangle', 0, 0, COLW, 1, '$accent1'),
      txt('title', 'Click to add title', SL, 0.32, SW, 62, 'heading', '$heading', { bold: true }),
      txt('subtitle', 'Click to add subtitle', SL, 0.56, SW * 0.85, 26, 'body', '$muted'),
    ],
    section: [
      deco('rectangle', 0, 0, COLW, 1, '$accent2'),
      txt('caption', 'Section', 0.035, 0.42, COLW - 0.06, 22, 'body', '$background', { bold: true }),
      txt('title', 'Click to add title', SL, 0.38, SW, 56, 'heading', '$heading', { bold: true }),
      txt('subtitle', 'Click to add subtitle', SL, 0.58, SW, 24, 'body', '$muted'),
    ],
    content: [colRule(), inCol(), bodyAt(SL, SW)],
    'two-column': [colRule(), inCol(), ...stacked(2)],
    'three-column': [colRule(), inCol(), ...stacked(3)],
    comparison: [
      colRule(),
      inCol(),
      ...cols(2, SL, SW, (x, w) =>
        txt('subtitle', 'Click to add heading', x, 0.12, w, 26, 'heading', '$accent1', { bold: true }),
      ).map((c, i) => ({ ...c, color: ACCENTS[i] })),
      deco('rectangle', SL + SW / 2 - 0.0015, 0.12, 0.003, 0.76, '$muted', { opacity: 35 }),
      ...cols(2, SL, SW, (x, w) => bodyAt(x, w, 0.22)),
    ],
    statement: [
      txt('emphasis', 'Click to add a statement', SL, 0.32, SW, 54, 'heading', '$heading', { bold: true }),
      bar(SL, 0.68, 0.12, 6, '$accent1'),
    ],
    quote: [
      quoteMark(0.06, 0.32),
      txt('emphasis', 'Click to add a quote', SL, 0.26, SW, 42, 'heading', '$heading', { italic: true }),
      txt('caption', 'Attribution', SL, 0.62, SW, 22, 'body', '$accent1', { bold: true }),
    ],
  };
})();

/**
 * Centered: symmetric and airy. Big outlined rings frame the title slides, titles are
 * centered with a small dot trio above them, and columns sit on rounded cards.
 */
export const CENTERED_LAYOUTS: LayoutVariant = (() => {
  const c = { align: 'center' as const };
  const dots = (y: number): LayoutSpecItem[] =>
    [0, 1, 2].map((i) => deco('ellipse', 0.487 + i * 0.011, y, 0.007, 0.0125, ACCENTS[i]));
  const head = (): TextItem => txt('title', 'Click to add title', M, 0.1, W, 40, 'heading', '$heading', { bold: true, ...c });
  const bodyAt = (x: number, w: number, y = 0.27): TextItem => txt('body', 'Click to add text', x, y, w, 22, 'body', '$text', c);
  const cardCols = (n: number): LayoutSpecItem[] =>
    cols(n, M, W, (x, w) => bodyAt(x + 0.02, w - 0.04, 0.36)).flatMap((t, i) => [
      deco('rectangle', t.x - 0.02, 0.28, t.w + 0.04, 0.6, '$surface', { radius: 24 }),
      deco('ellipse', t.x + t.w / 2 - 0.012, 0.3, 0.024, 0.043, ACCENTS[i]),
      t,
    ]);
  return {
    title: [
      ...dots(0.3),
      txt('title', 'Click to add title', M, 0.36, W, 64, 'heading', '$heading', { bold: true, ...c }),
      txt('subtitle', 'Click to add subtitle', M, 0.58, W, 26, 'body', '$muted', c),
    ],
    section: [
      ...dots(0.34),
      txt('title', 'Click to add title', M, 0.4, W, 54, 'heading', '$heading', { bold: true, ...c }),
      txt('subtitle', 'Click to add subtitle', M, 0.58, W, 24, 'body', '$muted', c),
    ],
    content: [...dots(0.06), head(), bodyAt(0.15, 0.7, 0.26)],
    'two-column': [...dots(0.06), head(), ...cardCols(2)],
    'three-column': [...dots(0.06), head(), ...cardCols(3)],
    comparison: [
      ...dots(0.06),
      head(),
      ...cols(2, M, W, (x, w) => bodyAt(x, w)).map((t) => deco('rectangle', t.x, 0.25, t.w, 0.65, '$surface', { radius: 24 })),
      ...cols(2, M, W, (x, w) =>
        txt('subtitle', 'Click to add heading', x + 0.02, 0.29, w - 0.04, 26, 'heading', '$accent1', { bold: true, ...c }),
      ).map((t, i) => ({ ...t, color: ACCENTS[i] })),
      ...cols(2, M, W, (x, w) => bodyAt(x + 0.02, w - 0.04, 0.4)),
    ],
    statement: [
      txt('emphasis', 'Click to add a statement', 0.12, 0.38, 0.76, 52, 'heading', '$heading', { bold: true, ...c }),
      ...dots(0.66),
    ],
    quote: [
      quoteMark(0.44, 0.08, 'center'),
      txt('emphasis', 'Click to add a quote', 0.12, 0.3, 0.76, 40, 'heading', '$heading', { italic: true, ...c }),
      ...dots(0.58),
      txt('caption', 'Attribution', 0.12, 0.62, 0.76, 22, 'body', '$muted', c),
    ],
  };
})();

/**
 * Banner: bold full-color accent bands. Titles sit in a solid accent band across the top
 * in the background color, with a thin second-accent stripe; section and statement
 * slides are one big band.
 */
export const BANNER_LAYOUTS: LayoutVariant = (() => {
  const band = (): LayoutSpecItem[] => [
    deco('rectangle', 0, 0, 1, 0.2, '$accent1'),
    deco('rectangle', 0, 0.2, 1, 0.012, '$accent2'),
  ];
  const head = (): TextItem => txt('title', 'Click to add title', M, 0.055, W, 40, 'heading', '$background', { bold: true });
  const bodyAt = (x: number, w: number, y = 0.29): TextItem => txt('body', 'Click to add text', x, y, w, 22, 'body', '$text');
  const tabCols = (n: number): LayoutSpecItem[] =>
    cols(n, M, W, (x, w) => bodyAt(x, w, 0.38)).flatMap((c, i) => [
      deco('rectangle', c.x, 0.29, c.w, 0.06, ACCENTS[i], { radius: 4 }),
      c,
    ]);
  return {
    title: [
      deco('rectangle', 0, 0.3, 1, 0.4, '$accent1'),
      deco('rectangle', 0, 0.7, 1, 0.014, '$accent2'),
      txt('title', 'Click to add title', M, 0.37, W, 62, 'heading', '$background', { bold: true }),
      txt('subtitle', 'Click to add subtitle', M, 0.76, W, 26, 'body', '$muted'),
    ],
    section: [
      deco('rectangle', 0, 0, 1, 1, '$accent2'),
      deco('rectangle', M, 0.36, 0.08, 0.012, '$background'),
      txt('title', 'Click to add title', M, 0.4, W * 0.8, 56, 'heading', '$background', { bold: true }),
      txt('subtitle', 'Click to add subtitle', M, 0.6, W * 0.8, 24, 'body', '$background'),
    ],
    content: [...band(), head(), bodyAt(M, W)],
    'two-column': [...band(), head(), ...tabCols(2)],
    'three-column': [...band(), head(), ...tabCols(3)],
    comparison: [
      ...band(),
      head(),
      ...cols(2, M, W, (x, w) => bodyAt(x, w)).map((t, i) => deco('rectangle', t.x, 0.29, t.w, 0.07, ACCENTS[i], { radius: 4 })),
      ...cols(2, M, W, (x, w) =>
        txt('subtitle', 'Click to add heading', x + 0.015, 0.3, w - 0.03, 24, 'heading', '$background', { bold: true }),
      ),
      ...cols(2, M, W, (x, w) => bodyAt(x, w, 0.41)),
    ],
    statement: [
      deco('rectangle', 0, 0.26, 1, 0.48, '$accent1'),
      txt('emphasis', 'Click to add a statement', 0.1, 0.38, 0.8, 50, 'heading', '$background', { bold: true, align: 'center' }),
    ],
    quote: [
      ...band(),
      quoteMark(0.105, 0.26),
      txt('emphasis', 'Click to add a quote', 0.12, 0.36, 0.76, 40, 'heading', '$heading', { italic: true }),
      txt('caption', 'Attribution', 0.12, 0.68, 0.76, 22, 'body', '$accent1', { bold: true }),
    ],
  };
})();

// ---- Designs with their own look (each pairs with its own theme in themes.ts) ----

/**
 * Spotlight: bold diagonal light bands sweep across dark slides; titles sit low and
 * large, content slides keep two thin bands in the corner.
 */
export const SPOTLIGHT_LAYOUTS: LayoutVariant = (() => {
  const band = (x: number, y: number, w: number, color: string, opacity: number): LayoutSpecItem =>
    deco('rectangle', x, y, w, 0.12, color, { opacity, angle: -0.42 });
  const corner = (): LayoutSpecItem[] => [band(0.72, -0.02, 0.4, '$accent1', 22), band(0.8, 0.07, 0.3, '$accent2', 18)];
  const head = (): TextItem => txt('title', 'Click to add title', M, 0.08, W * 0.72, 42, 'heading', '$heading', { bold: true });
  const kicker = (): LayoutSpecItem => bar(M, 0.205, 0.04, 5, '$accent1');
  const bodyAt = (x: number, w: number, y = 0.28): TextItem => txt('body', 'Click to add text', x, y, w, 22, 'body', '$text');
  const tiles = (n: number): LayoutSpecItem[] =>
    cols(n, M, W, (x, w) => bodyAt(x + 0.02, w - 0.04, 0.34)).flatMap((t, i) => [
      deco('rectangle', t.x - 0.02, 0.29, t.w + 0.04, 0.58, '$surface', { radius: 14 }),
      bar(t.x, 0.31, 0.05, 4, ACCENTS[i]),
      t,
    ]);
  return {
    title: [
      band(-0.1, 0.02, 0.75, '$accent1', 30),
      band(0.05, 0.12, 0.6, '$accent2', 22),
      band(0.55, 0.78, 0.7, '$accent3', 16),
      txt('title', 'Click to add title', M, 0.5, W * 0.85, 68, 'heading', '$heading', { bold: true }),
      txt('subtitle', 'Click to add subtitle', M, 0.71, W * 0.7, 26, 'body', '$accent1'),
    ],
    section: [
      band(0.35, 0.3, 1, '$accent1', 26),
      txt('subtitle', 'Click to add subtitle', M, 0.3, W, 20, 'body', '$muted', { bold: true }),
      txt('title', 'Click to add title', M, 0.38, W * 0.7, 58, 'heading', '$heading', { bold: true }),
    ],
    content: [...corner(), head(), kicker(), bodyAt(M, W * 0.85)],
    'two-column': [...corner(), head(), kicker(), ...tiles(2)],
    'three-column': [...corner(), head(), kicker(), ...tiles(3)],
    comparison: [
      ...corner(),
      head(),
      kicker(),
      ...cols(2, M, W, (x, w) => bodyAt(x, w)).map((t, i) =>
        deco('rectangle', t.x, 0.27, t.w, 0.62, i === 0 ? '$surface' : '$accent1', { radius: 14, opacity: i === 0 ? 100 : 14 }),
      ),
      ...cols(2, M, W, (x, w) =>
        txt('subtitle', 'Click to add heading', x + 0.025, 0.31, w - 0.05, 26, 'heading', '$heading', { bold: true }),
      ),
      ...cols(2, M, W, (x, w) => bodyAt(x + 0.025, w - 0.05, 0.42)),
    ],
    statement: [
      band(-0.2, 0.62, 1.4, '$accent1', 20),
      txt('emphasis', 'Click to add a statement', M, 0.3, W * 0.85, 56, 'heading', '$heading', { bold: true }),
    ],
    quote: [
      band(0.6, 0.0, 0.6, '$accent2', 18),
      quoteMark(M - 0.01, 0.12),
      txt('emphasis', 'Click to add a quote', M, 0.32, W * 0.8, 40, 'heading', '$heading', { italic: true }),
      txt('caption', 'Attribution', M, 0.64, W, 22, 'body', '$accent1', { bold: true }),
    ],
  };
})();

/**
 * Editorial: a magazine page. Hairline rules frame a running header; titles are big
 * display type set flush left; columns are numbered and divided by thin vertical rules.
 */
export const EDITORIAL_MASTER: LayoutSpecItem[] = [
  deco('rectangle', M, 0.06, W, 0.0028, '$heading', { opacity: 80 }),
  deco('rectangle', M, 0.93, W, 0.0014, '$muted', { opacity: 80 }),
];
export const EDITORIAL_LAYOUTS: LayoutVariant = (() => {
  const head = (): TextItem => txt('title', 'Click to add title', M, 0.1, W * 0.75, 46, 'heading', '$heading');
  const rule = (y: number): LayoutSpecItem => deco('rectangle', M, y, W, 0.0014, '$muted', { opacity: 70 });
  const bodyAt = (x: number, w: number, y = 0.3): TextItem => txt('body', 'Click to add text', x, y, w, 21, 'body', '$text');
  const ruled = (n: number): LayoutSpecItem[] =>
    cols(n, M, W, (x, w) => bodyAt(x, w, 0.34)).flatMap((t, i) => [
      txt('caption', `0${i + 1}`, t.x, 0.27, t.w, 18, 'heading', '$accent1', { bold: true }),
      ...(i > 0 ? [deco('rectangle', t.x - 0.02, 0.27, 0.0012, 0.6, '$muted', { opacity: 60 })] : []),
      t,
    ]);
  return {
    title: [
      deco('rectangle', 0, 0, 0.36, 1, '$surface'),
      txt('caption', 'Issue · Date', 0.04, 0.1, 0.28, 18, 'body', '$accent1', { bold: true }),
      txt('title', 'Click to add title', 0.42, 0.3, 0.52, 66, 'heading', '$heading'),
      deco('rectangle', 0.42, 0.62, 0.52, 0.0028, '$heading'),
      txt('subtitle', 'Click to add subtitle', 0.42, 0.66, 0.52, 24, 'body', '$muted', { italic: true }),
    ],
    section: [
      txt('caption', 'Chapter', M, 0.22, 0.3, 120, 'heading', '$accent1'),
      rule(0.52),
      txt('title', 'Click to add title', M, 0.56, W * 0.8, 50, 'heading', '$heading'),
      txt('subtitle', 'Click to add subtitle', M, 0.74, W * 0.7, 22, 'body', '$muted', { italic: true }),
    ],
    content: [head(), rule(0.24), bodyAt(M, W * 0.62), deco('rectangle', 0.72, 0.3, 0.215, 0.5, '$surface')],
    'two-column': [head(), rule(0.24), ...ruled(2)],
    'three-column': [head(), rule(0.24), ...ruled(3)],
    comparison: [
      head(),
      rule(0.24),
      deco('rectangle', 0.4993, 0.28, 0.0014, 0.6, '$heading', { opacity: 70 }),
      ...cols(2, M, W, (x, w) =>
        txt('subtitle', 'Click to add heading', x, 0.29, w, 28, 'heading', '$heading', { italic: true }),
      ),
      ...cols(2, M, W, (x, w) => bodyAt(x, w, 0.4)),
    ],
    statement: [
      rule(0.26),
      txt('emphasis', 'Click to add a statement', M, 0.32, W * 0.9, 54, 'heading', '$heading'),
      rule(0.72),
    ],
    quote: [
      deco('rectangle', M, 0.2, 0.006, 0.42, '$accent1'),
      txt('emphasis', 'Click to add a quote', M + 0.04, 0.22, W * 0.8, 44, 'heading', '$heading', { italic: true }),
      txt('caption', 'Attribution', M + 0.04, 0.66, W, 20, 'body', '$muted', { bold: true }),
    ],
  };
})();

/**
 * Split: a solid accent panel takes one side of the slide; titles sit on it in the
 * background color, content on the other side. Columns are tinted blocks.
 */
export const SPLIT_LAYOUTS: LayoutVariant = (() => {
  const panel = (w: number, color = '$accent1'): LayoutSpecItem => deco('rectangle', 0, 0, w, 1, color);
  const onPanel = (x: number, w: number): TextItem =>
    txt('title', 'Click to add title', x, 0.12, w, 40, 'heading', '$background', { bold: true });
  const bodyAt = (x: number, w: number, y = 0.12): TextItem => txt('body', 'Click to add text', x, y, w, 22, 'body', '$text');
  const blocks = (n: number): LayoutSpecItem[] =>
    cols(n, M, W, (x, w) => bodyAt(x + 0.02, w - 0.04, 0.42)).flatMap((t, i) => [
      deco('rectangle', t.x - 0.02, 0.36, t.w + 0.04, 0.54, ACCENTS[i], { opacity: 14, radius: 6 }),
      deco('rectangle', t.x - 0.02, 0.36, t.w + 0.04, 0.012, ACCENTS[i]),
      t,
    ]);
  const topBand = (): LayoutSpecItem[] => [
    deco('rectangle', 0, 0, 1, 0.27, '$accent1'),
    txt('title', 'Click to add title', M, 0.08, W, 40, 'heading', '$background', { bold: true }),
  ];
  return {
    title: [
      panel(0.5),
      deco('ellipse', 0.36, 0.62, 0.22, 0.4, '$accent2', { opacity: 60 }),
      txt('title', 'Click to add title', 0.06, 0.32, 0.38, 60, 'heading', '$background', { bold: true }),
      txt('subtitle', 'Click to add subtitle', 0.56, 0.44, 0.38, 26, 'body', '$text'),
    ],
    section: [
      panel(1, '$accent2'),
      txt('subtitle', 'Click to add subtitle', M, 0.34, W, 22, 'body', '$background', { bold: true }),
      txt('title', 'Click to add title', M, 0.42, W * 0.8, 58, 'heading', '$background', { bold: true }),
    ],
    content: [panel(0.32), onPanel(0.04, 0.24), bodyAt(0.38, 0.56)],
    'two-column': [...topBand(), ...blocks(2)],
    'three-column': [...topBand(), ...blocks(3)],
    comparison: [
      ...topBand(),
      ...cols(2, M, W, (x, w) =>
        txt('subtitle', 'Click to add heading', x, 0.33, w, 28, 'heading', '$accent1', { bold: true }),
      ).map((t, i) => ({ ...t, color: ACCENTS[i] })),
      ...cols(2, M, W, (x, w) => bodyAt(x, w, 0.44)),
    ],
    statement: [
      panel(1),
      txt('emphasis', 'Click to add a statement', 0.1, 0.36, 0.8, 54, 'heading', '$background', { bold: true, align: 'center' }),
    ],
    quote: [
      panel(0.32, '$accent2'),
      quoteMark(0.1, 0.32),
      txt('emphasis', 'Click to add a quote', 0.38, 0.28, 0.56, 40, 'heading', '$heading', { italic: true }),
      txt('caption', 'Attribution', 0.38, 0.62, 0.56, 22, 'body', '$accent2', { bold: true }),
    ],
  };
})();

/**
 * Frame: an inset outline border with accent corner brackets on every slide (the
 * master); big condensed titles, numbered outlined boxes for columns.
 */
const FI = 0.035; // frame inset as a fraction of the width
const FIY = (FI * 16) / 9; // the same inset in px, as a fraction of the height
export const FRAME_MASTER: LayoutSpecItem[] = [
  outline(FI, FIY, 1 - 2 * FI, 1 - 2 * FIY, '$muted', 1.5, 60),
  deco('rectangle', FI, FIY, 0.07, 0.012, '$accent1'),
  deco('rectangle', FI, FIY, 0.0068, 0.12, '$accent1'),
  deco('rectangle', 1 - FI - 0.07, 1 - FIY - 0.012, 0.07, 0.012, '$accent1'),
  deco('rectangle', 1 - FI - 0.0068, 1 - FIY - 0.12, 0.0068, 0.12, '$accent1'),
];
export const FRAME_LAYOUTS: LayoutVariant = (() => {
  const X = 0.09;
  const FW = 1 - 2 * X;
  const head = (): TextItem => txt('title', 'Click to add title', X, 0.13, FW, 44, 'heading', '$heading', { bold: true });
  const tag = (): LayoutSpecItem => bar(X, 0.255, 0.1, 4, '$accent1');
  const bodyAt = (x: number, w: number, y = 0.31): TextItem => txt('body', 'Click to add text', x, y, w, 22, 'body', '$text');
  const boxed = (n: number): LayoutSpecItem[] =>
    cols(n, X, FW, (x, w) => bodyAt(x + 0.02, w - 0.04, 0.42)).flatMap((t, i) => [
      outline(t.x - 0.02, 0.33, t.w + 0.04, 0.54, ACCENTS[i], 2),
      txt('caption', `${i + 1}`, t.x, 0.35, 0.05, 30, 'heading', ACCENTS[i], { bold: true }),
      t,
    ]);
  return {
    title: [
      deco('rectangle', X, 0.3, 0.012, 0.4, '$accent1'),
      txt('title', 'Click to add title', X + 0.04, 0.3, FW * 0.85, 72, 'heading', '$heading', { bold: true }),
      txt('subtitle', 'Click to add subtitle', X + 0.04, 0.6, FW * 0.7, 26, 'body', '$accent1'),
    ],
    section: [
      deco('rectangle', 0.5, FIY, 0.5 - FI, 1 - 2 * FIY, '$surface'),
      txt('caption', '01', 0.56, 0.2, 0.3, 140, 'heading', '$accent1', { bold: true }),
      txt('title', 'Click to add title', X, 0.4, 0.38, 52, 'heading', '$heading', { bold: true }),
      txt('subtitle', 'Click to add subtitle', X, 0.62, 0.38, 22, 'body', '$muted'),
    ],
    content: [head(), tag(), bodyAt(X, FW)],
    'two-column': [head(), tag(), ...boxed(2)],
    'three-column': [head(), tag(), ...boxed(3)],
    comparison: [
      head(),
      tag(),
      ...cols(2, X, FW, (x, w) => bodyAt(x, w)).map((t, i) => outline(t.x, 0.31, t.w, 0.58, ACCENTS[i], 2)),
      ...cols(2, X, FW, (x, w) =>
        txt('subtitle', 'Click to add heading', x + 0.025, 0.34, w - 0.05, 26, 'heading', '$heading', { bold: true }),
      ),
      ...cols(2, X, FW, (x, w) => bodyAt(x + 0.025, w - 0.05, 0.45)),
    ],
    statement: [
      txt('emphasis', 'Click to add a statement', X, 0.34, FW, 58, 'heading', '$heading', { bold: true, align: 'center' }),
      bar(0.45, 0.66, 0.1, 6, '$accent1'),
    ],
    quote: [
      quoteMark(X, 0.14),
      txt('emphasis', 'Click to add a quote', X + 0.04, 0.32, FW * 0.85, 40, 'heading', '$heading', { italic: true }),
      txt('caption', 'Attribution', X + 0.04, 0.64, FW, 22, 'body', '$accent1', { bold: true }),
    ],
  };
})();

/**
 * Default morph tags for a layout's items, so slides on different layouts (and in
 * different built-in designs) morph into each other: every heading-font title-like
 * placeholder (title, statement, quote) shares `layout-title`, other placeholders pair
 * by role and order, and decorations pair by shape class and order (the 1st accent bar
 * of one layout morphs into the 1st accent bar of another). `undefined` = leave untagged
 * (e.g. a captured element that already carries its own tag).
 */
export function layoutItemMorphTags(items: readonly LayoutSpecItem[]): (string | undefined)[] {
  const seen = new Map<string, number>();
  const next = (key: string): string => {
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n === 1 ? key : `${key}-${n}`;
  };
  // Number in reading order, so "the 2nd bar" means the same thing on every layout.
  const order = items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => a.it.y - b.it.y || a.it.x - b.it.x);
  const out: (string | undefined)[] = new Array(items.length).fill(undefined);
  for (const { it, i } of order) {
    if (it.kind === 'text') {
      const titleLike = it.role === 'title' || (it.role === 'emphasis' && it.font === 'heading');
      out[i] = next(titleLike ? 'layout-title' : `layout-${it.role}`);
      continue;
    }
    if (it.kind === 'element' && it.el.morphId) continue;
    const pw = it.w * 1280;
    const ph = it.kind === 'bar' ? it.h : it.h * 720;
    const type = it.kind === 'bar' ? 'rectangle' : it.el.type;
    if (type === 'text') {
      out[i] = next('layout-mark');
      continue;
    }
    const cls = ph <= 12 && pw >= ph * 3 ? 'bar' : pw <= 12 && ph >= pw * 3 ? 'vbar' : 'box';
    out[i] = next(`layout-${type === 'ellipse' ? 'ellipse' : 'shape'}-${cls}`);
  }
  return out;
}
