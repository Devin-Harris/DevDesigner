import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EntityProjectResolver } from './entity-project-resolver';
import { Project } from '../../projects/projects/project.entity';
import { TableEntity } from '../../projects/schema/tables/table.entity';
import { ColumnEntity } from '../../projects/schema/columns/column.entity';
import { IndexEntity } from '../../projects/schema/indexes/index.entity';
import { SequenceDiagramEntity } from '../../projects/canvas/sequence/sequence-diagram.entity';
import { LifelineEntity } from '../../projects/canvas/sequence/lifeline.entity';
import type { ConfigService } from '@nestjs/config';
import { AccessCache } from './access-cache';

/** The entity -> project registry against a real (in-memory) SQLite schema. */
describe('EntityProjectResolver', () => {
  let ds: DataSource;
  let resolver: EntityProjectResolver;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [__dirname + '/../../**/*.entity.ts'],
      synchronize: true,
    });
    await ds.initialize();
    resolver = new EntityProjectResolver(ds, new AccessCache({ get: () => 0 } as unknown as ConfigService));
    for (const name of ['A', 'B']) {
      const p = await ds.getRepository(Project).save({ name, ownerId: `owner-${name}` });
      const t = await ds.getRepository(TableEntity).save({ projectId: p.id, name: 't', x: 0, y: 0 });
      const c = await ds
        .getRepository(ColumnEntity)
        .save({ tableId: t.id, name: 'id', dataTypeName: 'INT', orderIndex: 0 });
      const x = await ds
        .getRepository(IndexEntity)
        .save({ tableId: t.id, name: 'ix', columnIdsJson: JSON.stringify([c.id]), orderIndex: 0 });
      const d = await ds.getRepository(SequenceDiagramEntity).save({ projectId: p.id, originY: 0 });
      const l = await ds
        .getRepository(LifelineEntity)
        .save({ projectId: p.id, diagramId: d.id, label: 'L', x: 0 });
      Object.assign(ids, {
        [`project${name}`]: p.id,
        [`table${name}`]: t.id,
        [`column${name}`]: c.id,
        [`index${name}`]: x.id,
        [`lifeline${name}`]: l.id,
      });
    }
  });

  afterAll(async () => {
    await ds.destroy();
  });

  it('maps direct and via-table children to their project', async () => {
    await expect(resolver.projectIdOf('table', ids.tableA)).resolves.toBe(ids.projectA);
    await expect(resolver.projectIdOf('column', ids.columnB)).resolves.toBe(ids.projectB);
    await expect(resolver.projectIdOf('index', ids.indexA)).resolves.toBe(ids.projectA);
    await expect(resolver.projectIdOf('lifeline', ids.lifelineB)).resolves.toBe(ids.projectB);
    await expect(resolver.projectIdOf('project', ids.projectA)).resolves.toBe(ids.projectA);
  });

  it('404s an unknown id', async () => {
    await expect(resolver.projectIdOf('column', 'nope')).rejects.toBeInstanceOf(NotFoundException);
    await expect(resolver.projectIdOf('project', 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists the ids that are missing or belong to another project', async () => {
    await expect(resolver.idsOutsideProject('column', [ids.columnA, ids.columnB, 'nope'], ids.projectA)).resolves.toEqual([
      ids.columnB,
      'nope',
    ]);
    await expect(resolver.idsOutsideProject('lifeline', [ids.lifelineA], ids.projectA)).resolves.toEqual([]);
    await expect(resolver.idsOutsideProject('lifeline', [ids.lifelineA], ids.projectB)).resolves.toEqual([ids.lifelineA]);
    await expect(resolver.idsOutsideProject('table', [], ids.projectB)).resolves.toEqual([]);
  });
});
