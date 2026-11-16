import { PROJECT_EXPORT_FORMAT, type ProjectExportFile } from '../dto';
import { planClone } from './clone';
import { ProjectFileError } from './errors';
import { parseProjectExport } from './parser';
import { offsetToAnchor, planImportStacking, remapProjectIds } from './remap';

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

describe('parseProjectExport', () => {
  it('accepts a valid file', () => {
    const parsed = parseProjectExport(sampleFile());
    expect(parsed.name).toBe('Shop');
    expect(parsed.schema.tables).toHaveLength(2);
    expect(parsed.schema.home).toBeNull();
  });

  it('keeps a saved home view', () => {
    const file = sampleFile();
    file.schema.home = { x: 10, y: -20, zoom: 0.5 };
    expect(parseProjectExport(file).schema.home).toEqual({ x: 10, y: -20, zoom: 0.5 });
  });

  it.each([
    ['not an object', 'nope'],
    ['wrong format marker', { ...sampleFile(), format: 'something-else' }],
    ['no marker and no project/schema', { foo: 1 }],
    ['newer version', { ...sampleFile(), version: 99 }],
    ['missing project', { ...sampleFile(), project: undefined }],
    ['blank name', { ...sampleFile(), project: { name: '  ', type: 'ERD' } }],
  ])('rejects %s', (_label, input) => {
    expect(() => parseProjectExport(input)).toThrow(/Invalid project file/);
  });

  it('names the offending field for a bad enum', () => {
    const file = sampleFile();
    (file.schema.elements[0] as unknown as { type: string }).type = 'hexagon';
    expect(() => parseProjectExport(file)).toThrow(/schema\.elements\[0\]\.type/);
  });

  it('accepts a file with no format marker or version', () => {
    const file = sampleFile() as unknown as Record<string, unknown>;
    delete file['format'];
    delete file['version'];
    expect(parseProjectExport(file).schema.tables).toHaveLength(2);
  });

  it('tolerates missing optional arrays', () => {
    const file = sampleFile() as unknown as { schema: Record<string, unknown> };
    delete file.schema['elements'];
    delete file.schema['sequenceDiagrams'];
    expect(parseProjectExport(file).schema.elements).toEqual([]);
  });
});

describe('parseProjectExport options', () => {
  it('throws a ProjectFileError', () => {
    expect(() => parseProjectExport('nope')).toThrow(ProjectFileError);
  });

  it('runs the host check on theme designs', () => {
    const file = sampleFile();
    file.schema.themes = [
      {
        name: 'T',
        colors: {
          background: '#ffffff',
          surface: '#ffffff',
          heading: '#000000',
          text: '#000000',
          muted: '#888888',
          accent1: '#ff0000',
          accent2: '#00ff00',
          accent3: '#0000ff',
          accent4: '#ffff00',
        },
        fonts: { heading: 'Inter', body: 'Inter' },
        master: [],
      } as never,
    ];
    const seen: string[] = [];
    expect(() =>
      parseProjectExport(file, {
        checkThemeDesign: (part, _v, path) => {
          seen.push(part);
          return `${path} is wrong`;
        },
      }),
    ).toThrow('Invalid project file: schema.themes[0].master is wrong.');
    expect(seen).toEqual(['master']);
  });
});

describe('remapProjectIds', () => {
  let n = 0;
  const newId = (): string => `new-${++n}`;
  const plan = (opts = {}) => remapProjectIds(parseProjectExport(sampleFile()).schema, { newId, ...opts });

  it('gives every row a fresh id and rewrites references', () => {
    const out = plan();
    const users = out.tables.find((t) => t.name === 'users')!;
    expect(users.id).not.toBe('t-users');
    expect(out.tables.every((t) => t.groupId === users.groupId && t.groupId !== 'g1')).toBe(true);
    const arrow = out.elements.find((e) => e.type === 'arrow')!;
    const box = out.elements.find((e) => e.type === 'rectangle')!;
    expect(arrow.groupId).toBe(users.groupId);
    expect(arrow.startBinding).toEqual({ targetKind: 'table', targetId: users.id });
    expect(arrow.endBinding).toEqual({ targetKind: 'element', targetId: box.id });
    // The dangling relationship drops; the other points at the new columns.
    expect(out.relationships).toHaveLength(1);
    const userId = out.tables.flatMap((t) => t.columns).find((c) => c.name === 'user_id')!;
    expect(out.relationships[0].sourceColumnId).toBe(userId.id);
    // The index keeps only its surviving column.
    const role = users.columns.find((c) => c.name === 'role')!;
    expect(users.indexes).toEqual([expect.objectContaining({ columnIds: [role.id] })]);
    const [msg] = out.sequenceMessages;
    expect(out.lifelines.map((l) => l.id)).toEqual(expect.arrayContaining([msg.fromLifelineId, msg.toLifelineId]));
    expect(msg.diagramId).toBe(out.sequenceDiagrams[0].id);
  });

  it('shifts every coordinate', () => {
    const out = plan({ dx: 100, dy: 50 });
    expect(out.tables.find((t) => t.name === 'users')!.x).toBe(110);
    expect(out.relationships[0].waypoints).toEqual([{ x: 101, y: 52 }]);
    expect(out.sequenceDiagrams[0].originY).toBe(55);
    expect(out.lifelines[1].x).toBe(300);
    expect(out.sequenceMessages[0].y).toBe(130);
  });

  it('remaps morph lineage as a set and keeps named tags', () => {
    const schema = parseProjectExport(sampleFile()).schema;
    schema.elements[0].morphId = 'lineage-a';
    schema.elements[1].morphId = 'lineage-a';
    const out = remapProjectIds(schema, { newId });
    expect(out.elements[0].morphId).toBe(out.elements[1].morphId);
    expect(out.elements[0].morphId).not.toBe('lineage-a');
    schema.elements[0].morphId = 'tag:hero';
    expect(remapProjectIds(schema, { newId }).elements[0].morphId).toBe('tag:hero');
  });

  it('drops image elements whose file is missing and re-points the rest', () => {
    const schema = parseProjectExport(sampleFile()).schema;
    schema.elements.push(
      { ...schema.elements[0], id: 'img-a', type: 'image', fileId: 'f-a' },
      { ...schema.elements[0], id: 'img-b', type: 'image', fileId: 'f-b' },
    );
    const out = remapProjectIds(schema, { newId, fileOf: (old) => (old === 'f-a' ? 'f-new' : undefined) });
    const images = out.elements.filter((e) => e.type === 'image');
    expect(images.map((e) => e.fileId)).toEqual(['f-new']);
  });

  it('keeps references to existing content with linkExisting', () => {
    const schema = parseProjectExport(sampleFile()).schema;
    schema.elements[1].startBinding = { targetKind: 'table', targetId: 'already-here' };
    schema.elements[0].slideId = 'frame-here';
    const without = remapProjectIds(schema, { newId });
    expect(without.elements[1].startBinding).toBeUndefined();
    const linked = remapProjectIds(schema, {
      newId,
      linkExisting: { elementIds: new Set(['frame-here']), tableIds: new Set(['already-here']) },
    });
    expect(linked.elements[1].startBinding).toEqual({ targetKind: 'table', targetId: 'already-here' });
    expect(linked.elements[0].slideId).toBe('frame-here');
  });
});

