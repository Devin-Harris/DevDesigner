import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  PROJECT_MUTATION_EVENT,
  PROJECT_MUTATIONS_EVENT,
  type MutationBatchEvent,
  type MutationEvent,
} from '@devdesigner/shared';
import { requestContext } from '../http/request-context';
import { ActivityTouchService } from './activity-touch.service';
import { TouchThrottle } from './touch-throttle';
import { AnalyticsService } from './analytics.service';
import type { AnalyticsTrackPayload } from './analytics.types';
import { ANALYTICS_TRACK_EVENT } from './track';

const SHARE_OPEN_INTERVAL_MS = 60 * 60_000;

/** The only facts read from a mutation: its kind and, for element payloads, the element type. */
export function mutationDims(mutation: { kind: string } & Record<string, unknown>): {
  kind: string;
  elementType?: string;
} {
  const element = mutation['element'] as { type?: unknown } | undefined;
  return typeof element?.type === 'string' ? { kind: mutation.kind, elementType: element.type } : { kind: mutation.kind };
}

/**
 * Bus listeners. EventEmitter2 delivers synchronously, so these run inside the
 * emitting request's async context: the actor and source come from there and the
 * broadcast payloads stay unchanged (no user ids travel to peers).
 *
 * Mutations are NEVER recorded one row each and never with their payload: each
 * becomes a `+1` on a per-minute `entity.write` counter keyed by project, actor,
 * kind and element type.
 */
@Injectable()
export class AnalyticsListeners {
  private readonly shareOpens = new TouchThrottle(SHARE_OPEN_INTERVAL_MS);

  constructor(
    private readonly analytics: AnalyticsService,
    private readonly activity: ActivityTouchService,
  ) {}

  @OnEvent(PROJECT_MUTATION_EVENT)
  onMutation(event: MutationEvent): void {
    if (!this.analytics.enabled) return;
    this.countWrite(event.projectId, event.mutation as unknown as { kind: string } & Record<string, unknown>);
  }

  @OnEvent(PROJECT_MUTATIONS_EVENT)
  onMutations(event: MutationBatchEvent): void {
    if (!this.analytics.enabled) return;
    for (const mutation of event.mutations) {
      this.countWrite(event.projectId, mutation as unknown as { kind: string } & Record<string, unknown>);
    }
  }

  @OnEvent(ANALYTICS_TRACK_EVENT)
  onTrack(payload: AnalyticsTrackPayload): void {
    if (!this.analytics.enabled) return;
    if (payload.name === 'share.opened') {
      const token = payload.principal?.shareToken;
      const ip = requestContext()?.analytics?.ipHash ?? '';
      // One "use" per link and client per hour (reloads and 304 revalidations do not count).
      if (!token || !this.shareOpens.take(`${token}:${ip}`)) return;
      this.activity.shareLinkUsed(token);
    }
    this.analytics.track({
      name: payload.name,
      props: payload.props,
      projectId: payload.projectId ?? null,
      principal: payload.principal,
      source: payload.source,
    });
  }

  private countWrite(projectId: string, mutation: { kind: string } & Record<string, unknown>): void {
    this.analytics.count({ name: 'entity.write', props: mutationDims(mutation), projectId });
  }
}
