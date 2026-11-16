import { DataSource } from 'typeorm';
import { PROJECT_EXPORT_FORMAT, type ProjectExportFile } from '@devdesigner/shared';
import { buildDataSourceOptions } from '../../platform/database/data-source';
import { ColumnEntity } from '../schema/columns/column.entity';
import { ElementEntity } from '../canvas/elements/element.entity';
import { IndexEntity } from '../schema/indexes/index.entity';
import { RelationshipEntity } from '../schema/relationships/relationship.entity';
import { LifelineEntity } from '../canvas/sequence/lifeline.entity';
import { SequenceMessageEntity } from '../canvas/sequence/sequence-message.entity';
import { TableEntity } from '../schema/tables/table.entity';
import { Project } from '../projects/project.entity';
import { parseProjectExport } from './project-import.parser';
import { offsetToAnchor, writeImportedProject, writeSchemaInto } from './project-import.writer';

function sampleFile(): ProjectExportFile {
  return {
    format: PROJECT_EXPORT_FORMAT,
    version: 1,
    exportedAt: '2026-10-07T00:00:00.000Z',
    project: { name: 'Shop', description: 'demo', type: 'ERD' },
    schema: {
      tables: [
        {
          id: 't-users',
          name: 'users',
          x: 10,
          y: 20,
          groupId: 'g1',
          columns: [
            {
              id: 'c-users-id',
              name: 'id',
              dataType: { name: 'INT' },
              isPrimaryKey: true,
              isNullable: false,
              isUnique: true,
              isAutoIncrement: true,
            },
            {
              id: 'c-users-role',
              name: 'role',
              dataType: { name: 'ENUM', args: ['a', 'b'] },
              isPrimaryKey: false,
              isNullable: true,
              isUnique: false,
              isAutoIncrement: false,
            },
          ],
          indexes: [{ id: 'i1', name: 'idx_role', columnIds: ['c-users-role', 'ghost'], isUnique: false }],
        },
        {
          id: 't-orders',
          name: 'orders',
          x: 300,
          y: 20,
          groupId: 'g1',
          columns: [
            {
              id: 'c-orders-user',
              name: 'user_id',
              dataType: { name: 'INT' },
              isPrimaryKey: false,
              isNullable: false,
              isUnique: false,
              isAutoIncrement: false,
            },
          ],
        },
      ],
      relationships: [
        {
          id: 'r1',
          sourceColumnId: 'c-orders-user',
          targetColumnId: 'c-users-id',
          type: 'ONE_TO_MANY',
          waypoints: [{ x: 1, y: 2 }],
        },
        { id: 'r-dangling', sourceColumnId: 'nope', targetColumnId: 'c-users-id', type: 'ONE_TO_ONE' },
      ],
      notes: [],
      elements: [
        {
          id: 'e-box',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 50,
          height: 50,
          angle: 0,
          strokeColor: '#000',
          fillStyle: 'none',
          strokeWidth: 2,
          strokeStyle: 'solid',
          opacity: 100,
          zIndex: 1,
        },
        {
          id: 'e-arrow',
          type: 'arrow',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          angle: 0,
          strokeColor: '#000',
          fillStyle: 'none',
          strokeWidth: 2,
          strokeStyle: 'solid',
          opacity: 100,
          zIndex: 2,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
          ],
          startBinding: { targetKind: 'table', targetId: 't-users' },
          endBinding: { targetKind: 'element', targetId: 'e-box' },
          groupId: 'g1',
        },
      ],
      sequenceDiagrams: [
        { id: 'd1', lifelineSpacing: 160, rowSpacing: 48, headerHeight: 42, originY: 5, zIndex: -1 },
      ],
      lifelines: [
        { id: 'l1', diagramId: 'd1', label: 'A', x: 0, width: 100, order: 0 },
        { id: 'l2', diagramId: 'd1', label: 'B', x: 200, width: 100, order: 1 },
      ],
      sequenceMessages: [
        {
          id: 'm1',
          diagramId: 'd1',
          fromLifelineId: 'l1',
          toLifelineId: 'l2',
          label: 'hi',
          y: 80,
          style: 'solid',
          direction: 'forward',
          arrowhead: 'arrow',
        },
      ],
      viewport: { x: 5, y: 6, zoom: 1.5 },
    },
  };
}

