// Presentation themes: named color and font tokens that slide content refers to
// instead of literal values, so switching a deck's theme restyles it in place.
// A color field holds either a literal (`#2f6bff`) or a token (`$accent1`); a font
// field either a family key (`inter`) or a token (`$heading`). Pure functions, so
// the client renderers, exports and the MCP server resolve tokens the same way.

import type { CanvasElementModel, SlideConfig } from '../models';
import { presentationOf } from './index';
import { THEME_FILL, THEME_STROKE, resolveColor } from '../palette';
import { parseGrid, serializeGrid } from '../grid';
import {
  BANNER_LAYOUTS,
  CENTERED_LAYOUTS,
  SIDEBAR_LAYOUTS,
  SIDEBAR_MASTER,
  layoutSpec,
  type LayoutKind,
  type LayoutSpecItem,
} from './layout-kinds';

/** Stored values starting with this are theme tokens. */
export const THEME_TOKEN_PREFIX = '$';

export const THEME_COLOR_TOKENS = [
  'background',
  'surface',
  'heading',
  'text',
  'muted',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
] as const;
export type ThemeColorToken = (typeof THEME_COLOR_TOKENS)[number];

export const THEME_FONT_TOKENS = ['heading', 'body'] as const;
export type ThemeFontToken = (typeof THEME_FONT_TOKENS)[number];

/** Display labels for the token swatches. */
export const THEME_COLOR_LABELS: Record<ThemeColorToken, string> = {
  background: 'Background',
  surface: 'Surface',
  heading: 'Heading',
  text: 'Text',
  muted: 'Muted',
  accent1: 'Accent 1',
  accent2: 'Accent 2',
  accent3: 'Accent 3',
  accent4: 'Accent 4',
};

/**
 * A library record. Three kinds share this shape (so they are stored, synced and validated
 * the same way): a theme (colors and fonts), a layout set (`kind: 'layouts'`: layouts and
 * master) and a design (`kind: 'design'`: one layout set plus its selected theme).
 * On a slide frame it is the deck's theme, plus which design and layout set the deck uses.
 */
export interface SlideTheme {
  /** The record's id (built-in ids are fixed; custom ones start with `custom-`). */
  id?: string;
  /** What this record is; absent = a theme. */
  kind?: 'theme' | 'layouts' | 'design';
  /** On a design: its selected theme's id. */
  themeId?: string;
  /** On a design: its layout set's id. On a slide frame: the deck's layout set. */
  layoutsId?: string;
  /** On a slide frame: the deck's design. */
  designId?: string;
  name: string;
  colors: Record<ThemeColorToken, string>;
  /** Font family keys (the editor's font options). */
  fonts: Record<ThemeFontToken, string>;
  /**
   * This theme's own design for some layout kinds (items as in `STANDARD_LAYOUT_SPECS`);
   * kinds left out use the standard design. Switching to a theme rebuilds the deck's
   * untouched standard layouts whose design differs.
   */
  layouts?: Partial<Record<LayoutKind, LayoutSpecItem[]>>;
  /** Items this theme puts on the master (drawn under every slide); none = an empty master. */
  master?: LayoutSpecItem[];
  /** The design's own layouts that are not a standard kind, by name. */
  extraLayouts?: ThemeExtraLayout[];
}

/** A design layout that is not one of the standard kinds. */
export interface ThemeExtraLayout {
  name: string;
  items: LayoutSpecItem[];
}

/** A theme without its layout designs: what slide frames carry (the designs live in the library). */
export function themeTokensOnly(theme: SlideTheme): SlideTheme {
  const { layouts: _l, master: _m, extraLayouts: _x, kind: _k, themeId: _t, layoutsId: _ls, designId: _d, ...rest } = theme;
  return rest;
}


/**
 * A downloadable design file: a whole design (its theme and layout set), just a theme,
 * or just a layout set.
 */
