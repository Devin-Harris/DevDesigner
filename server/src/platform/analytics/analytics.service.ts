import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { sanitizeAnalyticsProps, type AnalyticsEventName } from '@devdesigner/shared';
import { OnEvent } from '@nestjs/event-emitter';
import { requestContext } from '../http/request-context';
import { ACCOUNT_DELETED_EVENT, type AccountDeletedEvent } from '../../identity/auth/auth.types';
import type { AnalyticsConfig } from './analytics.config';
import {
  ANALYTICS_SINKS,
  type AnalyticsActor,
  type AnalyticsPrincipal,
  type AnalyticsRow,
  type AnalyticsSink,
  type AnalyticsSource,
  type RequestAnalytics,
} from './analytics.types';
import { AnalyticsPrivacy } from './privacy';

export const ANALYTICS_CONFIG = Symbol('ANALYTICS_CONFIG');

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** What a caller may set on an event; everything else comes from the request context. */
export interface TrackInput {
  name: AnalyticsEventName;
  props?: unknown;
  projectId?: string | null;
  route?: string | null;
  status?: number | null;
  durationMs?: number | null;
  count?: number;
  source?: AnalyticsSource;
  principal?: AnalyticsPrincipal;
  /** Explicit request facts (the request recorder passes its own; else read from ALS). */
  request?: RequestAnalytics;
  ts?: number;
}

/**
 * First-party event capture (audit 04 §4). Capturing is a push onto an in-memory
 * buffer; nothing on a request path waits on analytics:
 *
 * - `track()` adds one row; `count()` adds to a per-minute aggregate keyed by
 *   everything but the count, so a 500-mutation batch becomes a handful of rows.
 * - A timer (10 s) or the buffer reaching 500 rows (deferred with setImmediate,
 *   never inside the triggering request) flushes everything to every sink.
 * - The buffer is bounded (10k rows incl. aggregates): when full, new rows are
 *   dropped and counted, and the count is flushed as an `analytics.dropped` row.
 * - Flushed on shutdown (beforeApplicationShutdown, before TypeORM closes).
 *
 * With ANALYTICS_ENABLED=false every method returns immediately.
 */
@Injectable()
export class AnalyticsService implements OnModuleInit, OnModuleDestroy, BeforeApplicationShutdown {
  private readonly logger = new Logger(AnalyticsService.name);
  readonly privacy: AnalyticsPrivacy;
  readonly enabled: boolean;

  private buffer: AnalyticsRow[] = [];
  private aggregates = new Map<string, AnalyticsRow>();
  private dropped = 0;
  /** Deleted accounts: rows still produced for them (e.g. the deleting request itself) are dropped. */
  private readonly erased = new Set<string>();
  private flushScheduled = false;
  private flushing = false;
  private timer: NodeJS.Timeout | null = null;
  private purgeTimer: NodeJS.Timeout | null = null;
  /** Totals since boot (readiness / tests). */
  readonly stats = { recorded: 0, flushed: 0, dropped: 0, flushes: 0, failures: 0 };

  constructor(
    @Inject(ANALYTICS_CONFIG) readonly config: AnalyticsConfig,
    @Inject(ANALYTICS_SINKS) private readonly sinks: AnalyticsSink[],
  ) {
    this.enabled = config.enabled;
    this.privacy = new AnalyticsPrivacy(config.saltSecret);
  }

  onModuleInit(): void {
    if (!this.enabled) return;
    if (AnalyticsPrivacy.ephemeral(this.config.saltSecret) && process.env['NODE_ENV'] === 'production') {
      this.logger.warn('ANALYTICS_SALT_SECRET is not set: hashed guest/share ids change on every restart.');
    }
    this.timer = setInterval(() => void this.flush(), this.config.flushIntervalMs);
    this.timer.unref?.();
    if (this.config.rawRetentionDays > 0) {
      setImmediate(() => void this.purge());
      this.purgeTimer = setInterval(() => void this.purge(), DAY);
      this.purgeTimer.unref?.();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.purgeTimer) clearInterval(this.purgeTimer);
    this.timer = this.purgeTimer = null;
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.onModuleDestroy();
    await this.flush();
  }

  /** Rows waiting to be flushed (raw + aggregates). */
  get depth(): number {
    return this.buffer.length + this.aggregates.size;
  }

  /** Record one event row. */
  track(input: TrackInput): void {
    if (!this.enabled) return;
    const row = this.toRow(input);
    if (!row || this.isErased(row)) return;
    if (!this.admit()) return;
    this.buffer.push(row);
    this.stats.recorded++;
    this.maybeScheduleFlush();
  }

  /**
   * Add to a per-minute counter: rows that differ only in count are merged until
   * the next flush (`count` on the flushed row is the sum).
   */
  count(input: TrackInput): void {
    if (!this.enabled) return;
    const row = this.toRow(input);
    if (!row || this.isErased(row)) return;
    row.ts = row.ts - (row.ts % MINUTE);
    // Per-request ids would defeat aggregation.
    row.requestId = null;
    const key = [
      row.ts, row.name, row.source, row.actorType, row.actorId, row.tokenId, row.projectId,
      row.route, row.status, row.mcpTool, row.ipHash, row.ua, row.props,
    ].join('\u0001');
    const existing = this.aggregates.get(key);
    if (existing) {
      existing.count += row.count;
      return;
    }
    if (!this.admit()) return;
    this.aggregates.set(key, row);
    this.stats.recorded++;
    this.maybeScheduleFlush();
  }

