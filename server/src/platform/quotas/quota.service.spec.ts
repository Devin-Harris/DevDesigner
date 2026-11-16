import 'reflect-metadata';
import { ForbiddenException, PayloadTooLargeException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Project } from '../../projects/projects/project.entity';
import { TableEntity } from '../../projects/schema/tables/table.entity';
import { ElementEntity } from '../../projects/canvas/elements/element.entity';
import { ProjectImageEntity } from '../../projects/canvas/images/project-image.entity';
import { QuotaService } from './quota.service';

describe('QuotaService', () => {
  let ds: DataSource;

  const service = (overrides: Record<string, number> = {}): QuotaService =>
    new QuotaService(ds, { get: (key: string, fallback: unknown) => overrides[key] ?? fallback } as unknown as ConfigService);

  beforeEach(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [__dirname + '/../../**/*.entity.ts'],
      synchronize: true,
    });
    await ds.initialize();
  });

  afterEach(async () => {
    await ds.destroy();
  });

  const project = async (ownerId: string): Promise<string> =>
    (await ds.getRepository(Project).save({ name: 'p', ownerId, type: 'ERD' } as Partial<Project>)).id;

  const element = (projectId: string): Partial<ElementEntity> => ({
    projectId,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    angle: 0,
    strokeColor: '#000000',
    fillStyle: 'none',
    strokeWidth: 1,
    strokeStyle: 'solid',
    opacity: 100,
    zIndex: 0,
  });

  it('has generous defaults', () => {
    expect(service().limits).toEqual({
      projectsPerOwner: 500,
      tablesPerProject: 5000,
      elementsPerProject: 20000,
      imageBytesPerOwner: 1024 ** 3,
      imageBytesPerProject: 512 * 1024 ** 2,
      importMaxImages: 1000,
    });
  });

  it('caps projects per owner (403), per owner only', async () => {
    const q = service({ QUOTA_PROJECTS_PER_OWNER: 2 });
    await project('guest:a');
    await expect(q.assertCanCreateProjects('guest:a')).resolves.toBeUndefined();
    await project('guest:a');
    await expect(q.assertCanCreateProjects('guest:a')).rejects.toThrow(ForbiddenException);
    await expect(q.assertCanCreateProjects('guest:b')).resolves.toBeUndefined();
    await expect(service({ QUOTA_PROJECTS_PER_OWNER: 0 }).assertCanCreateProjects('guest:a')).resolves.toBeUndefined();
  });

  it('caps tables and elements per project, counting the rows being added', async () => {
    const q = service({ QUOTA_TABLES_PER_PROJECT: 2, QUOTA_ELEMENTS_PER_PROJECT: 3 });
    const p = await project('guest:a');
    await ds.getRepository(TableEntity).save({ projectId: p, name: 't', x: 0, y: 0 } as Partial<TableEntity>);
    await ds.getRepository(ElementEntity).save([element(p), element(p)]);
    await expect(q.assertProjectRoom(p, { tables: 1, elements: 1 })).resolves.toBeUndefined();
    await expect(q.assertProjectRoom(p, { tables: 2 })).rejects.toThrow(/at most 2 tables/);
    await expect(q.assertProjectRoom(p, { elements: 2 })).rejects.toThrow(ForbiddenException);
    // Another project is not affected.
    await expect(q.assertProjectRoom(await project('guest:a'), { elements: 3 })).resolves.toBeUndefined();
  });

  it('caps media bytes per project and per owner (413)', async () => {
    const q = service({ QUOTA_IMAGE_BYTES_PER_PROJECT: 100, QUOTA_IMAGE_BYTES_PER_OWNER: 150 });
    const p1 = await project('guest:a');
    const p2 = await project('guest:a');
    const images = ds.getRepository(ProjectImageEntity);
    await images.save({ projectId: p1, mimeType: 'image/png', data: Buffer.alloc(80), sha256: 'a', byteSize: 80 });
    // A row from before byteSize existed is counted from its blob.
    await images.save({ projectId: p2, mimeType: 'image/png', data: Buffer.alloc(40), sha256: 'b', byteSize: null });
    expect(await q.imageBytes({ ownerId: 'guest:a' })).toBe(120);
    await expect(q.assertImageRoom(p1, 20)).resolves.toBeUndefined();
    await expect(q.assertImageRoom(p1, 21)).rejects.toThrow(PayloadTooLargeException);
    await expect(q.assertImageRoom(p2, 31)).rejects.toThrow(/an account can store/);
    // A project that does not exist yet: only the owner's total applies.
    await expect(q.assertImageRoom(null, 30, 'guest:a')).resolves.toBeUndefined();
    await expect(q.assertImageRoom(null, 31, 'guest:a')).rejects.toThrow(PayloadTooLargeException);
  });

  it('checks an import file against one project worth of room', () => {
    const q = service({ QUOTA_TABLES_PER_PROJECT: 5, QUOTA_IMPORT_MAX_IMAGES: 2 });
    expect(() => q.assertImportFits({ tables: 5, elements: 10, images: 2, imageBytes: 10 })).not.toThrow();
    expect(() => q.assertImportFits({ tables: 6, elements: 0, images: 0, imageBytes: 0 })).toThrow(ForbiddenException);
    expect(() => q.assertImportFits({ tables: 0, elements: 0, images: 3, imageBytes: 0 })).toThrow(PayloadTooLargeException);
  });
});
