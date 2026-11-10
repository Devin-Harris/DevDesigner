import { EventEmitter2 } from '@nestjs/event-emitter';
import { PROJECT_MUTATION_EVENT, PROJECT_MUTATIONS_EVENT, type MutationEvent } from '@devdesigner/shared';
import { runWithRequestContext, type RequestContext } from '../http/request-context';
import type { ActivityTouchService } from './activity-touch.service';
import { analyticsConfig, type AnalyticsConfig } from './analytics.config';
import { AnalyticsListeners } from './analytics.listeners';
import { AnalyticsService } from './analytics.service';
import type { AnalyticsRow, AnalyticsSink, RequestAnalytics } from './analytics.types';
import { TelemetryController } from './telemetry.controller';
import { ANALYTICS_TRACK_EVENT, track } from './track';

class MemorySink implements AnalyticsSink {
  readonly name = 'memory';
  readonly writes: AnalyticsRow[][] = [];
  write(rows: AnalyticsRow[]): void {
    this.writes.push(rows);
  }
  get rows(): AnalyticsRow[] {
    return this.writes.flat();
  }
}

function setup(overrides: Partial<AnalyticsConfig> = {}): { service: AnalyticsService; sink: MemorySink } {
  const sink = new MemorySink();
  const config = { ...analyticsConfig({}), saltSecret: 'test-secret', ...overrides };
  return { service: new AnalyticsService(config, [sink]), sink };
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function requestCtx(overrides: Partial<RequestAnalytics> = {}): RequestContext {
  return {
    requestId: 'req-1',
    userId: 'user-1',
    guestId: null,
    viaShareToken: false,
    clientId: null,
    analytics: {
      startedAt: 0,
      source: 'web',
      mcpTool: null,
      ipHash: 'abcdabcdabcdabcd',
      ua: 'chrome/windows',
      requestId: 'req-1',
      actorType: 'user',
      actorId: 'user-1',
      tokenId: null,
      resolved: true,
      ...overrides,
    },
  };
}

describe('AnalyticsService', () => {
  it('pre-aggregates counters per minute and key', async () => {
    const { service, sink } = setup();
    const at = Date.UTC(2026, 10, 10, 12, 0, 5);
    for (let i = 0; i < 300; i++) {
      service.count({ name: 'entity.write', props: { kind: 'element.moved' }, projectId: 'p1', ts: at + i * 100 });
    }
    service.count({ name: 'entity.write', props: { kind: 'table.moved' }, projectId: 'p1', ts: at });
    service.count({ name: 'entity.write', props: { kind: 'element.moved' }, projectId: 'p2', ts: at });
    // Next minute is a separate row.
    service.count({ name: 'entity.write', props: { kind: 'element.moved' }, projectId: 'p1', ts: at + 60_000 });
    expect(service.depth).toBe(4);
    await service.flush();
    const rows = sink.rows;
    expect(rows).toHaveLength(4);
    const moved = rows.find((r) => r.projectId === 'p1' && r.ts === Date.UTC(2026, 10, 10, 12, 0, 0));
    expect(moved).toMatchObject({ name: 'entity.write', count: 300, props: '{"kind":"element.moved"}' });
    expect(service.depth).toBe(0);
  });

  it('flushes on the size trigger outside the triggering call, all rows in one batch', async () => {
    const { service, sink } = setup({ flushAtRows: 50 });
    for (let i = 0; i < 49; i++) service.track({ name: 'auth.logout' });
    await tick();
    expect(sink.writes).toHaveLength(0);
    service.track({ name: 'auth.logout' });
    // Deferred with setImmediate, never synchronous.
    expect(sink.writes).toHaveLength(0);
    await tick();
    expect(sink.writes).toHaveLength(1);
    expect(sink.writes[0]).toHaveLength(50);
  });

  it('bounds the buffer: drops new rows when full and flushes the drop count', async () => {
    const { service, sink } = setup({ maxBufferRows: 10, flushAtRows: 1_000 });
    for (let i = 0; i < 25; i++) service.track({ name: 'auth.logout' });
    expect(service.depth).toBe(10);
    expect(service.stats.dropped).toBe(15);
    await service.flush();
    expect(sink.rows.filter((r) => r.name === 'auth.logout')).toHaveLength(10);
    expect(sink.rows.find((r) => r.name === 'analytics.dropped')).toMatchObject({ count: 15, actorType: 'system' });
  });

  it('keeps going when a sink throws', async () => {
    const { service, sink } = setup();
    const failing: AnalyticsSink = { name: 'boom', write: () => { throw new Error('disk full'); } };
    const both = new AnalyticsService(service.config, [failing, sink]);
    both.track({ name: 'auth.logout' });
    await both.flush();
    expect(sink.rows).toHaveLength(1);
    expect(both.stats.failures).toBe(1);
  });

  it('records nothing when disabled', async () => {
    const { service, sink } = setup({ enabled: false });
    service.track({ name: 'auth.logout' });
    service.count({ name: 'entity.write', props: { kind: 'table.moved' } });
    await service.flush();
    expect(service.depth).toBe(0);
    expect(sink.writes).toHaveLength(0);
  });

  it('drops unknown event names and props outside the allow-list', async () => {
    const { service, sink } = setup();
    service.track({ name: 'not.an.event' as never });
    service.track({ name: 'project.created', props: { type: 'ERD', name: 'Payroll schema' } });
    await service.flush();
    expect(sink.rows).toHaveLength(1);
    expect(sink.rows[0].props).toBe('{"type":"ERD"}');
  });

  it('attributes events to the request context and hashes raw principals', async () => {
    const { service, sink } = setup();
    runWithRequestContext(requestCtx({ source: 'mcp', mcpTool: 'add_table' }), () => {
      service.track({ name: 'project.deleted', projectId: 'p1' });
      service.track({ name: 'share.opened', principal: { shareToken: 'SECRET_SHARE_TOKEN_123' } });
    });
    service.track({ name: 'auth.signup', principal: { userId: 'u-9' } });
    service.track({ name: 'realtime.joined', principal: { guestId: 'guestAAAAAAAAAAAAAAAA1' }, source: 'web' });
    await service.flush();
    const [deleted, opened, signup, joined] = sink.rows;
    expect(deleted).toMatchObject({ actorType: 'user', actorId: 'user-1', source: 'mcp', mcpTool: 'add_table', ipHash: 'abcdabcdabcdabcd' });
    expect(opened.actorType).toBe('share');
    expect(opened.actorId).toMatch(/^[0-9a-f]{24}$/);
    expect(JSON.stringify(sink.rows)).not.toContain('SECRET_SHARE_TOKEN_123');
    expect(signup).toMatchObject({ actorType: 'user', actorId: 'u-9', source: 'server', ipHash: null });
    expect(joined.actorType).toBe('guest');
    expect(JSON.stringify(sink.rows)).not.toContain('guestAAAAAAAAAAAAAAAA1');
  });
});

describe('AnalyticsListeners', () => {
  const touch = { shareLinkUsed: jest.fn(), userSeen: jest.fn(), projectOpened: jest.fn() };

  function wire(): { emitter: EventEmitter2; sink: MemorySink; service: AnalyticsService } {
    const { service, sink } = setup();
    const listeners = new AnalyticsListeners(service, touch as unknown as ActivityTouchService);
    const emitter = new EventEmitter2();
    emitter.on(PROJECT_MUTATION_EVENT, (e) => listeners.onMutation(e));
    emitter.on(PROJECT_MUTATIONS_EVENT, (e) => listeners.onMutations(e));
    emitter.on(ANALYTICS_TRACK_EVENT, (e) => listeners.onTrack(e));
    return { emitter, sink, service };
  }

  it('never records mutation content: a text mutation becomes a kind/elementType counter', async () => {
    const { emitter, sink, service } = wire();
    const secret = 'Quarterly salaries: Alice 120k';
    const element = { id: 'e1', type: 'text', x: 0, y: 0, width: 10, height: 10, text: secret };
    const event = { projectId: 'p1', originClientId: null, mutation: { kind: 'element.updated', element } };
    runWithRequestContext(requestCtx(), () => {
      emitter.emit(PROJECT_MUTATION_EVENT, event as unknown as MutationEvent);
      emitter.emit(PROJECT_MUTATIONS_EVENT, {
        projectId: 'p1',
        originClientId: null,
        mutations: [
          { kind: 'element.updated', element },
          { kind: 'table.updated', table: { id: 't1', name: 'salaries', columns: [] } },
        ],
      });
    });
    await service.flush();
    const dump = JSON.stringify(sink.rows);
    expect(dump).not.toContain('Quarterly');
    expect(dump).not.toContain('salaries');
    expect(sink.rows).toHaveLength(2);
    expect(sink.rows.find((r) => r.props?.includes('element.updated'))).toMatchObject({
      name: 'entity.write',
      count: 2,
      actorId: 'user-1',
      props: '{"kind":"element.updated","elementType":"text"}',
    });
  });

  it('turns domain emits into rows and counts share-link uses once per client and hour', async () => {
    const { emitter, sink, service } = wire();
    runWithRequestContext(requestCtx({ actorType: 'anon', actorId: null }), () => {
      for (let i = 0; i < 3; i++) {
        track(emitter, 'share.opened', { access: 'VIEW' }, { projectId: 'p1', principal: { shareToken: 'tok' } });
      }
      track(emitter, 'project.created', { type: 'FLOW' }, { projectId: 'p2' });
    });
    await service.flush();
    expect(touch.shareLinkUsed).toHaveBeenCalledTimes(1);
    expect(sink.rows.map((r) => r.name)).toEqual(['share.opened', 'project.created']);
  });
});

describe('TelemetryController', () => {
  it('keeps only allow-listed client events and counts the rest', async () => {
    const { service, sink } = setup();
    const controller = new TelemetryController(service);
    controller.collect({
      events: [
        { name: 'client.export_image', props: { format: 'png', scope: 'slide', title: 'secret deck' } },
        { name: 'auth.signup', props: { method: 'password' } },
        { name: 'client.bogus' },
        null,
      ],
    });
    await service.flush();
    expect(sink.rows.find((r) => r.name === 'client.export_image')).toMatchObject({
      source: 'client',
      props: '{"format":"png","scope":"slide"}',
    });
    expect(sink.rows.some((r) => r.name === 'auth.signup')).toBe(false);
    expect(sink.rows.find((r) => r.name === 'telemetry.rejected')?.count).toBe(3);
  });

  it('rejects a malformed or oversized batch', () => {
    const controller = new TelemetryController(setup().service);
    expect(() => controller.collect({})).toThrow();
    expect(() => controller.collect({ events: Array.from({ length: 21 }, () => ({ name: 'client.laser' })) })).toThrow();
  });
});
