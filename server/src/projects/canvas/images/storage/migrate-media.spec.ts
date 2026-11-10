import 'reflect-metadata';
import { mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { Project } from '../../../projects/project.entity';
import { ProjectImageEntity } from '../project-image.entity';
import { imageHash } from '../image-hash';
import { FsMediaStore } from './fs-media-store';
import { collectMediaGarbage, migrateMedia, type SqliteLike } from './migrate-media';

describe('npm run media:migrate', () => {
  let ds: DataSource;
  let dir: string;
  let store: FsMediaStore;
  let db: SqliteLike;
  let projectId: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dd-migrate-'));
    store = new FsMediaStore(dir);
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [__dirname + '/../../../../**/*.entity.ts'],
      synchronize: true,
    });
    await ds.initialize();
    db = (ds.driver as unknown as { databaseConnection: SqliteLike }).databaseConnection;
    projectId = (await ds.getRepository(Project).save({ name: 'p', ownerId: 'o', type: 'ERD' } as Partial<Project>)).id;
  });

  afterEach(async () => {
    await ds.destroy();
    rmSync(dir, { recursive: true, force: true });
  });

  const blob = (n: number) => Buffer.from(`file-${n}-`.repeat(50));

  it('moves every legacy blob, verified, and clears only those', async () => {
    const repo = ds.getRepository(ProjectImageEntity);
    for (let n = 0; n < 7; n++) await repo.save({ projectId, mimeType: 'image/png', data: blob(n), sha256: null, byteSize: null });
    const report = await migrateMedia(db, store, undefined, 3);
    expect(report).toEqual(expect.objectContaining({ moved: 7, failed: 0 }));
    for (const row of await repo.find()) {
      expect(row).toEqual(expect.objectContaining({ location: 'media', data: null }));
      expect(imageHash(await store.read(row.sha256!))).toBe(row.sha256);
    }
    // Re-running is a no-op.
    expect((await migrateMedia(db, store)).moved).toBe(0);
  });

  it('keeps the blob of a row whose file could not be written, and still finishes', async () => {
    const repo = ds.getRepository(ProjectImageEntity);
    const bad = await repo.save({ projectId, mimeType: 'image/png', data: blob(1), sha256: null, byteSize: null });
    await repo.save({ projectId, mimeType: 'image/png', data: blob(2), sha256: null, byteSize: null });
    const put = store.put.bind(store);
    jest.spyOn(store, 'put').mockImplementation(async (sha, data) => {
      if (sha === imageHash(blob(1))) throw new Error('disk full');
      return put(sha, data);
    });
    const report = await migrateMedia(db, store);
    expect(report).toEqual(expect.objectContaining({ moved: 1, failed: 1 }));
    expect(await repo.findOneByOrFail({ id: bad.id })).toEqual(expect.objectContaining({ location: 'db', data: blob(1) }));
  });

  it('garbage-collects unreferenced files past the grace period only', async () => {
    const repo = ds.getRepository(ProjectImageEntity);
    await repo.save({ projectId, mimeType: 'image/png', data: blob(1), sha256: null, byteSize: null });
    await migrateMedia(db, store);
    const orphanOld = blob(8);
    const orphanNew = blob(9);
    await store.put(imageHash(orphanOld), orphanOld);
    await store.put(imageHash(orphanNew), orphanNew);
    const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    utimesSync(store.pathOf(imageHash(orphanOld)), past, past);
    utimesSync(store.pathOf(imageHash(blob(1))), past, past);
    expect(await collectMediaGarbage(db, store)).toBe(1);
    expect(await store.size(imageHash(orphanOld))).toBeNull();
    expect(await store.size(imageHash(orphanNew))).not.toBeNull();
    expect(await store.size(imageHash(blob(1)))).not.toBeNull();
  });
});