export const THEME_FILE_FORMAT = 'dbdesigner-theme';
export const THEME_FILE_VERSION = 2;
export type ThemeFilePart = 'design' | 'theme' | 'layouts';
export interface ThemeFile {
  format: typeof THEME_FILE_FORMAT;
  version: number;
  exportedAt: string;
  part: ThemeFilePart;
  /** The design's name (part `design`). */
  design?: { name: string };
  /** Colors and fonts (parts `design` and `theme`). */
  theme?: SlideTheme;
  /** Layouts and master (parts `design` and `layouts`). */
  layouts?: SlideTheme;
}

export function themeFile(part: ThemeFilePart, content: { name?: string; theme?: SlideTheme; layouts?: SlideTheme }): ThemeFile {
  return {
    format: THEME_FILE_FORMAT,
    version: THEME_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    part,
    ...(part === 'design' ? { design: { name: content.name ?? 'Design' } } : {}),
    ...(part !== 'layouts' && content.theme ? { theme: themeTokensOnly(content.theme) } : {}),
    ...(part !== 'theme' && content.layouts ? { layouts: content.layouts } : {}),
  };
}

/** What a design file holds once read. */
export interface ParsedThemeFile {
  part: ThemeFilePart;
  name: string;
  theme?: SlideTheme;
  layouts?: SlideTheme;
}

function badTheme(t: Partial<SlideTheme> | undefined): string | null {
  if (!t || typeof t.name !== 'string' || !t.colors || !t.fonts) return 'The file is missing its theme.';
  for (const k of THEME_COLOR_TOKENS) if (typeof t.colors[k] !== 'string') return `The theme has no "${k}" color.`;
  for (const k of THEME_FONT_TOKENS) if (typeof t.fonts[k] !== 'string') return `The theme has no ${k} font.`;
  return null;
}

/** Read a design, theme or layouts file, or say what is wrong with it. */
export function parseThemeFile(raw: unknown): ParsedThemeFile | string {
  const f = raw as Partial<ThemeFile> & { theme?: SlideTheme } | null;
  if (!f || typeof f !== 'object' || f.format !== THEME_FILE_FORMAT) return 'This is not a DBDesigner design file.';
  if (typeof f.version !== 'number' || f.version > THEME_FILE_VERSION) return 'This file is from a newer version.';
  if (f.version < 2) {
    // Version 1: a theme carrying its own layouts — a whole design.
    const bad = badTheme(f.theme);
    if (bad) return bad;
    const t = f.theme!;
    const hasLayouts = !!(t.layouts || t.master || t.extraLayouts);
    return {
      part: hasLayouts ? 'design' : 'theme',
      name: t.name,
      theme: themeTokensOnly(t),
      ...(hasLayouts
        ? { layouts: { ...DEFAULT_LAYOUT_SET, id: undefined, name: `${t.name} layouts`, layouts: t.layouts, master: t.master, extraLayouts: t.extraLayouts } }
        : {}),
    };
  }
  const part = f.part;
  if (part !== 'design' && part !== 'theme' && part !== 'layouts') return 'The file does not say what it holds.';
  if (part !== 'layouts') {
    const bad = badTheme(f.theme);
    if (bad) return bad;
  }
  if (part !== 'theme' && (!f.layouts || typeof f.layouts !== 'object')) return 'The file is missing its layouts.';
  const name = part === 'design' ? (f.design?.name ?? 'Design') : part === 'theme' ? f.theme!.name : f.layouts!.name;
  return {
    part,
    name: typeof name === 'string' && name.trim() ? name : 'Imported',
    ...(f.theme ? { theme: themeTokensOnly(f.theme) } : {}),
    ...(f.layouts ? { layouts: { ...f.layouts, kind: 'layouts' as const } } : {}),
  };
}

/** A theme's design for a layout kind: its own, else the standard one. */
export function themeLayoutItems(theme: SlideTheme | undefined, kind: LayoutKind): LayoutSpecItem[] | undefined {
  return theme?.layouts?.[kind] ?? layoutSpec(kind)?.items;
}

