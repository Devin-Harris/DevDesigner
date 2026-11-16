import { THEME_STROKE } from '@devdesigner/shared';

/** Live theme colors used by the contrast guard (resolved CSS values). */
export interface ThemeColors {
   /** The canvas background a shape sits on (`--dd-canvas-bg`). */
   canvasBg: string;
   /** The theme's foreground/text color to fall back to (`--dd-text`). */
   text: string;
   /** The raised surface color (`--dd-surface`) used by the "surface" fill. */
   surface?: string;
}

/**
 * Sentinel `backgroundColor` meaning "the theme surface" (`--dd-surface`). It is
 * resolved at render time so the fill follows light/dark mode, and — unlike
 * `fillStyle: 'none'` — it is opaque, hiding the canvas grid behind the shape.
 */
export const SURFACE_FILL = 'surface';

function parseColor(color: string): [number, number, number] | null {
   const s = color.trim();
   if (s.startsWith('#')) {
      let h = s.slice(1);
      if (h.length === 3) {
         h = h
            .split('')
            .map((x) => x + x)
            .join('');
      }
      if (h.length < 6) {
         return null;
      }
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
   }
   const m = s.match(/rgba?\(([^)]+)\)/i);
   if (m) {
      const parts = m[1].split(/[,/\s]+/).map((p) => parseFloat(p));
      if (parts.length >= 3 && parts.slice(0, 3).every((n) => !Number.isNaN(n))) {
         return [parts[0], parts[1], parts[2]];
      }
   }
   return null;
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
   const lin = [r, g, b].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
   });
   return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG-style contrast ratio between two parsed colors (1 = identical). */
const CONTRAST_FLOOR = 1.5;

/**
 * Keep a drawn color visible against the current canvas background: if the color
 * sits too close to the background (would nearly disappear), fall back to the
 * theme's text color. A pure render transform — the stored color is unchanged,
 * so toggling the theme re-evaluates automatically. Applies to explicitly chosen
 * colors too (per the design decision).
 */
export function contrastSafe(color: string, theme: ThemeColors | undefined): string {
   if (color === THEME_STROKE || color === SURFACE_FILL) {
      return sentinelColor(color, theme);
   }
   if (!theme) {
      return color;
   }
   const c = parseColor(color);
   const bg = parseColor(theme.canvasBg);
   if (!c || !bg) {
      return color;
   }
   const lc = relativeLuminance(c);
   const lb = relativeLuminance(bg);
   const ratio = (Math.max(lc, lb) + 0.05) / (Math.min(lc, lb) + 0.05);
   return ratio < CONTRAST_FLOOR ? theme.text : color;
}

/** The theme sentinels (`surface` / `theme`) as concrete colors; either can be a fill or a stroke. */
export function sentinelColor(color: string, theme: ThemeColors | undefined): string {
   if (color === SURFACE_FILL) return theme?.surface ?? '#ffffff';
   if (color === THEME_STROKE) return theme?.text ?? '#1e293b';
   return color;
}

/** True when the color is dark enough that a light token palette reads on it. */
export function isDarkColor(color: string): boolean {
   const rgb = parseColor(color);
   return rgb ? relativeLuminance(rgb) < 0.25 : false;
}
