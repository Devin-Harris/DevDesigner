// The named color palette the app and the MCP server share. Table header colors,
// sequence participant headers, message arrows, diagram backgrounds and drawing
// shapes all take hex values; this module gives them names (so a model can say
// "blue" instead of guessing a hex), says which tone suits which role, and picks
// readable text for a fill. Pure and environment-agnostic.

/** A named color in the palette. */
export interface PaletteColor {
  /** Lower-case family name, e.g. "blue". Soft tints are "<family>-soft". */
  name: string;
  hex: string;
  /** `strong`: saturated, made for headers and strokes. `soft`: pale tint, made for fills and backgrounds. `neutral`: grays/black/white. */
  tone: 'strong' | 'soft' | 'neutral';
}

/**
 * Saturated header/stroke colors. These are the swatches the editor itself offers
 * (table header, participant header, arrow, shape stroke), so anything the MCP
 * server draws matches what a user would pick by hand.
 */
const STRONG: ReadonlyArray<readonly [string, string]> = [
  ['red', '#e5484d'],
  ['orange', '#f97316'],
  ['amber', '#f5a623'],
  ['green', '#12b76a'],
  ['teal', '#14b8a6'],
  ['sky', '#0ea5e9'],
  ['blue', '#2f6bff'],
  ['violet', '#7c5cff'],
  ['pink', '#ec4899'],
  ['slate', '#64748b'],
];

/** Pale tints of the same families: fills, diagram backgrounds, callout boxes. */
const SOFT: ReadonlyArray<readonly [string, string]> = [
  ['red-soft', '#fee2e2'],
  ['orange-soft', '#ffedd5'],
  ['amber-soft', '#fef3c7'],
  ['green-soft', '#dcfce7'],
  ['teal-soft', '#ccfbf1'],
  ['sky-soft', '#e0f2fe'],
  ['blue-soft', '#dbeafe'],
  ['violet-soft', '#ede9fe'],
  ['pink-soft', '#fce7f3'],
  ['slate-soft', '#f1f5f9'],
];

const NEUTRAL: ReadonlyArray<readonly [string, string]> = [
  ['white', '#ffffff'],
  ['gray', '#94a3b8'],
  ['charcoal', '#334155'],
  ['ink', '#1e293b'],
  ['black', '#0f172a'],
];

export const PALETTE: readonly PaletteColor[] = [
  ...STRONG.map(([name, hex]) => ({ name, hex, tone: 'strong' as const })),
  ...SOFT.map(([name, hex]) => ({ name, hex, tone: 'soft' as const })),
  ...NEUTRAL.map(([name, hex]) => ({ name, hex, tone: 'neutral' as const })),
];

const BY_NAME = new Map(PALETTE.map((c) => [c.name, c]));

/** The saturated header colors, in the order automatic coloring cycles through them. */
export const HEADER_COLOR_CYCLE: readonly string[] = [
  'blue',
  'green',
  'violet',
  'amber',
  'sky',
  'pink',
  'teal',
  'orange',
  'red',
  'slate',
].map((n) => BY_NAME.get(n)!.hex);

/** Where each kind of color is used, so a caller can pick the right tone. */
export const COLOR_ROLES: ReadonlyArray<{ role: string; applies: string; suits: string }> = [
  {
    role: 'table header',
    applies: 'ERD table title bar (`color` on a table)',
    suits:
      'strong colors; group related tables with one family (e.g. all billing tables amber). Soft tints work too (text turns dark automatically).',
  },
  {
    role: 'participant header',
    applies: 'sequence diagram participant box (`color`)',
    suits: 'strong colors, e.g. one color per system boundary (clients blue, services violet, data stores slate).',
  },
  {
    role: 'participant line',
    applies: "dashed spine under a participant (`lineColor`)",
    suits: 'leave unset, or the participant color.',
  },
  {
    role: 'message arrow',
    applies: 'sequence message line and arrowhead (`color`)',
    suits: 'leave unset; use red for an error path or green for success only when it carries meaning.',
  },
  {
    role: 'diagram background',
    applies: 'sequence diagram box (`backgroundColor`)',
    suits: 'soft tints or white/slate-soft; text color adapts. A dark ink/black background flips text to light.',
  },
  {
    role: 'shape fill',
    applies: 'drawing shapes (`backgroundColor`) and slide shapes',
    suits: 'soft tints for filled boxes (dark text stays readable), strong colors for emphasis.',
  },
  {
    role: 'stroke / text color',
    applies: 'shape outlines, arrows, free text (`strokeColor` / `color`)',
    suits: 'ink/charcoal for body text, a strong color for accents.',
  },
];

/** Look a palette color up by name (case/space/underscore-insensitive). */
export function paletteColor(name: string): PaletteColor | undefined {
  return BY_NAME.get(normalizeName(name));
}

