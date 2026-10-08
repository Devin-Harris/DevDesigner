/**
 * Readable text colors for a custom diagram background (hex). Returns null when
 * the background is unset/unparseable so callers fall back to the theme colors.
 */
export function contrastText(bg: string | undefined): { text: string; muted: string; soft: string } | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((bg ?? '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const lin = (i: number): number => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
  return lum > 0.4
    ? { text: '#0f172a', muted: '#475569', soft: '#334155' }
    : { text: '#f8fafc', muted: '#cbd5e1', soft: '#e2e8f0' };
}