export const BUILT_IN_THEMES: readonly SlideTheme[] = [
  {
    id: 'default',
    name: 'Default',
    // Follows the app: no slide background, and surface/text track light/dark mode.
    colors: {
      background: 'transparent',
      surface: THEME_FILL,
      heading: THEME_STROKE,
      text: THEME_STROKE,
      muted: '#94a3b8',
      accent1: '#2f6bff',
      accent2: '#7c5cff',
      accent3: '#12b76a',
      accent4: '#f5a623',
    },
    fonts: { heading: 'inter', body: 'inter' },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    colors: {
      background: '#0f172a',
      surface: '#1e293b',
      heading: '#f8fafc',
      text: '#cbd5e1',
      muted: '#64748b',
      accent1: '#38bdf8',
      accent2: '#a78bfa',
      accent3: '#34d399',
      accent4: '#fbbf24',
    },
    fonts: { heading: 'poppins', body: 'inter' },
  },
  {
    id: 'paper',
    name: 'Paper',
    colors: {
      background: '#fbf8f1',
      surface: '#f1ebdd',
      heading: '#2b2118',
      text: '#4a3f35',
      muted: '#a39482',
      accent1: '#b4532a',
      accent2: '#3f6e5a',
      accent3: '#c99a2e',
      accent4: '#6b4e8a',
    },
    fonts: { heading: 'display', body: 'serif' },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    colors: {
      background: '#f0f9ff',
      surface: '#e0f2fe',
      heading: '#0c4a6e',
      text: '#155e75',
      muted: '#7dd3fc',
      accent1: '#0ea5e9',
      accent2: '#14b8a6',
      accent3: '#2563eb',
      accent4: '#f97316',
    },
    fonts: { heading: 'poppins', body: 'normal' },
  },
  {
    id: 'bold',
    name: 'Bold',
    colors: {
      background: '#111111',
      surface: '#222222',
      heading: '#ffffff',
      text: '#e5e5e5',
      muted: '#737373',
      accent1: '#e5484d',
      accent2: '#f5a623',
      accent3: '#ffffff',
      accent4: '#ec4899',
    },
    fonts: { heading: 'condensed', body: 'inter' },
  },
];

export const DEFAULT_THEME: SlideTheme = BUILT_IN_THEMES[0];

/** The built-in layout sets: Default is every standard layout in its standard design. */
export const BUILT_IN_LAYOUT_SETS: readonly SlideTheme[] = [
  { kind: 'layouts', id: 'default-layouts', name: 'Default layouts', colors: DEFAULT_THEME.colors, fonts: DEFAULT_THEME.fonts },
  // The rest restyle every standard kind (same kinds and roles), so built-in designs swap cleanly.
  { kind: 'layouts', id: 'sidebar-layouts', name: 'Sidebar layouts', colors: DEFAULT_THEME.colors, fonts: DEFAULT_THEME.fonts, layouts: SIDEBAR_LAYOUTS, master: SIDEBAR_MASTER },
  { kind: 'layouts', id: 'centered-layouts', name: 'Centered layouts', colors: DEFAULT_THEME.colors, fonts: DEFAULT_THEME.fonts, layouts: CENTERED_LAYOUTS },
  { kind: 'layouts', id: 'banner-layouts', name: 'Banner layouts', colors: DEFAULT_THEME.colors, fonts: DEFAULT_THEME.fonts, layouts: BANNER_LAYOUTS },
];
export const DEFAULT_LAYOUT_SET: SlideTheme = BUILT_IN_LAYOUT_SETS[0];

/** The built-in designs: Default is the Default layouts with the Default theme. */
export const BUILT_IN_DESIGNS: readonly SlideTheme[] = [
  {
    kind: 'design',
    id: 'default-design',
    name: 'Default',
    themeId: DEFAULT_THEME.id,
    layoutsId: DEFAULT_LAYOUT_SET.id,
    colors: DEFAULT_THEME.colors,
    fonts: DEFAULT_THEME.fonts,
  },
  // Every built-in design uses the Default theme; they differ only in their layouts.
  ...(['Sidebar', 'Centered', 'Banner'] as const).map(
    (name): SlideTheme => ({
      kind: 'design',
      id: `${name.toLowerCase()}-design`,
      name,
      themeId: DEFAULT_THEME.id,
      layoutsId: `${name.toLowerCase()}-layouts`,
      colors: DEFAULT_THEME.colors,
      fonts: DEFAULT_THEME.fonts,
    }),
  ),
];
export const DEFAULT_DESIGN: SlideTheme = BUILT_IN_DESIGNS[0];