function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/^(light|pale)-(.+)$/, '$2-soft')
    .replace(/-(light|pale|tint)$/, '-soft')
    .replace(/^(gr[ae]y)$/, 'gray');
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Expand "#abc" to "#aabbcc" and lower-case; null when it is not a hex color. */
export function normalizeHex(input: string): string | null {
  const m = HEX.exec(input.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${h.toLowerCase()}`;
}

export interface ColorResolution {
  /** The color to store, or null when `input` is not understood. */
  hex: string | null;
  /** The palette name when `input` named one. */
  name?: string;
}

/**
 * Turn a palette name ("blue", "amber-soft", "Light Blue") or a hex color into the
 * hex to store. "transparent" passes through (valid for fills). Anything else
 * resolves to `{ hex: null }` so the caller can report the valid names.
 */
export function resolveColor(input: string | undefined | null): ColorResolution {
  const raw = (input ?? '').trim();
  if (!raw) return { hex: null };
  if (raw.toLowerCase() === 'transparent') return { hex: 'transparent' };
  const hex = normalizeHex(raw);
  if (hex) return { hex };
  const named = BY_NAME.get(normalizeName(raw));
  return named ? { hex: named.hex, name: named.name } : { hex: null };
}

/** All palette names, grouped for an error message or a tool description. */
export function paletteNames(): string {
  const group = (tone: PaletteColor['tone']): string =>
    PALETTE.filter((c) => c.tone === tone)
      .map((c) => c.name)
      .join(', ');
  return `strong: ${group('strong')}; soft: ${group('soft')}; neutral: ${group('neutral')}`;
}

function channel(hex: string, i: number): number {
  const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a hex color (0 black .. 1 white); 0.5 for non-hex input. */
export function luminance(color: string): number {
  const hex = normalizeHex(color);
  if (!hex) return 0.5;
  return 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
}

/** WCAG contrast ratio between two hex colors (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Light text on dark fills. */
export const LIGHT_TEXT = '#ffffff';
/** Dark text on light fills. */
export const DARK_TEXT = '#0f172a';

/** The text color (white or near-black) that reads best on `fill`. */
export function readableTextOn(fill: string): string {
  return contrastRatio(fill, DARK_TEXT) >= contrastRatio(fill, LIGHT_TEXT) ? DARK_TEXT : LIGHT_TEXT;
}

/** True when dark text reads better than white on `fill` (so a header should use dark text). */
export function isLightFill(fill: string | undefined | null): boolean {
  return !!fill && !!normalizeHex(fill) && readableTextOn(fill) === DARK_TEXT;
}

/**
 * True for the stock strong/soft swatches the pickers offer. These keep the
 * theme's own text color (white in dark mode, dark in light mode); only custom
 * colors get the contrast-derived text color.
 */
export function isSwatchColor(fill: string | undefined | null): boolean {
  if (fill === THEME_FILL) return true;
  const hex = fill ? normalizeHex(fill) : null;
  return !!hex && PALETTE.some((c) => c.tone !== 'neutral' && c.hex === hex);
}

/** Hex values of the saturated header colors, in palette order (for swatch pickers). */
export const HEADER_SWATCHES: readonly string[] = PALETTE.filter((c) => c.tone === 'strong').map(
  (c) => c.hex,
);

/** Hex values of the pale tints, in palette order (for swatch pickers). */
export const SOFT_SWATCHES: readonly string[] = PALETTE.filter((c) => c.tone === 'soft').map(
  (c) => c.hex,
);

/** The palette name of a hex color when it is one of the named colors, else the hex itself. */
export function colorName(hex: string | undefined | null): string | undefined {
  if (!hex) return undefined;
  const norm = normalizeHex(hex);
  const hit = norm ? PALETTE.find((c) => c.hex === norm) : undefined;
  return hit ? hit.name : hex;
}

/**
 * The swatches every color picker in the editor offers (shapes, tables, sequence
 * diagrams), so a color chosen in one place can be matched in another.
 */
export const PICKER_COLOR_NAMES: readonly string[] = ['white', 'red', 'amber', 'green', 'sky', 'blue', 'violet', 'pink', 'slate'];

/** Hex values of {@link PICKER_COLOR_NAMES}, in order. */
export const PICKER_SWATCHES: readonly string[] = PICKER_COLOR_NAMES.map((n) => BY_NAME.get(n)!.hex);

/**
 * Theme-adaptive color sentinels the pickers offer next to the swatches. They are
 * stored as-is and resolved at render time so they follow light/dark mode:
 * `THEME_FILL` is the raised surface (fills, headers, backgrounds) and
 * `THEME_STROKE` the theme text color (outlines, text).
 */
export const THEME_FILL = 'surface';
export const THEME_STROKE = 'theme';

/** CSS for a stored color, resolving the theme sentinels to the app's CSS variables. */
export function themeColorCss(color: string | undefined | null): string | null {
  if (!color) return null;
  if (color === THEME_FILL) return 'var(--dd-surface)';
  if (color === THEME_STROKE) return 'var(--dd-text)';
  return color;
}
