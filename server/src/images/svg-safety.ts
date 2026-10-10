/**
 * Conservative safety check for uploaded SVG documents. Images are only ever
 * displayed through an <image>/<img> reference (the browser's static mode, where
 * scripts never run) and are served sandboxed, but we also refuse documents that
 * carry active content so a stored file is harmless wherever it ends up.
 * Returns a reason string when the SVG must be rejected, or null when it is fine.
 */
export function svgRejectionReason(svg: string): string | null {
  if (!/<svg[\s>]/i.test(svg)) {
    return 'is not an SVG document';
  }
  const checks: [RegExp, string][] = [
    [/<\s*script/i, 'contains a <script> element'],
    [/<\s*foreignObject/i, 'contains a <foreignObject> element'],
    [/<\s*(iframe|object|embed)\b/i, 'contains embedded content'],
    [/<!\s*ENTITY/i, 'declares an XML entity'],
    [/\son[a-z]+\s*=/i, 'contains an event handler attribute'],
    [/javascript\s*:/i, 'contains a javascript: URL'],
    // External references (anything but an in-document #fragment or an inline data: image).
    [
      /(?:href|src)\s*=\s*["']\s*(?!#|data:image\/)[a-z][a-z0-9+.-]*:/i,
      'references an external resource',
    ],
    [
      /url\(\s*["']?\s*(?!#|data:image\/)[a-z][a-z0-9+.-]*:/i,
      'references an external resource',
    ],
    [/@import/i, 'imports an external stylesheet'],
  ];
  for (const [pattern, reason] of checks) {
    if (pattern.test(svg)) {
      return reason;
    }
  }
  return null;
}