/** A built-in theme, layout set or design (never changed; edits make custom copies). */
export function isBuiltInRecord(id: string | undefined): boolean {
  return [...BUILT_IN_THEMES, ...BUILT_IN_LAYOUT_SETS, ...BUILT_IN_DESIGNS].some((r) => r.id === id);
}

/** A record's kind (absent = theme). */
export function recordKind(r: SlideTheme): 'theme' | 'layouts' | 'design' {
  return r.kind ?? 'theme';
}
const BUILT_IN_BY_ID = new Map(BUILT_IN_THEMES.map((t) => [t.id!, t]));

/** A theme color as CSS for swatches: follow-the-app sentinels become CSS variables. */
export function themeSwatchCss(color: string): string {
  return color === THEME_FILL ? 'var(--dbd-surface)' : color === THEME_STROKE ? 'var(--dbd-text)' : color;
}

export function themeToken(token: ThemeColorToken | ThemeFontToken): string {
  return THEME_TOKEN_PREFIX + token;
}

/** The token a stored value names, if it is one. */
export function tokenOf(value: string | undefined | null): string | null {
  return value && value.startsWith(THEME_TOKEN_PREFIX) ? value.slice(THEME_TOKEN_PREFIX.length) : null;
}

/** A color argument (theme token, palette name or hex) as the value to store; null when unknown. */
export function resolveColorOrToken(input: string | undefined | null): string | null {
  const raw = (input ?? '').trim();
  const token = tokenOf(raw);
  if (token !== null) return (THEME_COLOR_TOKENS as readonly string[]).includes(token) ? raw : null;
  return resolveColor(raw).hex;
}

/** A stored color as a concrete color (tokens looked up; unknown tokens fall back to the default theme). */
export function resolveThemeColor(value: string, theme?: SlideTheme): string;
export function resolveThemeColor(value: string | undefined, theme?: SlideTheme): string | undefined;
export function resolveThemeColor(value: string | undefined, theme: SlideTheme = DEFAULT_THEME): string | undefined {
  const t = tokenOf(value) as ThemeColorToken | null;
  if (!t) return value;
  return theme.colors[t] ?? DEFAULT_THEME.colors[t] ?? value;
}

/** A stored font as a family key. */
export function resolveThemeFont(value: string | undefined, theme: SlideTheme = DEFAULT_THEME): string | undefined {
  const t = tokenOf(value) as ThemeFontToken | null;
  if (!t) return value;
  return theme.fonts[t] ?? DEFAULT_THEME.fonts[t] ?? undefined;
}

type Themable = Pick<CanvasElementModel, 'strokeColor' | 'backgroundColor' | 'fontFamily' | 'runs'> & {
  fillStyle?: CanvasElementModel['fillStyle'];
  type?: string;
  text?: string;
};

/** A grid's stored JSON with the theme tokens in its cell styles resolved. */
function resolveGridText(text: string, theme: SlideTheme): string {
  const grid = parseGrid(text);
  const styles = Object.fromEntries(
    Object.entries(grid.styles ?? {}).map(([key, st]) => [
      key,
      { ...st, color: resolveThemeColor(st.color, theme), fill: resolveThemeColor(st.fill, theme) },
    ]),
  );
  return serializeGrid({ ...grid, styles });
}

/** An element with its theme tokens replaced by concrete values (the same object when it has none). */
export function resolveThemeElement<E extends Themable>(e: E, theme: SlideTheme = DEFAULT_THEME): E {
  const runTokens = e.runs?.some((r) => tokenOf(r.color));
  const gridTokens = e.type === 'grid' && !!e.text?.includes(`"${THEME_TOKEN_PREFIX}`);
  if (!tokenOf(e.strokeColor) && !tokenOf(e.backgroundColor) && !tokenOf(e.fontFamily) && !runTokens && !gridTokens) {
    return e;
  }
  return {
    ...e,
    ...(gridTokens ? { text: resolveGridText(e.text!, theme) } : {}),
    strokeColor: resolveThemeColor(e.strokeColor, theme),
    backgroundColor: resolveThemeColor(e.backgroundColor, theme),
    fontFamily: resolveThemeFont(e.fontFamily, theme),
    runs: runTokens ? e.runs!.map((r) => (tokenOf(r.color) ? { ...r, color: resolveThemeColor(r.color, theme) } : r)) : e.runs,
    // A theme color of "none" is no fill.
    ...(tokenOf(e.backgroundColor) && resolveThemeColor(e.backgroundColor, theme) === 'transparent'
      ? { fillStyle: 'none' as const }
      : {}),
  };
}

