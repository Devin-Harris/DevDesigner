/**
 * Live frames (`embed` elements): a sandboxed iframe of a URL kept in the
 * element's `text`. Only plain http(s) addresses are ever framed.
 */

// The WHATWG URL global (Node and browsers); shared builds without DOM/node libs.
declare const URL: new (url: string) => { protocol: string; hostname: string; host: string; pathname: string };

/** True for a plain http(s) URL (no javascript:, data:, blob: or whitespace). */
export function isEmbedUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const v = url.trim();
  if (!/^https?:\/\/[^\s]+$/i.test(v)) return false;
  try {
    const u = new URL(v);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
  } catch {
    return false;
  }
}

/**
 * Turn what someone typed into a frameable URL, or null. A bare host gets a
 * scheme: http for local addresses (dev servers rarely have TLS), else https.
 * `localhost:4200`, `127.0.0.1:3000/x` and `example.com` all work.
 */
export function normalizeEmbedUrl(input: string | null | undefined): string | null {
  const v = (input ?? '').trim();
  if (!v) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return isEmbedUrl(v) ? v : null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^[^/:]+:\d/.test(v)) return null; // javascript:, data:, mailto: ...
  const guess = `${isLocalHostName(v.split(/[/:?#]/)[0] ?? '') ? 'http' : 'https'}://${v}`;
  return isEmbedUrl(guess) ? guess : null;
}

/** Hosts that only resolve on the presenter's own machine / network. */
export function isLocalHostName(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.test') ||
    h === '::1' ||
    h === '0.0.0.0' ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

/** True when the URL points at a local / private-network address. */
export function isLocalEmbedUrl(url: string | null | undefined): boolean {
  if (!isEmbedUrl(url)) return false;
  try {
    return isLocalHostName(new URL((url as string).trim()).hostname);
  } catch {
    return false;
  }
}

/** A short label for a URL: host[:port] plus path, without the scheme. */
export function embedLabel(url: string | null | undefined): string {
  if (!isEmbedUrl(url)) return 'No URL yet';
  try {
    const u = new URL((url as string).trim());
    const path = u.pathname === '/' ? '' : u.pathname;
    return `${u.host}${path}`;
  } catch {
    return url as string;
  }
}
