import { createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Pseudonymization for analytics (audit 04 §8). Nothing recorded can be turned
 * back into an IP, a guest id or a share token:
 *
 * - IPs: `sha256(dailySalt + ip)`, 16 hex chars. The salt is derived from the
 *   secret and the UTC date and never stored, so hashes rotate every day and
 *   cannot be linked across days (same-day uniques and abuse counts only).
 * - Guest ids and share tokens: HMAC with the secret, stable across days so guest
 *   DAU/retention work; never reversible without the secret.
 * - User agents: browser and OS family only (`chrome/windows`).
 *
 * Without ANALYTICS_SALT_SECRET a random per-process secret is used (fine in dev;
 * in production set it so hashed ids survive restarts).
 */
export class AnalyticsPrivacy {
  private readonly secret: Buffer;
  private saltDay = '';
  private salt = '';

  constructor(secret?: string | null) {
    this.secret = secret ? Buffer.from(secret, 'utf8') : randomBytes(32);
  }

  /** True when no secret was configured (hashes change on every restart). */
  static ephemeral(secret?: string | null): boolean {
    return !secret;
  }

  /** Salted, daily-rotating IP hash (16 hex chars), or null without an IP. */
  ipHash(ip: string | null | undefined, now = Date.now()): string | null {
    if (!ip) return null;
    const day = utcDay(now);
    if (day !== this.saltDay) {
      this.saltDay = day;
      this.salt = createHmac('sha256', this.secret).update(`ip-salt:${day}`).digest('hex');
    }
    return createHash('sha256').update(this.salt).update(normalizeIp(ip)).digest('hex').slice(0, 16);
  }

  /** Stable keyed hash of a guest id or share token (24 hex chars). */
  hashId(kind: 'guest' | 'share', raw: string): string {
    return createHmac('sha256', this.secret).update(`${kind}:${raw}`).digest('hex').slice(0, 24);
  }
}

/** `YYYY-MM-DD` in UTC. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function normalizeIp(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

const BROWSERS: Array<[RegExp, string]> = [
  [/devdesigner-mcp/i, 'mcp'],
  [/bot|crawler|spider|crawling|headless/i, 'bot'],
  [/edg(e|a|ios)?\//i, 'edge'],
  [/opr\/|opera/i, 'opera'],
  [/samsungbrowser/i, 'samsung'],
  [/firefox|fxios/i, 'firefox'],
  [/chrome|crios|chromium/i, 'chrome'],
  [/safari/i, 'safari'],
  [/curl\//i, 'curl'],
  [/node|undici|axios|got\b/i, 'node'],
  [/python/i, 'python'],
  [/postman/i, 'postman'],
];

const SYSTEMS: Array<[RegExp, string]> = [
  [/windows/i, 'windows'],
  [/iphone|ipad|ipod/i, 'ios'],
  [/android/i, 'android'],
  [/mac os|macintosh/i, 'mac'],
  [/cros/i, 'chromeos'],
  [/linux/i, 'linux'],
];

/** Browser and OS family (`chrome/windows`, `mcp/other`), never the raw string. */
export function uaFamily(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1] ?? 'other';
  const os = SYSTEMS.find(([re]) => re.test(ua))?.[1] ?? 'other';
  return `${browser}/${os}`;
}

const MCP_TOOL = /^[a-z][a-z0-9_]{0,47}$/;

/** A well-formed X-MCP-Tool value, else null. */
export function mcpToolOf(value: unknown): string | null {
  return typeof value === 'string' && MCP_TOOL.test(value) ? value : null;
}
