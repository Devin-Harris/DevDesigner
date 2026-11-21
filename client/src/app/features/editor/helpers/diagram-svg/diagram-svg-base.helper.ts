import { THEME_FILL, THEME_STROKE } from '@devdesigner/shared';

/** Shared pieces of the export SVG builder: theme colors, escaping, metrics. */

export const PADDING = 48;

export const RADIUS = 14; // --dd-radius-lg

export const FONT = "'IBM Plex Mono', 'SFMono-Regular', ui-monospace, 'Cascadia Mono', Menlo, monospace";

// Approximate monospace advance widths, used only for placing/truncating text.
export const CW_13 = 7.8;

export const CW_11 = 6.6;

/** Resolved theme colors for one export pass. */
export interface Theme {
   canvasBg: string;
   gridLine: string;
   nodeSurface: string;
   nodeHeader: string;
   nodeBorder: string;
   rowBorder: string;
   text: string;
   textMuted: string;
   primary: string;
   connector: string;
   border: string;
   chipBg: string;
   chipActive: string;
   surface: string;
   borderStrong: string;
}

// Light-theme fallback (matches styles.scss :root) for environments without a
// DOM, e.g. unit tests.
export const FALLBACK_THEME: Theme = {
   canvasBg: '#f2f5f9',
   gridLine: 'rgba(16, 24, 40, 0.05)',
   nodeSurface: '#ffffff',
   nodeHeader: '#f6f8fb',
   nodeBorder: '#e6e9ef',
   rowBorder: '#f0f2f6',
   text: '#131720',
   textMuted: '#667085',
   primary: '#2f6bff',
   connector: '#9aa4b2',
   border: '#e6e9ef',
   chipBg: '#eef1f6',
   chipActive: '#e0ebff',
   surface: '#ffffff',
   borderStrong: '#d0d5dd',
};

// Fixed chip colors that are hard-coded in table-node.component.scss (they do
// not vary with the theme).
export const PK_BG = '#f5a623';

export const PK_TEXT = '#3a2a00';

export const UQ_BG = '#2f6bff';

export const UQ_TEXT = '#ffffff';

/**
 * Resolve a `var(--token)` expression (including aliases like --dd-handle that
 * point at another token) to a concrete rgb() color via a probe element. Returns
 * the fallback if the DOM is unavailable or resolution yields nothing.
 */
export function makeResolver(): (expr: string, fallback: string) => string {
   if (typeof document === 'undefined') {
      return (_expr, fallback) => fallback;
   }
   const probe = document.createElement('span');
   probe.style.position = 'absolute';
   probe.style.visibility = 'hidden';
   probe.style.pointerEvents = 'none';
   document.body.appendChild(probe);
   return (expr: string, fallback: string): string => {
      try {
         probe.style.color = '';
         probe.style.color = expr;
         const value = getComputedStyle(probe).color;
         return value && value !== 'rgba(0, 0, 0, 0)' ? value : fallback;
      } catch {
         return fallback;
      }
   };
}

/** Read the current theme from the live document, falling back to light values. */
export function readTheme(): { theme: Theme; dispose: () => void } {
   if (typeof document === 'undefined') {
      return { theme: FALLBACK_THEME, dispose: () => undefined };
   }
   const resolve = makeResolver();
   const t: Theme = {
      canvasBg: resolve('var(--dd-canvas-bg)', FALLBACK_THEME.canvasBg),
      gridLine: resolve('var(--dd-grid-line)', FALLBACK_THEME.gridLine),
      nodeSurface: resolve('var(--dd-node-surface)', FALLBACK_THEME.nodeSurface),
      nodeHeader: resolve('var(--dd-node-header)', FALLBACK_THEME.nodeHeader),
      nodeBorder: resolve('var(--dd-node-border)', FALLBACK_THEME.nodeBorder),
      rowBorder: resolve('var(--dd-node-row-border)', FALLBACK_THEME.rowBorder),
      text: resolve('var(--dd-text)', FALLBACK_THEME.text),
      textMuted: resolve('var(--dd-text-muted)', FALLBACK_THEME.textMuted),
      primary: resolve('var(--dd-primary)', FALLBACK_THEME.primary),
      connector: resolve('var(--dd-connector)', FALLBACK_THEME.connector),
      border: resolve('var(--dd-border)', FALLBACK_THEME.border),
      chipBg: resolve('var(--dd-chip-bg)', FALLBACK_THEME.chipBg),
      chipActive: resolve('var(--dd-chip-active)', FALLBACK_THEME.chipActive),
      surface: resolve('var(--dd-surface)', FALLBACK_THEME.surface),
      borderStrong: resolve('var(--dd-border-strong)', FALLBACK_THEME.borderStrong),
   };
   return {
      theme: t,
      dispose: () => {
         // Remove any probe elements we appended.
         document.querySelectorAll('span[style*="visibility: hidden"]').forEach((el) => {
            if (el instanceof HTMLElement && el.style.pointerEvents === 'none' && !el.textContent) {
               el.remove();
            }
         });
      },
   };
}

/** Escape the five XML special characters for safe attribute/text content. */
export function esc(value: string): string {
   return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
}

/** Escape any interpolated attribute value (colors, ids, transforms, numbers...). */
export function attr(value: unknown): string {
   return esc(String(value));
}

/** Truncate a label to a character budget, adding an ellipsis when cut. */
export function truncate(text: string, maxChars: number): string {
   if (maxChars <= 0) {
      return '';
   }
   return text.length > maxChars ? `${text.slice(0, Math.max(1, maxChars - 1))}…` : text;
}

/** Resolve the theme color sentinels (surface fill, theme stroke) to this theme's colors. */
export function themed(color: string | undefined, theme: Theme): string | undefined {
   return color === THEME_FILL ? theme.surface : color === THEME_STROKE ? theme.text : color;
}