  /** The actor for a raw principal (ids hashed). */
  actorOf(principal: AnalyticsPrincipal | undefined): AnalyticsActor {
    if (principal?.userId) {
      return principal.tokenId
        ? { actorType: 'token', actorId: principal.userId, tokenId: principal.tokenId }
        : { actorType: 'user', actorId: principal.userId, tokenId: null };
    }
    if (principal?.shareToken) {
      return { actorType: 'share', actorId: this.privacy.hashId('share', principal.shareToken), tokenId: null };
    }
    if (principal?.guestId) {
      return { actorType: 'guest', actorId: this.privacy.hashId('guest', principal.guestId), tokenId: null };
    }
    return { actorType: 'anon', actorId: null, tokenId: null };
  }

  /** Write everything buffered to every sink, as one batch. */
  async flush(): Promise<void> {
    this.flushScheduled = false;
    if (!this.enabled || this.flushing) return;
    if (this.buffer.length === 0 && this.aggregates.size === 0 && this.dropped === 0) return;
    this.flushing = true;
    const rows = this.buffer;
    this.buffer = [];
    for (const row of this.aggregates.values()) rows.push(row);
    this.aggregates = new Map();
    if (this.dropped > 0) {
      rows.push(this.systemRow('analytics.dropped', this.dropped));
      this.dropped = 0;
    }
    try {
      for (const sink of this.sinks) {
        try {
          await sink.write(rows);
        } catch (err) {
          this.stats.failures++;
          this.logger.warn({ err, sink: sink.name, rows: rows.length }, 'Analytics flush failed; rows discarded');
        }
      }
      this.stats.flushed += rows.length;
      this.stats.flushes++;
    } finally {
      this.flushing = false;
    }
    if (this.depth >= this.config.flushAtRows) this.maybeScheduleFlush();
  }

  /**
   * Account deletion (audit 04 §4.6): drop the account's buffered rows and every
   * stored event / active-day row keyed to it. Aggregates (analytics_daily) hold
   * no actor ids and stay.
   */
  @OnEvent(ACCOUNT_DELETED_EVENT, { suppressErrors: false })
  async erase({ userId }: AccountDeletedEvent): Promise<number> {
    if (!this.enabled) return 0;
    this.erased.add(userId);
    this.buffer = this.buffer.filter((row) => row.actorId !== userId);
    for (const [key, row] of this.aggregates) {
      if (row.actorId === userId) this.aggregates.delete(key);
    }
    let removed = 0;
    for (const sink of this.sinks) {
      removed += (await sink.erase?.(userId)) ?? 0;
    }
    return removed;
  }

  /** Purge raw events past retention (daily; aggregates are kept). */
  async purge(now = Date.now()): Promise<number> {
    if (!this.enabled || this.config.rawRetentionDays <= 0) return 0;
    let removed = 0;
    for (const sink of this.sinks) {
      try {
        removed += (await sink.purge?.(now - this.config.rawRetentionDays * DAY)) ?? 0;
      } catch (err) {
        this.logger.warn({ err, sink: sink.name }, 'Analytics purge failed');
      }
    }
    return removed;
  }

  private isErased(row: AnalyticsRow): boolean {
    return row.actorId !== null && this.erased.has(row.actorId);
  }

  private admit(): boolean {
    if (this.depth < this.config.maxBufferRows) return true;
    this.dropped++;
    this.stats.dropped++;
    return false;
  }

  private maybeScheduleFlush(): void {
    if (this.flushScheduled || this.depth < this.config.flushAtRows) return;
    this.flushScheduled = true;
    // Never flush inside the request that filled the buffer.
    setImmediate(() => void this.flush());
  }

  private toRow(input: TrackInput): AnalyticsRow | null {
    const props = sanitizeAnalyticsProps(input.name, input.props);
    if (!props) return null;
    const req = input.request ?? requestContext()?.analytics;
    const actor: AnalyticsActor = input.principal
      ? this.actorOf(input.principal)
      : req
        ? { actorType: req.actorType, actorId: req.actorId, tokenId: req.tokenId }
        : { actorType: 'system', actorId: null, tokenId: null };
    const json = Object.keys(props).length > 0 ? JSON.stringify(props) : null;
    return {
      ts: input.ts ?? Date.now(),
      name: input.name,
      source: input.source ?? req?.source ?? 'server',
      ...actor,
      projectId: input.projectId ?? null,
      route: input.route ? input.route.slice(0, 96) : null,
      status: input.status ?? null,
      durationMs: input.durationMs == null ? null : Math.max(0, Math.round(input.durationMs)),
      count: Math.max(1, Math.floor(input.count ?? 1)),
      props: json,
      mcpTool: req?.mcpTool ?? null,
      ipHash: req?.ipHash ?? null,
      ua: req?.ua ?? null,
      requestId: req?.requestId ?? null,
    };
  }

  private systemRow(name: AnalyticsEventName, count: number): AnalyticsRow {
    return {
      ts: Date.now(),
      name,
      source: 'server',
      actorType: 'system',
      actorId: null,
      tokenId: null,
      projectId: null,
      route: null,
      status: null,
      durationMs: null,
      count,
      props: null,
      mcpTool: null,
      ipHash: null,
      ua: null,
      requestId: null,
    };
  }
}
