import type { EventEmitter2 } from '@nestjs/event-emitter';
import {
  bumpProjectRevision,
  etagMatches,
  projectGraphTag,
  projectRevision,
  resetProjectRevisionsForTests,
} from './project-revision';
import { RealtimePublisher } from '../realtime/realtime.publisher';

/**
 * Per-project graph revisions (perf P1.7): a write to one project must not
 * invalidate another project's cached graph, every broadcast mutation bumps its
 * project, and the graph route answers 304 while the caller's tag is current.
 */
describe('project revisions', () => {
  beforeEach(() => resetProjectRevisionsForTests());

  it('is per project', () => {
    const a = projectGraphTag('a', 'OWNER');
    const b = projectGraphTag('b', 'OWNER');
    bumpProjectRevision('a');
    expect(projectGraphTag('a', 'OWNER')).not.toBe(a);
    expect(projectGraphTag('b', 'OWNER')).toBe(b);
  });

  it('includes the access level so owner and guest copies never collide', () => {
    expect(projectGraphTag('a', 'OWNER')).not.toBe(projectGraphTag('a', 'VIEW'));
  });

  it('matches If-None-Match lists and *', () => {
    const tag = projectGraphTag('a', 'EDIT');
    expect(etagMatches(tag, tag)).toBe(true);
    expect(etagMatches(`W/"x", ${tag}`, tag)).toBe(true);
    expect(etagMatches('*', tag)).toBe(true);
    expect(etagMatches('W/"other"', tag)).toBe(false);
    expect(etagMatches(undefined, tag)).toBe(false);
  });

  it('is bumped by every publisher emit, including empty batches', () => {
    const publisher = new RealtimePublisher({ emit: jest.fn() } as unknown as EventEmitter2);
    publisher.emit('p', { kind: 'element.deleted', elementId: 'e' });
    expect(projectRevision('p')).toBe(1);
    publisher.emitMany('p', [
      { kind: 'element.deleted', elementId: 'e1' },
      { kind: 'element.deleted', elementId: 'e2' },
    ]);
    expect(projectRevision('p')).toBe(2);
    publisher.emitMany('p', []);
    expect(projectRevision('p')).toBe(3);
    expect(projectRevision('other')).toBe(0);
  });
});