describe('writeImportedProject', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = new DataSource(
      buildDataSourceOptions({ DATABASE_PATH: ':memory:', DATABASE_SYNCHRONIZE: 'true' } as NodeJS.ProcessEnv),
    );
    await ds.initialize();
  });
  afterAll(async () => ds.destroy());

  it('creates a new project with fresh ids and remapped references', async () => {
    const parsed = parseProjectExport(sampleFile());
    const project = await ds.transaction((m) => writeImportedProject(m, parsed, 'user-2'));
    expect(project.ownerId).toBe('user-2');
    expect(project.zoom).toBe(1.5);

    const tables = await ds.getRepository(TableEntity).find({ where: { projectId: project.id } });
    expect(tables.map((t) => t.name).sort()).toEqual(['orders', 'users']);
    expect(tables.map((t) => t.id)).not.toContain('t-users');
    // Group ids share one fresh value across tables/elements.
    const elements = await ds.getRepository(ElementEntity).find({ where: { projectId: project.id } });
    const arrow = elements.find((e) => e.type === 'arrow')!;
    const box = elements.find((e) => e.type === 'rectangle')!;
    expect(tables[0].groupId).toBeTruthy();
    expect(tables[0].groupId).not.toBe('g1');
    expect(arrow.groupId).toBe(tables[0].groupId);

    // Bindings were rewritten to the new ids.
    const users = tables.find((t) => t.name === 'users')!;
    expect(arrow.startBindingId).toBe(users.id);
    expect(arrow.endBindingId).toBe(box.id);
    expect(JSON.parse(arrow.pointsJson!)).toHaveLength(2);

    // Columns, enum args, and the dangling relationship dropped.
    const cols = await ds.getRepository(ColumnEntity).find();
    const role = cols.find((c) => c.name === 'role')!;
    expect(JSON.parse(role.dataTypeArgs!)).toEqual(['a', 'b']);
    const rels = await ds.getRepository(RelationshipEntity).find({ where: { projectId: project.id } });
    expect(rels).toHaveLength(1);
    const userId = cols.find((c) => c.name === 'user_id')!;
    const idCol = cols.find((c) => c.name === 'id')!;
    expect(rels[0].sourceColumnId).toBe(userId.id);
    expect(rels[0].targetColumnId).toBe(idCol.id);

    // Index keeps only the column that exists, remapped.
    const idx = await ds.getRepository(IndexEntity).find();
    expect(JSON.parse(idx[0].columnIdsJson)).toEqual([role.id]);

    // Sequence diagram wiring.
    const lifelines = await ds.getRepository(LifelineEntity).find({ where: { projectId: project.id } });
    const [msg] = await ds.getRepository(SequenceMessageEntity).find({ where: { projectId: project.id } });
    expect(lifelines.map((l) => l.id)).toEqual(expect.arrayContaining([msg.fromLifelineId, msg.toLifelineId]));
  });

  it('keeps the slide sequence and remaps morph lineage consistently', async () => {
    const file = sampleFile();
    const base = file.schema.elements[0];
    const frame = (id: string, order: number, morphId?: string) => ({
      ...base,
      id,
      type: 'frame' as const,
      width: 1280,
      height: 720,
      text: id,
      zIndex: 10 + order,
      slide: {
        order,
        hidden: order === 2,
        notes: `notes ${id}`,
        transition: { type: 'morph' as const, duration: 800, easing: 'ease-in-out' as const },
      },
      morphId,
    });
    file.schema.elements.push(frame('f1', 1), frame('f2', 2, 'lineage-a'), {
      ...base,
      id: 'e-copy',
      morphId: 'lineage-a',
    });
    const parsed = parseProjectExport(file);
    const project = await ds.transaction((m) => writeImportedProject(m, parsed, 'user-3'));
    const rows = await ds.getRepository(ElementEntity).find({ where: { projectId: project.id } });
    const frames = rows.filter((r) => r.type === 'frame');
    expect(frames).toHaveLength(2);
    const second = frames.find((f) => JSON.parse(f.slideJson!).order === 2)!;
    expect(JSON.parse(second.slideJson!)).toMatchObject({
      hidden: true,
      notes: 'notes f2',
      transition: { type: 'morph', duration: 800 },
    });
    // The copy keeps sharing its lineage with the frame, under a fresh id.
    const copy = rows.find((r) => r.morphId && r.type === 'rectangle')!;
    expect(copy.morphId).toBe(second.morphId);
    expect(copy.morphId).not.toBe('lineage-a');
  });

  it('can be imported twice without id collisions', async () => {
    const parsed = parseProjectExport(sampleFile());
    const a = await ds.transaction((m) => writeImportedProject(m, parsed, null));
    const b = await ds.transaction((m) => writeImportedProject(m, parsed, null));
    expect(a.id).not.toBe(b.id);
  });

  it('rolls back everything when the transaction fails', async () => {
    const before = await ds.getRepository(Project).count();
    const parsed = parseProjectExport(sampleFile());
    await expect(
      ds.transaction(async (m) => {
        await writeImportedProject(m, parsed, null);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await ds.getRepository(Project).count()).toBe(before);
  });

  it('merges into an existing project, shifted to the anchor and stacked above its shapes', async () => {
    const parsed = parseProjectExport(sampleFile());
    const target = await ds.transaction((m) => writeImportedProject(m, parsed, null));
    const before = await ds.getRepository(ElementEntity).find({ where: { projectId: target.id } });
    const maxZ = Math.max(...before.map((e) => e.zIndex));

    // Content's top-left is (0,0) (the box); anchor it at (500,400).
    const { dx, dy } = offsetToAnchor(parsed.schema, { x: 500, y: 400 });
    expect({ dx, dy }).toEqual({ dx: 500, dy: 400 });
    const added = await ds.transaction((m) =>
      writeSchemaInto(m, target.id, parsed.schema, { dx, dy, stackAboveExisting: true }),
    );

    // Returned models carry the new ids and shifted positions.
    const users = added.tables.find((t) => t.name === 'users')!;
    expect(users.x).toBe(10 + dx);
    expect(added.relationships).toHaveLength(1);
    expect(added.sequenceDiagrams[0].originY).toBe(5 + dy);
    expect(added.sequenceMessages[0].y).toBe(80 + dy);

    // Project now holds both copies; the new elements sit above the old ones.
    const tables = await ds.getRepository(TableEntity).find({ where: { projectId: target.id } });
    expect(tables).toHaveLength(4);
    expect(tables.map((t) => t.id)).toContain(users.id);
    const after = await ds.getRepository(ElementEntity).find({ where: { projectId: target.id } });
    const newOnes = after.filter((e) => !before.some((b) => b.id === e.id));
    expect(newOnes).toHaveLength(2);
    expect(Math.min(...newOnes.map((e) => e.zIndex))).toBe(maxZ + 1);
  });
});
