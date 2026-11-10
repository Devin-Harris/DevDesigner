import type { IncomingMessage } from 'node:http';

/**
 * Guards for the realtime gateway (security M-3, L-6; perf S13): origin check,
 * connection caps, payload shape/size checks and per-socket rate limits for the
 * presence relays. Pure helpers so they can be tested without a socket server.
 */

/** Largest socket.io message accepted (the biggest legit one is a ~20 KB selection). */
export const MAX_SOCKET_MESSAGE_BYTES = 64_000;
/** Frames above this are deflated (mutations with text/runs); cursor frames stay raw. */
export const DEFLATE_THRESHOLD_BYTES = 2048;
/** Open sockets allowed from one client IP (tabs, plus headroom for a shared NAT). */
export const MAX_SOCKETS_PER_IP = 50;
/** Open sockets allowed in one project room. */
export const MAX_SOCKETS_PER_PROJECT = 200;
/** How often every open socket's access is re-checked (expired links, sessions). */
export const REAUTHORIZE_INTERVAL_MS = 5 * 60_000;

/** Ids in a selection relay. */
export const MAX_SELECTION_IDS = 500;
export const MAX_RELAY_ID_LENGTH = 64;
/** Canvas coordinates beyond this are nonsense (and would only bloat frames). */
const MAX_COORD = 1e9;

/** Token-bucket budgets per relay event: steady rate per second and burst size. */
export const RELAY_BUDGETS = {
  // The client sends cursors at ~25/s and laser samples at ~30/s.
  cursor: { rate: 30, burst: 60 },
  laser: { rate: 30, burst: 60 },
  selection: { rate: 5, burst: 10 },
  present: { rate: 2, burst: 5 },
} as const;
export type RelayKind = keyof typeof RELAY_BUDGETS;

// --- origin ------------------------------------------------------------------

/** The configured client origins (read at call time, so .env values apply). */
export function allowedOrigins(): string[] {
  return (process.env.CORS_ORIGIN ?? 'http://localhost:4242')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Whether a handshake may proceed. Browsers always send Origin on a websocket
 * upgrade, so a missing one is a non-browser client: nothing outside the browser
 * (the MCP included) uses the socket today, so it is refused. Same-origin
 * deployments (client served by the API host) are allowed even if CORS_ORIGIN
 * does not list that host.
 */
export function isAllowedOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return false;
  if (allowedOrigins().includes(origin)) return true;
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** engine.io `allowRequest`: refuse the handshake from a foreign origin. */
export function allowRealtimeRequest(
  req: IncomingMessage,
  callback: (err: string | null | undefined, success: boolean) => void,
): void {
  const ok = isAllowedOrigin(req.headers.origin, req.headers.host);
  callback(ok ? null : 'origin not allowed', ok);
}

/**
 * The client's IP for connection caps. Behind a proxy (Railway) every socket comes
 * from the proxy, so the right-most X-Forwarded-For entry (the one the proxy added)
 * is used when present; otherwise the socket's own address.
 */
export function clientIp(
  headers: Record<string, string | string[] | undefined>,
  address: string,
): string {
  const xff = headers['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff.join(',') : xff;
  const last = raw
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .pop();
  return last || address;
}

// --- payload shapes ----------------------------------------------------------

function coord(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_COORD;
}

function relayId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_RELAY_ID_LENGTH;
}

function idList(v: unknown): string[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > MAX_SELECTION_IDS || !v.every(relayId)) return null;
  return v as string[];
}

/** A cursor sample `{x, y}`, or null when malformed. */
export function parseCursor(body: unknown): { x: number; y: number } | null {
  const b = body as { x?: unknown; y?: unknown } | null;
  return b && coord(b.x) && coord(b.y) ? { x: b.x, y: b.y } : null;
}

