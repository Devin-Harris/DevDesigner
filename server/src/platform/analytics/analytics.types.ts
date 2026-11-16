import type { AnalyticsEventName, AnalyticsProps } from '@devdesigner/shared';

/** Where an event came from. */
export type AnalyticsSource = 'web' | 'mcp' | 'api' | 'server' | 'client';
/** Who caused it (ids are user ids or keyed hashes, never raw guest ids / tokens). */
export type AnalyticsActorType = 'user' | 'token' | 'guest' | 'share' | 'anon' | 'system';

export interface AnalyticsActor {
  actorType: AnalyticsActorType;
  actorId: string | null;
  tokenId: string | null;
}

/**
 * Per-request analytics facts, kept on the shared RequestContext (ALS) so bus
 * listeners running inside the request (mutation events, domain emits) attribute
 * events without any change to the broadcast payloads.
 */
export interface RequestAnalytics extends AnalyticsActor {
  startedAt: number;
  source: AnalyticsSource;
  mcpTool: string | null;
  ipHash: string | null;
  ua: string | null;
  requestId: string | null;
  /** True once the interceptor resolved the actor after the auth guard. */
  resolved: boolean;
}

/** One row as written to analytics_event. */
export interface AnalyticsRow extends AnalyticsActor {
  ts: number;
  name: string;
  source: AnalyticsSource;
  projectId: string | null;
  route: string | null;
  status: number | null;
  durationMs: number | null;
  count: number;
  props: string | null;
  mcpTool: string | null;
  ipHash: string | null;
  ua: string | null;
  requestId: string | null;
}

/**
 * Raw identity of an actor outside an HTTP request (socket, login before the
 * session exists). Hashed by the AnalyticsService; never stored as-is.
 */
export interface AnalyticsPrincipal {
  userId?: string | null;
  tokenId?: string | null;
  guestId?: string | null;
  shareToken?: string | null;
}

/** Payload of {@link ANALYTICS_TRACK_EVENT} on the in-process bus. */
export interface AnalyticsTrackPayload<N extends AnalyticsEventName = AnalyticsEventName> {
  name: N;
  props?: AnalyticsProps<N>;
  projectId?: string | null;
  /** Overrides the request's actor (e.g. the user who just logged in). */
  principal?: AnalyticsPrincipal;
  source?: AnalyticsSource;
}

/** Destination for flushed rows: the analytics DB now, PostHog later (Phase 3b). */
export interface AnalyticsSink {
  readonly name: string;
  /** Persist one flush. May throw; the service logs and moves on. */
  write(rows: AnalyticsRow[]): void | Promise<void>;
  /** Delete raw events older than `beforeTs` (epoch ms); returns rows removed. */
  purge?(beforeTs: number): number | Promise<number>;
  /** Delete every stored row of one actor (account deletion). Returns rows removed. */
  erase?(actorId: string): number | Promise<number>;
}

export const ANALYTICS_SINKS = Symbol('ANALYTICS_SINKS');
