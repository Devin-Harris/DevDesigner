import 'reflect-metadata';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DataSource, type Repository } from 'typeorm';
import { ImagesService } from './images.service';
import { ProjectImageEntity } from './project-image.entity';
import { ElementEntity } from '../elements/element.entity';
import { Project } from '../../projects/project.entity';
import { QuotaService } from '../../../platform/quotas/quota.service';
import { FsMediaStore } from './storage/fs-media-store';
import { imageHash } from './image-hash';
import { parseRange } from './images.controller';
import { mediaDirFrom } from './storage/media-config';

const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_1x1, 'base64');
const b64 = (s: string | Buffer): string => Buffer.from(s).toString('base64');

/** validate(): the declared type must match the file's magic bytes; SVG is sanitized. */
describe('ImagesService.validate', () => {
  const service = new ImagesService(
    {} as Repository<ProjectImageEntity>,
    {} as Repository<ElementEntity>,
    {} as QuotaService,
    {} as FsMediaStore,
  );

  it('accepts bytes that match the declared type', () => {
    expect(service.validate('image/png', PNG_1x1).length).toBeGreaterThan(0);
    expect(service.validate('image/svg+xml', b64('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>')).length).toBeGreaterThan(0);
    expect(service.validate('video/webm', b64(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f]))).length).toBe(5);
    expect(service.validate('video/mp4', b64(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom')]))).length).toBe(12);
  });

  it('rejects a text file posing as an image', () => {
    expect(() => service.validate('image/png', b64('-----BEGIN OPENSSH PRIVATE KEY-----\n'))).toThrow(BadRequestException);
  });

  it('rejects a real image declared as another type', () => {
    expect(() => service.validate('image/jpeg', PNG_1x1)).toThrow(BadRequestException);
  });

  it('strips active content from SVG and rejects DTDs', () => {
    const clean = service
      .validate('image/svg+xml', b64('<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script><rect onload="y()"/></svg>'))
      .toString();
    expect(clean).toBe('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
    expect(() =>
      service.validate('image/svg+xml', b64('<!DOCTYPE svg [<!ENTITY a "b">]><svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toThrow(BadRequestException);
  });
});

describe('parseRange', () => {
  it.each([
    [undefined, null],
    ['bytes=0-9', { start: 0, end: 9 }],
    ['bytes=5-', { start: 5, end: 99 }],
    ['bytes=-10', { start: 90, end: 99 }],
    ['bytes=90-500', { start: 90, end: 99 }],
    ['bytes=100-', 'invalid'],
    ['bytes=9-5', 'invalid'],
    ['bytes=0-1,4-5', null],
    ['items=0-1', null],
  ])('%s', (header, expected) => {
    expect(parseRange(header as string | undefined, 100)).toEqual(expected);
  });
});

describe('media store paths', () => {
  it('defaults to a media folder next to the database', () => {
    expect(mediaDirFrom({ DATABASE_PATH: '/data/devdesigner.sqlite' }).replace(/\\/g, '/')).toMatch(/\/data\/media$/);
    expect(mediaDirFrom({ MEDIA_DIR: '/mnt/files', DATABASE_PATH: '/data/x.sqlite' }).replace(/\\/g, '/')).toMatch(/\/mnt\/files$/);
  });
});

describe('ImagesService with the filesystem media store', () => {
  let ds: DataSource;
  let dir: string;
  let store: FsMediaStore;
  let service: ImagesService;
  let projectId: string;
  const config = (over: Record<string, number> = {}) =>
    ({ get: (k: string, d: unknown) => over[k] ?? d }) as unknown as ConfigService;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dd-media-'));
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [__dirname + '/../../../**/*.entity.ts'],
      synchronize: true,
    });
    await ds.initialize();
    store = new FsMediaStore(dir);
    service = new ImagesService(
      ds.getRepository(ProjectImageEntity),
      ds.getRepository(ElementEntity),
      new QuotaService(ds, config()),
      store,
    );
    projectId = (await ds.getRepository(Project).save({ name: 'p', ownerId: 'o', type: 'ERD' } as Partial<Project>)).id;
  });

  afterEach(async () => {
    await ds.destroy();
    rmSync(dir, { recursive: true, force: true });
  });

  it('stores uploads as files by hash, with no blob in SQLite, and dedups', async () => {
    const { id } = await service.upload(projectId, 'image/png', PNG_1x1);
    const row = await ds.getRepository(ProjectImageEntity).findOneByOrFail({ id });
    expect(row).toEqual(expect.objectContaining({ location: 'media', data: null, sha256: imageHash(PNG), byteSize: PNG.length }));
    expect(await store.read(imageHash(PNG))).toEqual(PNG);
    expect((await service.upload(projectId, 'image/png', PNG_1x1)).id).toBe(id);
    expect(await service.source(projectId, id)).toEqual({ mimeType: 'image/png', sha256: imageHash(PNG), size: PNG.length });
  });

  it('moves a legacy blob to the store on first read, only after the file is verified', async () => {
    const repo = ds.getRepository(ProjectImageEntity);
    const legacy = await repo.save({ projectId, mimeType: 'image/png', data: PNG, sha256: null, byteSize: null });
    expect(legacy.location).toBe('db');
    const source = await service.source(projectId, legacy.id);
    expect(source.data).toBeUndefined();
    expect(await store.read(source.sha256)).toEqual(PNG);
    expect(await repo.findOneByOrFail({ id: legacy.id })).toEqual(
      expect.objectContaining({ location: 'media', data: null, sha256: imageHash(PNG), byteSize: PNG.length }),
    );
  });

  it('keeps the blob and serves it when the store cannot take the file', async () => {
    const repo = ds.getRepository(ProjectImageEntity);
    const legacy = await repo.save({ projectId, mimeType: 'image/png', data: PNG, sha256: null, byteSize: null });
    jest.spyOn(store, 'put').mockRejectedValueOnce(new Error('disk full'));
    const source = await service.source(projectId, legacy.id);
    expect(source.data).toEqual(PNG);
    expect(await repo.findOneByOrFail({ id: legacy.id })).toEqual(expect.objectContaining({ location: 'db', data: PNG }));
  });

  it('exports files from the store and from legacy blobs alike', async () => {
    const { id } = await service.upload(projectId, 'image/png', PNG_1x1);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
    const legacy = await ds
      .getRepository(ProjectImageEntity)
      .save({ projectId, mimeType: 'image/svg+xml', data: svg, sha256: null, byteSize: svg.length });
    const el = (fileId: string) => ({
      projectId, type: 'image', fileId, x: 0, y: 0, width: 1, height: 1, angle: 0, strokeColor: '#000000',
      fillStyle: 'none', strokeWidth: 1, strokeStyle: 'solid', opacity: 100, zIndex: 0,
    });
    await ds.getRepository(ElementEntity).save([el(id), el(legacy.id)] as Partial<ElementEntity>[]);
    const files = await service.exportForProject(projectId);
    expect(new Map(files.map((f) => [f.id, f.data]))).toEqual(
      new Map([
        [id, PNG_1x1],
        [legacy.id, svg.toString('base64')],
      ]),
    );
  });

  it('enforces the media quota before writing the file', async () => {
    service = new ImagesService(
      ds.getRepository(ProjectImageEntity),
      ds.getRepository(ElementEntity),
      new QuotaService(ds, config({ QUOTA_IMAGE_BYTES_PER_PROJECT: 10 })),
      store,
    );
    await expect(service.upload(projectId, 'image/png', PNG_1x1)).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(await store.size(imageHash(PNG))).toBeNull();
  });

  it('refuses bytes that do not match their key and lists stored files', async () => {
    await expect(store.put('0'.repeat(64), PNG)).rejects.toThrow(/do not match/);
    await store.put(imageHash(PNG), PNG);
    const listed: string[] = [];
    for await (const f of store.list()) listed.push(f.sha256);
    expect(listed).toEqual([imageHash(PNG)]);
  });
});