/** A laser sample `{x, y, end?}`, or null when malformed. */
export function parseLaser(body: unknown): { x: number; y: number; end: boolean } | null {
  const b = body as { x?: unknown; y?: unknown; end?: unknown } | null;
  return b && coord(b.x) && coord(b.y) ? { x: b.x, y: b.y, end: b.end === true } : null;
}

/** A selection `{tableIds, relationshipIds, columnId?}` with capped id lists, or null. */
export function parseSelection(
  body: unknown,
): { tableIds: string[]; relationshipIds: string[]; columnId?: string } | null {
  const b = body as { tableIds?: unknown; relationshipIds?: unknown; columnId?: unknown } | null;
  if (!b || typeof b !== 'object') return null;
  const tableIds = idList(b.tableIds);
  const relationshipIds = idList(b.relationshipIds);
  if (!tableIds || !relationshipIds) return null;
  if (b.columnId !== undefined && b.columnId !== null && !relayId(b.columnId)) return null;
  return {
    tableIds,
    relationshipIds,
    ...(typeof b.columnId === 'string' ? { columnId: b.columnId } : {}),
  };
}

/** A presenting state `{frameId|null, step?}`, or null when malformed. */
export function parsePresent(body: unknown): { frameId: string | null; step: number } | null {
  const b = body as { frameId?: unknown; step?: unknown } | null;
  if (!b || typeof b !== 'object') return null;
  if (b.frameId !== null && b.frameId !== undefined && !relayId(b.frameId)) return null;
  const step = Number.isInteger(b.step) ? Math.max(0, Math.min(50, b.step as number)) : 0;
  return { frameId: typeof b.frameId === 'string' ? b.frameId : null, step };
}

// --- rate limiting -----------------------------------------------------------

/** A classic token bucket: `rate` tokens per second, holding at most `burst`. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly rate: number,
    private readonly burst: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = burst;
    this.last = now();
  }

  /** Spend one token if there is one. */
  take(): boolean {
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /** Milliseconds until the next token is available (0 when one is). */
  msUntilNext(): number {
    this.refill();
    return this.tokens >= 1 ? 0 : Math.ceil(((1 - this.tokens) / this.rate) * 1000);
  }

  private refill(): void {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.rate);
    this.last = t;
  }
}

/**
 * Per-socket relay limiter. Over budget, a sample is dropped, unless it is state the
 * room must end up with (the latest selection, presenting state, laser release):
 * those are coalesced and the latest one is sent once a token frees up.
 */
export class RelayLimiter {
  private readonly buckets = new Map<RelayKind, TokenBucket>();
  private readonly pending = new Map<RelayKind, () => void>();
  private readonly timers = new Map<RelayKind, NodeJS.Timeout>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Send now if within budget; otherwise drop it, or keep it as the trailing value. */
  relay(kind: RelayKind, send: () => void, trailing: boolean): boolean {
    if (!this.pending.has(kind) && this.bucket(kind).take()) {
      send();
      return true;
    }
    if (trailing) {
      this.pending.set(kind, send);
      this.schedule(kind);
    }
    return false;
  }

  /** Stop any pending trailing sends (socket gone). */
  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
  }

  private schedule(kind: RelayKind): void {
    if (this.timers.has(kind)) return;
    const timer = setTimeout(
      () => {
        this.timers.delete(kind);
        const send = this.pending.get(kind);
        if (!send) return;
        if (this.bucket(kind).take()) {
          this.pending.delete(kind);
          send();
        } else {
          this.schedule(kind);
        }
      },
      Math.max(1, this.bucket(kind).msUntilNext()),
    );
    timer.unref?.();
    this.timers.set(kind, timer);
  }

  private bucket(kind: RelayKind): TokenBucket {
    let bucket = this.buckets.get(kind);
    if (!bucket) {
      const { rate, burst } = RELAY_BUDGETS[kind];
      bucket = new TokenBucket(rate, burst, this.now);
      this.buckets.set(kind, bucket);
    }
    return bucket;
  }
}
