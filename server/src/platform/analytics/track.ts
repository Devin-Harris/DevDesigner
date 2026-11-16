import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { AnalyticsEventName, AnalyticsProps } from '@devdesigner/shared';
import type { AnalyticsPrincipal, AnalyticsSource, AnalyticsTrackPayload } from './analytics.types';

/** In-process bus channel for domain analytics events (AnalyticsListeners). */
export const ANALYTICS_TRACK_EVENT = 'analytics.track';

/**
 * Record a domain event: one synchronous bus emit, no awaits, no DB work on the
 * caller's path. Listeners run inside the current request's async context, so
 * the actor, source and IP hash come from there unless `extra.principal` says
 * otherwise. A missing emitter (unit tests constructing services by hand) is a no-op.
 */
export function track<N extends AnalyticsEventName>(
  emitter: EventEmitter2 | null | undefined,
  name: N,
  props?: AnalyticsProps<N>,
  extra?: { projectId?: string | null; principal?: AnalyticsPrincipal; source?: AnalyticsSource },
): void {
  if (!emitter) return;
  const payload: AnalyticsTrackPayload<N> = { name, props, ...extra };
  emitter.emit(ANALYTICS_TRACK_EVENT, payload);
}