describe('planImportStacking', () => {
  const schema = () => parseProjectExport(sampleFile()).schema;

  it('stacks elements above the existing ones', () => {
    expect(planImportStacking(schema().elements, { maxZIndex: 9, slides: [] }).zShift).toBe(9);
    expect(planImportStacking(schema().elements, { maxZIndex: null, slides: [] }).zShift).toBe(-1);
  });

  it('puts slides after the existing ones and renames a taken presentation', () => {
    const els = schema().elements;
    els[0] = { ...els[0], type: 'frame', slide: { order: 0, presentation: 'Deck' } };
    const plan = planImportStacking(els, { slides: [{ order: 4, presentation: 'Deck' }, { order: 2 }] });
    expect(plan.slideShift).toBe(5);
    expect(plan.presentationNames.get('Deck')).toBe('Deck (copy)');
    expect(planImportStacking(els, { slides: [{ order: 4, presentation: 'Deck' }] }, true).presentationNames.size).toBe(0);
  });
});

describe('offsetToAnchor', () => {
  it('moves the top-left corner onto the anchor', () => {
    expect(offsetToAnchor(parseProjectExport(sampleFile()).schema, { x: 500, y: 400 })).toEqual({ dx: 500, dy: 400 });
  });

  it('is zero for empty content', () => {
    const empty = parseProjectExport({ ...sampleFile(), schema: { tables: [] } });
    expect(offsetToAnchor(empty.schema, { x: 9, y: 9 })).toEqual({ dx: 0, dy: 0 });
  });
});

describe('planClone', () => {
  it('copies tables, relationships, diagrams and elements under the requested ids', () => {
    const schema = parseProjectExport(sampleFile()).schema;
    const entry = { slideId: null, slide: null, morphId: null, text: null, startBinding: null, endBinding: null };
    const out = planClone(
      schema,
      {
        dx: 10,
        dy: 20,
        tables: [
          {
            sourceId: 't-users',
            id: 'u2',
            slideId: null,
            columns: { 'c-users-id': 'c2', 'c-users-role': 'c3' },
            indexes: { i1: 'i2' },
          },
          { sourceId: 't-orders', id: 'o2', slideId: null, columns: { 'c-orders-user': 'c4' }, indexes: {} },
        ],
        relationships: [{ sourceId: 'r1', id: 'r2' }],
        diagrams: [{ sourceId: 'd1', id: 'd2', slideId: null, lifelines: { l1: 'l3', l2: 'l4' }, messages: { m1: 'm2' } }],
        elements: [
          { ...entry, sourceId: 'e-box', id: 'e2', zIndex: 7 },
          { ...entry, sourceId: 'missing', id: 'e3', zIndex: 8 },
        ],
      },
      () => 'fresh',
    );
    expect(out.tables.map((t) => [t.id, t.x, t.groupId])).toEqual([
      ['u2', 20, undefined],
      ['o2', 310, undefined],
    ]);
    expect(out.tables[0].indexes).toEqual([expect.objectContaining({ id: 'i2', columnIds: ['c3', 'ghost'] })]);
    expect(out.relationships).toEqual([
      expect.objectContaining({ id: 'r2', sourceColumnId: 'c4', targetColumnId: 'c2', waypoints: [{ x: 11, y: 22 }] }),
    ]);
    expect(out.sequenceDiagrams[0]).toMatchObject({ id: 'd2', originY: 25 });
    expect(out.lifelines.map((l) => [l.id, l.diagramId])).toEqual([
      ['l3', 'd2'],
      ['l4', 'd2'],
    ]);
    expect(out.sequenceMessages[0]).toMatchObject({ id: 'm2', fromLifelineId: 'l3', toLifelineId: 'l4', y: 100 });
    expect(out.elements).toHaveLength(1);
    expect(out.elements[0]).toMatchObject({ id: 'e2', x: 10, y: 20, zIndex: 7 });
    // The source is untouched.
    expect(schema.tables).toHaveLength(2);
  });
});
