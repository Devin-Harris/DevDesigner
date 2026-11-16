import 'reflect-metadata';
import { gunzipSync } from 'node:zlib';
import { StreamableFile } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { DataSource } from 'typeorm';
import type { ProjectGraphResponse } from '@devdesigner/shared';
import {
  bumpProjectRevision,
  projectGraphTag,
  projectRevision,
  resetProjectRevisionsForTests,
  setRevisionStore,
} from '../http/project-revision';
import { GraphCache } from './graph-cache';
import { sqliteRevisionStore } from './revision-store';
import { ProjectsController } from '../../projects/projects/projects.controller';
import type { ProjectsService } from '../../projects/projects/projects.service';
import { Project } from '../../projects/projects/project.entity';
import { toProjectSummary } from '../../projects/projects/project.mapper';

type FakeResponse = Response & { headers: Record<string, string>; code: number };
function res(): FakeResponse {
  const r = { headers: {}, code: 200 } as unknown as FakeResponse;
  Object.assign(r, {
    setHeader: (k: string, v: string) => ((r.headers[k] = v), r),
    status: (c: number) => ((r.code = c), r),
  });
  return r;
}
const req = (etag?: string, gzip = false) =>
  ({ headers: { ...(etag ? { 'if-none-match': etag } : {}), ...(gzip ? { 'accept-encoding': 'gzip, br' } : {}) } }) as Request;

async function body(file: StreamableFile | undefined): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of file!.getStream()) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

const cacheOf = (max = 64 * 1024 * 1024) =>
  new GraphCache({ get: (_k: string, d: unknown) => (_k === 'GRAPH_CACHE_MAX_BYTES' ? max : d) } as unknown as ConfigService);

describe('ProjectsController graph ETag + graph cache', () => {
  const graph = { project: { name: 'x'.repeat(4000) }, schema: {}, accessLevel: 'OWNER' } as unknown as ProjectGraphResponse;
  let service: { getGraph: jest.Mock };
  const owner = { projectId: 'p', accessLevel: 'OWNER' } as const;
  let cache: GraphCache;
  let controller: ProjectsController;

  beforeEach(() => {
    setRevisionStore(null);
    resetProjectRevisionsForTests();
    service = { getGraph: jest.fn().mockResolvedValue(graph) };
    cache = cacheOf();
    controller = new ProjectsController(service as unknown as ProjectsService, cache);
  });

  it('serves 200 with an ETag, then 304 while nothing changed', async () => {
    const first = res();
    const file = await controller.get(owner, req(), first);
    expect(JSON.parse((await body(file)).toString())).toEqual(graph);
    const tag = first.headers.ETag;
    expect(tag).toBe(projectGraphTag('p', 'OWNER'));
    expect(first.headers['Cache-Control']).toBe('private, no-cache');

    const second = res();
    await expect(controller.get(owner, req(tag), second)).resolves.toBeUndefined();
    expect(second.code).toBe(304);
    expect(service.getGraph).toHaveBeenCalledTimes(1);
  });

  it('serves a repeat 200 (no If-None-Match) from the cache, gzipped once when accepted', async () => {
    await controller.get(owner, req(), res());
    const zipped = res();
    const file = await controller.get(owner, req(undefined, true), zipped);
    expect(zipped.headers['Content-Encoding']).toBe('gzip');
    expect(JSON.parse(gunzipSync(await body(file)).toString())).toEqual(graph);
    await controller.get(owner, req(undefined, true), res());
    expect(service.getGraph).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(1);
  });

  it('rebuilds after a write to the same project but not to another one', async () => {
    const first = res();
    await controller.get(owner, req(), first);
    const tag = first.headers.ETag;

    bumpProjectRevision('other');
    const unaffected = res();
    await controller.get(owner, req(tag), unaffected);
    expect(unaffected.code).toBe(304);

    bumpProjectRevision('p');
    const changed = res();
    await controller.get(owner, req(tag), changed);
    expect(changed.code).toBe(200);
    expect(changed.headers.ETag).not.toBe(tag);
    expect(service.getGraph).toHaveBeenCalledTimes(2);
    // The old revision's body was dropped when the new one was stored.
    expect(cache.size).toBe(1);
  });

  it('keeps owner and view copies apart', async () => {
    await controller.get(owner, req(), res());
    const view = res();
    await controller.get({ projectId: 'p', accessLevel: 'VIEW' }, req(projectGraphTag('p', 'OWNER')), view);
    expect(view.code).toBe(200);
    expect(view.headers.ETag).toBe(projectGraphTag('p', 'VIEW'));
    expect(service.getGraph).toHaveBeenCalledTimes(2);
  });

  it('is bounded by bytes and can be invalidated per project', async () => {
    const small = cacheOf(20_000);
    const c = new ProjectsController(service as unknown as ProjectsService, small);
    for (const id of ['a', 'b', 'c', 'd', 'e']) await c.get({ projectId: id, accessLevel: 'OWNER' }, req(), res());
    expect(small.totalBytes).toBeLessThanOrEqual(20_000);
    expect(small.size).toBeLessThan(5);
    small.invalidateProject('e');
    expect(small.size).toBeLessThan(4);
  });
});

describe('persisted project revisions', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [Project], synchronize: true });
    await ds.initialize();
  });

  afterEach(async () => {
    setRevisionStore(null);
    await ds.destroy();
  });

  const db = () => (ds.driver as unknown as { databaseConnection: Parameters<typeof sqliteRevisionStore>[0] }).databaseConnection;

  it('bumps the column, survives a restart and shows on the summary', async () => {
    const p = await ds.getRepository(Project).save({ name: 'p', ownerId: 'u', type: 'ERD' } as Partial<Project>);
    setRevisionStore(sqliteRevisionStore(db()));
    const tagBefore = projectGraphTag(p.id, 'OWNER');
    expect(bumpProjectRevision(p.id)).toBe(1);
    expect(bumpProjectRevision(p.id)).toBe(2);
    const tag = projectGraphTag(p.id, 'OWNER');
    expect(tag).not.toBe(tagBefore);

    // "Restart": a new store and empty in-memory counters read the persisted value.
    setRevisionStore(sqliteRevisionStore(db()));
    expect(projectRevision(p.id)).toBe(2);
    expect(projectGraphTag(p.id, 'OWNER')).toBe(tag);

    const row = await ds.getRepository(Project).findOneByOrFail({ id: p.id });
    expect(row.revision).toBe(2);
    expect(toProjectSummary(row).revision).toBe(2);
    expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(p.updatedAt.getTime());
  });

  it('never reuses a revision even if the stored one lags', async () => {
    const p = await ds.getRepository(Project).save({ name: 'p', ownerId: 'u', type: 'ERD' } as Partial<Project>);
    setRevisionStore(sqliteRevisionStore(db()));
    bumpProjectRevision(p.id);
    bumpProjectRevision(p.id);
    await ds.query('UPDATE projects SET revision = 0 WHERE id = ?', [p.id]);
    expect(bumpProjectRevision(p.id)).toBe(3);
  });
});
