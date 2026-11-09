// Color arguments for tools: palette names ("blue", "amber-soft") or hex, resolved to
// the hex the app stores, with an actionable error for anything else.

import { COLOR_ROLES, PALETTE, PICKER_COLOR_NAMES, THEME_COLOR_TOKENS, paletteNames, resolveColor, resolveColorOrToken } from '@devdesigner/shared';
import { UserError } from './model';

/**
 * Resolve a color argument. `undefined` stays undefined (not given); an empty string
 * stays '' (clear the color). Anything unrecognised is an error listing valid names.
 */
export function colorArg(input: string | undefined, what: string): string | undefined {
  if (input === undefined) return undefined;
  if (input.trim() === '') return '';
  const hex = resolveColorOrToken(input);
  if (!hex) {
    throw new UserError(
      `Unknown color "${input}" for ${what}. Use a theme token (${themeTokenList()}), a hex like #2f6bff or a palette name - ${paletteNames()}. (list_colors explains which suits what.)`,
    );
  }
  return hex;
}

/** Like colorArg, for database tables: their headers do not follow a deck theme, so tokens are refused. */
export function tableColorArg(input: string | undefined, what: string): string | undefined {
  if (input === undefined) return undefined;
  if (input.trim() === '') return '';
  const { hex } = resolveColor(input);
  if (!hex) {
    throw new UserError(
      `Unknown color "${input}" for ${what}. Database tables take a hex like #2f6bff or a palette name - ${paletteNames()}; theme tokens are not supported on them.`,
    );
  }
  return hex;
}

const themeTokenList = (): string => THEME_COLOR_TOKENS.map((t) => `$${t}`).join(', ');

/** The text returned by list_colors. */
export function describePalette(): Record<string, unknown> {
  return {
    note: 'Pass these names wherever a tool takes a color - they match the swatches users pick from in the app. Use a #hex only when the user asks for an exact color (e.g. a brand color); do not invent custom shades. Header text turns dark automatically on pale colors.',
    themeTokens: { names: THEME_COLOR_TOKENS.map((t) => `$${t}`), note: 'On slide content, prefer these: they follow the presentation theme when it changes. Not available on database tables.' },
    pickerSwatches: { names: PICKER_COLOR_NAMES, note: 'The swatches the editor color pickers offer (plus white). Prefer these for everything.' },
    strong: PALETTE.filter((c) => c.tone === 'strong').map((c) => ({ name: c.name, hex: c.hex })),
    soft: PALETTE.filter((c) => c.tone === 'soft').map((c) => ({ name: c.name, hex: c.hex })),
    neutral: PALETTE.filter((c) => c.tone === 'neutral').map((c) => ({ name: c.name, hex: c.hex })),
    roles: COLOR_ROLES,
    defaults: [
      'Tables with no color: tables connected by relationships share one color per group (domain), unrelated groups differ.',
      'Participants and messages with no color use the theme (neutral) look.',
      'Sequence diagram background unset: theme surface.',
    ],
  };
}
