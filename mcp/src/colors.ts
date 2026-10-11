// Color arguments for tools: palette names ("blue", "amber-soft") or hex, resolved to
// the hex the app stores, with an actionable error for anything else.

import { COLOR_ROLES, PALETTE, paletteNames, resolveColor } from '@dbdesigner/shared';
import { UserError } from './model';

/**
 * Resolve a color argument. `undefined` stays undefined (not given); an empty string
 * stays '' (clear the color). Anything unrecognised is an error listing valid names.
 */
export function colorArg(input: string | undefined, what: string): string | undefined {
  if (input === undefined) return undefined;
  if (input.trim() === '') return '';
  const { hex } = resolveColor(input);
  if (!hex) {
    throw new UserError(
      `Unknown color "${input}" for ${what}. Use a hex like #2f6bff or a palette name - ${paletteNames()}. (list_colors explains which suits what.)`,
    );
  }
  return hex;
}

/** The text returned by list_colors. */
export function describePalette(): Record<string, unknown> {
  return {
    note: 'Pass any of these names (or a #hex) wherever a tool takes a color. Header text turns dark automatically on pale colors.',
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
