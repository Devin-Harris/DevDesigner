import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { Request, Response } from 'express';
import type { ProjectGraphResponse } from '@devdesigner/shared';
import {
  bumpProjectRevision,
  etagMatches,
  projectGraphTag,
  projectRevision,
  resetProjectRevisionsForTests,
} from './project-revision';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { ProjectsController } from '../projects/projects.controller';
import type { ProjectsService } from '../projects/projects.service';

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
    publisher.emit('p', null, { kind: 'element.deleted', elementId: 'e' });
    expect(projectRevision('p')).toBe(1);
    publisher.emitMany('p', null, [
      { kind: 'element.deleted', elementId: 'e1' },
      { kind: 'element.deleted', elementId: 'e2' },
    ]);
    expect(projectRevision('p')).toBe(2);
    publisher.emitMany('p', null, []);
    expect(projectRevision('p')).toBe(3);
    expect(projectRevision('other')).toBe(0);
  });
});

describe('ProjectsController graph ETag', () => {
  const graph = { project: {}, schema: {}, accessLevel: 'OWNER' } as unknown as ProjectGraphResponse;
  let service: { getGraph: jest.Mock; assertCanRead: jest.Mock };
  let controller: ProjectsController;

  type FakeResponse = Response & { headers: Record<string, string>; code: number };
  function res(): FakeResponse {
    const r = { headers: {}, code: 200 } as unknown as FakeResponse;
    Object.assign(r, {
      setHeader: (k: string, v: string) => ((r.headers[k] = v), r),
      status: (c: number) => ((r.code = c), r),
    });
    return r;
  }
  const req = (etag?: string) => ({ headers: etag ? { 'if-none-match': etag } : {} }) as Request;

  beforeEach(() => {
    resetProjectRevisionsForTests();
    service = {
      getGraph: jest.fn().mockResolvedValue(graph),
      assertCanRead: jest.fn().mockResolvedValue('OWNER'),
    };
    controller = new ProjectsController(service as unknown as ProjectsService);
  });

  it('serves 200 with an ETag, then 304 while nothing changed', async () => {
    const first = res();
    await expect(controller.get('p', 'u', null, req(), first)).resolves.toBe(graph);
    const tag = first.headers.ETag;
    expect(tag).toBe(projectGraphTag('p', 'OWNER'));
    expect(first.headers['Cache-Control']).toBe('private, no-cache');

    const second = res();
    await expect(controller.get('p', 'u', null, req(tag), second)).resolves.toBeUndefined();
    expect(second.code).toBe(304);
    expect(service.getGraph).toHaveBeenCalledTimes(1);
  });

  it('rebuilds after a write to the same project but not to another one', async () => {
    const first = res();
    await controller.get('p', 'u', null, req(), first);
    const tag = first.headers.ETag;

    bumpProjectRevision('other');
    const unaffected = res();
    await controller.get('p', 'u', null, req(tag), unaffected);
    expect(unaffected.code).toBe(304);

    bumpProjectRevision('p');
    const changed = res();
    await expect(controller.get('p', 'u', null, req(tag), changed)).resolves.toBe(graph);
    expect(changed.code).toBe(200);
    expect(changed.headers.ETag).not.toBe(tag);
  });

  it('still authorizes a conditional request', async () => {
    service.assertCanRead.mockRejectedValue(new Error('forbidden'));
    await expect(
      controller.get('p', 'u', null, req(projectGraphTag('p', 'OWNER')), res()),
    ).rejects.toThrow('forbidden');
  });
});