type FrameLike = { id: string; type: string; slide?: SlideConfig };

/**
 * Each presentation's theme. It is stored on every frame of the presentation
 * (`slide.theme`, so it travels with slides through sync, undo and export); the
 * first frame carrying one wins.
 */
export function presentationThemes(elements: readonly FrameLike[]): Map<string, SlideTheme> {
  const out = new Map<string, SlideTheme>();
  for (const e of elements) {
    if (e.type !== 'frame' || !e.slide?.theme) continue;
    const name = presentationOf(e);
    // A deck on a preset always uses the preset's current definition, so updates reach it.
    if (!out.has(name)) out.set(name, BUILT_IN_BY_ID.get(e.slide.theme.id ?? '') ?? e.slide.theme);
  }
  return out;
}

/**
 * Every element with its tokens resolved against the theme of the presentation it
 * belongs to. `context` holds the frames to look themes up in (default: `elements`),
 * for when the list is a subset that may leave out the owning frames.
 */
export function resolveThemedElements<E extends Themable & FrameLike & { slideId?: string }>(
  elements: readonly E[],
  context: readonly FrameLike[] = elements,
): E[] {
  const themes = presentationThemes(context);
  const frameTheme = new Map<string, SlideTheme>();
  for (const e of context) {
    if (e.type === 'frame' && e.slide) {
      frameTheme.set(e.id, themes.get(presentationOf(e)) ?? DEFAULT_THEME);
    }
  }
  return elements.map((e) =>
    resolveThemeElement(e, frameTheme.get(e.type === 'frame' ? e.id : e.slideId ?? '') ?? DEFAULT_THEME),
  );
}

/** A sequence diagram's parts with theme tokens resolved against the deck of the slide each diagram is on. */
export function resolveThemedSequences<
  D extends { id: string; slideId?: string; backgroundColor?: string; borderColor?: string },
  L extends { diagramId: string; color?: string; lineColor?: string; strokeColor?: string; textColor?: string },
  M extends { diagramId: string; color?: string },
>(
  sequences: { diagrams: readonly D[]; lifelines: readonly L[]; messages: readonly M[] },
  context: readonly FrameLike[],
): { diagrams: D[]; lifelines: L[]; messages: M[] } {
  const themes = presentationThemes(context);
  const frames = new Map(context.filter((f) => f.type === 'frame' && f.slide).map((f) => [f.id, f]));
  const themeOf = new Map(
    sequences.diagrams.map((d) => {
      const f = d.slideId ? frames.get(d.slideId) : undefined;
      return [d.id, (f && themes.get(presentationOf(f))) ?? DEFAULT_THEME] as const;
    }),
  );
  const of = (diagramId: string): SlideTheme => themeOf.get(diagramId) ?? DEFAULT_THEME;
  return {
    diagrams: sequences.diagrams.map((d) => ({
      ...d,
      backgroundColor: resolveThemeColor(d.backgroundColor, of(d.id)),
      borderColor: resolveThemeColor(d.borderColor, of(d.id)),
    })),
    lifelines: sequences.lifelines.map((l) => ({
      ...l,
      color: resolveThemeColor(l.color, of(l.diagramId)),
      lineColor: resolveThemeColor(l.lineColor, of(l.diagramId)),
      strokeColor: resolveThemeColor(l.strokeColor, of(l.diagramId)),
      textColor: resolveThemeColor(l.textColor, of(l.diagramId)),
    })),
    messages: sequences.messages.map((m) => ({ ...m, color: resolveThemeColor(m.color, of(m.diagramId)) })),
  };
}
