import 'reflect-metadata';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { applyModelPatch, type RealtimeMutation } from '@devdesigner/shared';
import type { AccessService } from '../../collaboration/access/access.service';
import type { RealtimePublisher } from '../../platform/realtime/realtime.publisher';
import { Project } from '../projects/project.entity';
import { TableEntity } from '../schema/tables/table.entity';
import { ColumnEntity } from '../schema/columns/column.entity';
import { IndexEntity } from '../schema/indexes/index.entity';
import { RelationshipEntity } from '../schema/relationships/relationship.entity';
import { ElementEntity } from '../canvas/elements/element.entity';
import { toElementModel } from '../canvas/elements/element.mapper';
import { clientId } from '../common/client-id';
import { BatchService } from './batch.service';
import { batchResult } from './batch-ack';

describe('BatchService', () => {
  let ds: DataSource;
  let emitted: RealtimeMutation[][];
  const ids: Record<string, string> = {};

  const service = (patches: boolean): BatchService =>
    new BatchService(
      ds,
      { assertRefsInProject: jest.fn().mockResolvedValue(undefined) } as unknown as AccessService,
      { emitMany: (_p: string, m: RealtimeMutation[]) => emitted.push(m) } as unknown as RealtimePublisher,
      { get: (k: string, d: unknown) => (k === 'REALTIME_PATCH_MUTATIONS' ? String(patches) : d) } as unknown as ConfigService,
    );

  beforeEach(async () => {
    emitted = [];
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [__dirname + '/../../**/*.entity.ts'],
      synchronize: true,
    });
    await ds.initialize();
    for (const name of ['A', 'B']) {
      const p = await ds.getRepository(Project).save({ name, ownerId: `owner-${name}`, type: 'ERD' } as Partial<Project>);
      const t = await ds.getRepository(TableEntity).save({ projectId: p.id, name: 'users', x: 0, y: 0 } as Partial<TableEntity>);
      const c1 = await ds.getRepository(ColumnEntity).save({ tableId: t.id, name: 'id', dataTypeName: 'INT', orderIndex: 0 } as Partial<ColumnEntity>);
      const c2 = await ds.getRepository(ColumnEntity).save({ tableId: t.id, name: 'ref', dataTypeName: 'INT', orderIndex: 1 } as Partial<ColumnEntity>);
      const ix = await ds
        .getRepository(IndexEntity)
        .save({ tableId: t.id, name: 'ix', columnIdsJson: JSON.stringify([c1.id]), orderIndex: 0 } as Partial<IndexEntity>);
      const r = await ds.getRepository(RelationshipEntity).save({
        projectId: p.id,
        sourceColumnId: c1.id,
        targetColumnId: c2.id,
        type: 'ONE_TO_MANY',
      } as Partial<RelationshipEntity>);
      const e = await ds.getRepository(ElementEntity).save({
        projectId: p.id,
        type: 'text',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        angle: 0,
        strokeColor: '#000000',
        fillStyle: 'none',
        strokeWidth: 1,
        strokeStyle: 'solid',
        opacity: 100,
        zIndex: 0,
        text: 'a long text that must not travel with a move',
      } as Partial<ElementEntity>);
      Object.assign(ids, { [`p${name}`]: p.id, [`t${name}`]: t.id, [`c${name}`]: c1.id, [`c2${name}`]: c2.id, [`ix${name}`]: ix.id, [`r${name}`]: r.id, [`e${name}`]: e.id });
    }
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('broadcasts full models by default (REALTIME_PATCH_MUTATIONS off)', async () => {
    const { mutations } = await service(false).apply(ids.pA, { elements: [{ id: ids.eA, x: 5 }] });
    expect(mutations).toEqual([{ kind: 'element.updated', element: expect.objectContaining({ id: ids.eA, x: 5, text: expect.any(String) }) }]);
    expect((await ds.getRepository(ElementEntity).findOneByOrFail({ id: ids.eA })).x).toBe(5);
  });

  it('broadcasts only the changed fields with patch mutations on, and nothing for no-op patches', async () => {
    const before = toElementModel(await ds.getRepository(ElementEntity).findOneByOrFail({ id: ids.eA }));
    const { mutations } = await service(true).apply(ids.pA, {
      elements: [{ id: ids.eA, x: 7, y: 0 }],
      tables: [{ id: ids.tA, x: 0 }],
    });
    expect(mutations).toEqual([{ kind: 'element.patched', elementId: ids.eA, patch: { x: 7 } }]);
    expect(emitted).toEqual([mutations]);
    const after = toElementModel(await ds.getRepository(ElementEntity).findOneByOrFail({ id: ids.eA }));
    const m = mutations[0] as unknown as Extract<RealtimeMutation, { kind: 'element.patched' }>;
    expect(applyModelPatch(before, m)).toEqual(after);
  });

  it('patches columns and indexes as batch sections', async () => {
    const full = await service(false).apply(ids.pA, {
      columns: [{ id: ids.cA, name: 'pk', dataType: { name: 'BIGINT' } }],
      indexes: [{ id: ids.ixA, isUnique: true }],
    });
    expect(full.mutations.map((x) => x.kind)).toEqual(['column.updated', 'index.updated']);
    const patched = await service(true).apply(ids.pA, { columns: [{ id: ids.cA, isNullable: false }] });
    expect(patched.mutations).toEqual([
      { kind: 'column.patched', tableId: ids.tA, columnId: ids.cA, patch: { isNullable: false } },
    ]);
    const col = await ds.getRepository(ColumnEntity).findOneByOrFail({ id: ids.cA });
    expect([col.name, col.dataTypeName, col.isNullable]).toEqual(['pk', 'BIGINT', false]);
  });

  it('refuses columns, indexes and deletes from another project (404)', async () => {
    await expect(service(false).apply(ids.pA, { columns: [{ id: ids.cB, name: 'x' }] })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service(false).apply(ids.pA, { indexes: [{ id: ids.ixB, name: 'x' }] })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service(false).apply(ids.pA, { deletes: { columns: [ids.cB] } })).rejects.toBeInstanceOf(NotFoundException);
    expect(await ds.getRepository(ColumnEntity).existsBy({ id: ids.cB })).toBe(true);
  });

  it('deletes columns and indexes with their table id, cascading relationships', async () => {
    const { mutations } = await service(false).apply(ids.pA, { deletes: { columns: [ids.c2A], indexes: [ids.ixA] } });
    expect(mutations).toEqual([
      { kind: 'index.deleted', tableId: ids.tA, indexId: ids.ixA },
      { kind: 'column.deleted', tableId: ids.tA, columnId: ids.c2A },
    ]);
    expect(await ds.getRepository(RelationshipEntity).existsBy({ id: ids.rA })).toBe(false);
  });

  it('acks patch mutations with their row ids (?return=none)', async () => {
    const result = await service(true).apply(ids.pA, { elements: [{ id: ids.eA, x: 9 }] });
    expect(batchResult(ids.pA, result, true)).toEqual(expect.objectContaining({ ok: true, ids: [ids.eA] }));
  });
});

describe('clientId (optimistic creates)', () => {
  it('accepts a fresh id and refuses (409) one already in use', async () => {
    const ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [__dirname + '/../../**/*.entity.ts'],
      synchronize: true,
    });
    await ds.initialize();
    const repo = ds.getRepository(Project);
    const taken = (await repo.save({ name: 'p', ownerId: 'o', type: 'ERD' } as Partial<Project>)).id;
    await expect(clientId(repo, undefined, 'Project')).resolves.toEqual({});
    await expect(clientId(repo, '6f1c2b6e-0d7a-4c55-9a43-5f0a7a0b9e11', 'Project')).resolves.toEqual({
      id: '6f1c2b6e-0d7a-4c55-9a43-5f0a7a0b9e11',
    });
    await expect(clientId(repo, taken, 'Project')).rejects.toBeInstanceOf(ConflictException);
    await ds.destroy();
  });
});
