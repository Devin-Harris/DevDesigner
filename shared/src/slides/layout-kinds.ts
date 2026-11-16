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
  opts: { opacity?: number; radius?: number } = {},
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
    angle: 0,
    cornerRadius: opts.radius ?? 0,
  } as LayoutElementProps,
});
/** A soft tinted circle, for depth behind titles. `d` is its diameter as a fraction of the slide height. */
const orb = (x: number, y: number, d: number, color: string, opacity = 10): LayoutSpecItem =>
  deco('ellipse', x, y, (d * 9) / 16, d, color, { opacity });
/** A short rule in two accent colors (main, then a small second segment). */
const duo = (x: number, y: number, w: number, h: number): LayoutSpecItem[] => [
  { kind: 'bar', x, y, w: w * 0.7, h, color: '$accent1' },
  { kind: 'bar', x: x + w * 0.76, y, w: w * 0.24, h, color: '$accent2' },
];
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
      orb(0.74, -0.22, 0.8, '$accent1', 10),
      orb(-0.06, 0.66, 0.5, '$accent2', 8),
      { ...(title(0.34) as Extract<LayoutSpecItem, { kind: 'text' }>), size: 60, align: 'center' },
      ...duo(0.45, 0.53, 0.1, 6),
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
      orb(0.66, 0.08, 1.05, '$accent1', 9),
      ...duo(M, 0.35, 0.09, 8),
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
  { kind: 'content', items: [title(), ...duo(M, 0.19, 0.06, 5), body(M, W, 0.27)] },
  {
    kind: 'two-column',
    items: [
      title(),
      ...duo(M, 0.19, 0.06, 5),
      ...columns(2, 0.31).flatMap((c, i) => [{ kind: 'bar' as const, x: c.x, y: 0.27, w: 0.035, h: 4, color: ACCENTS[i] }, c]),
    ],
  },
  {
    kind: 'three-column',
    items: [
      title(),
      ...duo(M, 0.19, 0.06, 5),
      ...columns(3, 0.31).flatMap((c, i) => [{ kind: 'bar' as const, x: c.x, y: 0.27, w: 0.035, h: 4, color: ACCENTS[i] }, c]),
    ],
  },
  {
    kind: 'comparison',
    items: [
      title(),
      ...duo(M, 0.19, 0.06, 5),
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
      orb(0.3, 0.1, 0.8, '$accent1', 7),
      ...duo(0.45, 0.3, 0.1, 6),
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

/** Sidebar: an accent rail down the left edge (on the master), left-aligned titles. */
const SL = 0.1;
const SW = 1 - SL - M;
export const SIDEBAR_MASTER: LayoutSpecItem[] = [
  bar(0, 0, 0.014, 720, '$accent1'),
  // A short second-accent cap at the top of the rail.
  bar(0, 0, 0.014, 96, '$accent2'),
];
export const SIDEBAR_LAYOUTS: LayoutVariant = (() => {
  const head = (): TextItem => txt('title', 'Click to add title', SL, 0.09, SW, 40, 'heading', '$heading', { bold: true });
  const under = (): LayoutSpecItem[] => duo(SL, 0.2, 0.07, 4);
  const bodyAt = (x: number, w: number, y = 0.27): TextItem => txt('body', 'Click to add text', x, y, w, 22, 'body', '$text');
  const accentCols = (n: number): LayoutSpecItem[] =>
    cols(n, SL, SW, (x, w) => bodyAt(x, w, 0.31)).flatMap((c, i) => [bar(c.x, 0.27, 0.035, 4, ACCENTS[i]), c]);
  return {
    title: [
      orb(0.6, -0.1, 1.2, '$accent1', 9),
      bar(SL, 0.29, 0.06, 6, '$accent1'),
      txt('title', 'Click to add title', SL, 0.34, SW * 0.8, 64, 'heading', '$heading', { bold: true }),
      txt('subtitle', 'Click to add subtitle', SL, 0.56, SW * 0.7, 26, 'body', '$muted'),
    ],
    section: [
      orb(0.7, 0.2, 0.9, '$accent2', 8),
      txt('subtitle', 'Click to add subtitle', SL, 0.32, SW, 22, 'body', '$accent1', { bold: true }),
      txt('title', 'Click to add title', SL, 0.4, SW * 0.8, 56, 'heading', '$heading', { bold: true }),
    ],
    content: [head(), ...under(), bodyAt(SL, SW)],
    'two-column': [head(), ...under(), ...accentCols(2)],
    'three-column': [head(), ...under(), ...accentCols(3)],
    comparison: [
      head(),
      ...under(),
      deco('rectangle', SL + SW / 2 - 0.0015, 0.27, 0.003, 0.6, '$muted', { opacity: 35 }),
      ...cols(2, SL, SW, (x, w) =>
        txt('subtitle', 'Click to add heading', x, 0.27, w, 26, 'heading', '$accent1', { bold: true }),
      ).map((c, i) => ({ ...c, color: ACCENTS[i] })),
      ...cols(2, SL, SW, (x, w) => bodyAt(x, w, 0.38)),
    ],
    statement: [
      orb(0.62, 0.12, 0.85, '$accent1', 8),
      bar(SL, 0.3, 0.06, 6, '$accent1'),
      txt('emphasis', 'Click to add a statement', SL, 0.38, SW - 0.1, 52, 'heading', '$heading', { bold: true }),
    ],
    quote: [
      quoteMark(SL - 0.01, 0.1),
      txt('emphasis', 'Click to add a quote', SL, 0.3, SW - 0.1, 40, 'heading', '$heading', { italic: true }),
      bar(SL, 0.58, 0.05, 4, '$accent1'),
      txt('caption', 'Attribution', SL, 0.62, SW, 22, 'body', '$accent1'),
    ],
  };
})();

/** Centered: everything centered, with a two-tone accent rule under each title. */
export const CENTERED_LAYOUTS: LayoutVariant = (() => {
  const c = { align: 'center' as const };
  const head = (): TextItem => txt('title', 'Click to add title', M, 0.08, W, 40, 'heading', '$heading', { bold: true, ...c });
  const rule = (y = 0.19): LayoutSpecItem[] => duo(0.46, y, 0.08, 4);
  const bodyAt = (x: number, w: number, y = 0.27): TextItem => txt('body', 'Click to add text', x, y, w, 22, 'body', '$text', c);
  /** Columns sit on soft rounded cards. */
  const cardCols = (n: number): LayoutSpecItem[] =>
    cols(n, M, W, (x, w) => bodyAt(x + 0.02, w - 0.04, 0.33)).flatMap((t, i) => [
      deco('rectangle', t.x - 0.02, 0.28, t.w + 0.04, 0.6, '$surface', { radius: 18 }),
      bar(t.x + t.w / 2 - 0.0175, 0.3, 0.035, 4, ACCENTS[i]),
      t,
    ]);
  return {
    title: [
      orb(-0.08, -0.28, 0.9, '$accent1', 9),
      orb(0.78, 0.55, 0.75, '$accent2', 8),
      ...rule(0.3),
      txt('title', 'Click to add title', M, 0.36, W, 60, 'heading', '$heading', { bold: true, ...c }),
      txt('subtitle', 'Click to add subtitle', M, 0.56, W, 26, 'body', '$muted', c),
    ],
    section: [
      orb(0.36, 0.05, 0.9, '$accent1', 7),
      txt('title', 'Click to add title', M, 0.38, W, 54, 'heading', '$heading', { bold: true, ...c }),
      ...rule(0.55),
      txt('subtitle', 'Click to add subtitle', M, 0.6, W, 24, 'body', '$muted', c),
    ],
    content: [head(), ...rule(), bodyAt(0.15, 0.7)],
    'two-column': [head(), ...rule(), ...cardCols(2)],
    'three-column': [head(), ...rule(), ...cardCols(3)],
    comparison: [
      head(),
      ...rule(),
      ...cols(2, M, W, (x, w) => bodyAt(x, w)).map((t) => deco('rectangle', t.x, 0.25, t.w, 0.65, '$surface', { radius: 18 })),
      ...cols(2, M, W, (x, w) =>
        txt('subtitle', 'Click to add heading', x + 0.02, 0.29, w - 0.04, 26, 'heading', '$accent1', { bold: true, ...c }),
      ).map((t, i) => ({ ...t, color: ACCENTS[i] })),
      ...cols(2, M, W, (x, w) => bodyAt(x + 0.02, w - 0.04, 0.4)),
    ],
    statement: [
      orb(0.3, 0.08, 0.84, '$accent1', 7),
      txt('emphasis', 'Click to add a statement', 0.1, 0.36, 0.8, 52, 'heading', '$heading', { bold: true, ...c }),
      ...rule(0.62),
    ],
    quote: [
      quoteMark(0.44, 0.08, 'center'),
      txt('emphasis', 'Click to add a quote', 0.12, 0.3, 0.76, 40, 'heading', '$heading', { italic: true, ...c }),
      ...rule(0.58),
      txt('caption', 'Attribution', 0.12, 0.62, 0.76, 22, 'body', '$muted', c),
    ],
  };
})();

/** Banner: titles sit in a surface-colored band across the top. */
export const BANNER_LAYOUTS: LayoutVariant = (() => {
  const band = (): LayoutSpecItem[] => [
    bar(0, 0, 1, 150, '$surface'),
    bar(0, 0.208, 0.8, 4, '$accent1'),
    bar(0.8, 0.208, 0.2, 4, '$accent2'),
  ];
  const head = (): TextItem => txt('title', 'Click to add title', M, 0.06, W, 40, 'heading', '$heading', { bold: true });
  const bodyAt = (x: number, w: number, y = 0.29): TextItem => txt('body', 'Click to add text', x, y, w, 22, 'body', '$text');
  const accentCols = (n: number): LayoutSpecItem[] =>
    cols(n, M, W, (x, w) => bodyAt(x, w, 0.33)).flatMap((c, i) => [bar(c.x, 0.29, 0.035, 4, ACCENTS[i]), c]);
  return {
    title: [
      bar(0, 0.28, 1, 300, '$surface'),
      orb(0.72, 0.18, 0.62, '$accent1', 12),
      bar(0, 0.7, 0.8, 6, '$accent1'),
      bar(0.8, 0.7, 0.2, 6, '$accent2'),
      txt('title', 'Click to add title', M, 0.35, W * 0.8, 60, 'heading', '$heading', { bold: true }),
      txt('subtitle', 'Click to add subtitle', M, 0.55, W * 0.8, 26, 'body', '$muted'),
    ],
    section: [
      bar(0, 0, 0.36, 720, '$surface'),
      orb(0.06, 0.58, 0.5, '$accent1', 12),
      bar(0.36, 0, 0.006, 720, '$accent1'),
      txt('title', 'Click to add title', 0.42, 0.38, 0.52, 52, 'heading', '$heading', { bold: true }),
      txt('subtitle', 'Click to add subtitle', 0.42, 0.58, 0.52, 24, 'body', '$muted'),
    ],
    content: [...band(), head(), bodyAt(M, W)],
    'two-column': [...band(), head(), ...accentCols(2)],
    'three-column': [...band(), head(), ...accentCols(3)],
    comparison: [
      ...band(),
      head(),
      deco('rectangle', 0.4985, 0.3, 0.003, 0.58, '$muted', { opacity: 35 }),
      ...cols(2, M, W, (x, w) =>
        txt('subtitle', 'Click to add heading', x, 0.29, w, 26, 'heading', '$accent1', { bold: true }),
      ).map((t, i) => ({ ...t, color: ACCENTS[i] })),
      ...cols(2, M, W, (x, w) => bodyAt(x, w, 0.4)),
    ],
    statement: [
      bar(0, 0.3, 1, 290, '$surface'),
      bar(0.46, 0.3, 0.08, 6, '$accent1'),
      txt('emphasis', 'Click to add a statement', 0.1, 0.4, 0.8, 50, 'heading', '$heading', { bold: true, align: 'center' }),
    ],
    quote: [
      bar(0, 0, 1, 720, '$surface'),
      quoteMark(0.105, 0.1),
      txt('emphasis', 'Click to add a quote', 0.12, 0.3, 0.76, 40, 'heading', '$heading', { italic: true }),
      bar(0.12, 0.6, 0.06, 4, '$accent1'),
      txt('caption', 'Attribution', 0.12, 0.64, 0.76, 22, 'body', '$muted'),
    ],
  };
})();
