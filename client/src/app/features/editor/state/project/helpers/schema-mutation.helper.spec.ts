import type {
   CanvasElementModel,
   ColumnModel,
   IndexModel,
   LifelineModel,
   SchemaModel,
   SchemaMutation,
   SequenceDiagramModel,
   SequenceMessageModel,
   TableModel,
} from '@devdesigner/shared';
import {
   applyRemoteMutations,
   applySchemaMutation,
   clearBindingsTo,
   reorderElementsIn,
} from './schema-mutation.helper';
import { applyItemMoves } from './item-moves.helper';
import { pickKeys, sameValues } from './patch-diff.helper';

// ---- factories ---------------------------------------------------------------------------------

const column = (id: string, name = id): ColumnModel => ({
   id,
   name,
   dataType: { name: 'INT' },
   isPrimaryKey: false,
   isNullable: true,
   isUnique: false,
   isAutoIncrement: false,
});
const index = (id: string, name = id): IndexModel => ({ id, name, columnIds: ['c1'], isUnique: false });
const table = (id: string, columns: ColumnModel[] = [], indexes: IndexModel[] = []): TableModel => ({
   id,
   name: id,
   columns,
   indexes,
   x: 0,
   y: 0,
});
const element = (id: string, zIndex: number, extra: Partial<CanvasElementModel> = {}): CanvasElementModel => ({
   id,
   type: 'rectangle',
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
   zIndex,
   ...extra,
});
const diagram = (id: string): SequenceDiagramModel =>
   ({ id, lifelineSpacing: 200, rowSpacing: 60, headerHeight: 40, originY: 0, zIndex: 0 }) as SequenceDiagramModel;
const lifeline = (id: string, diagramId: string): LifelineModel => ({
   id,
   diagramId,
   label: id,
   x: 0,
   width: 120,
   order: 0,
});
const message = (id: string, diagramId: string, from: string, to: string): SequenceMessageModel => ({
   id,
   diagramId,
   fromLifelineId: from,
   toLifelineId: to,
   y: 0,
   style: 'solid',
   direction: 'forward',
   arrowhead: 'arrow',
});

/** Deep-freeze so any in-place write by a reducer throws. */
function freeze<T>(value: T): T {
   if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      Object.values(value).forEach(freeze);
   }
   return value;
}

const base = (): SchemaModel =>
   freeze({
      tables: [table('t1', [column('c1'), column('c2')], [index('i1'), index('i2')]), table('t2', [column('c3')])],
      relationships: [
         { id: 'r1', sourceColumnId: 'c1', targetColumnId: 'c3', type: 'ONE_TO_MANY' },
         { id: 'r2', sourceColumnId: 'c2', targetColumnId: 'c3', type: 'ONE_TO_MANY' },
      ],
      notes: [],
      elements: [
         element('e1', 0, { startBinding: { targetKind: 'table', targetId: 't1' } }),
         element('e2', 1, { endBinding: { targetKind: 'element', targetId: 'e1' } }),
      ],
      sequenceDiagrams: [diagram('d1'), diagram('d2')],
      lifelines: [lifeline('l1', 'd1'), lifeline('l2', 'd1'), lifeline('l3', 'd2')],
      sequenceMessages: [message('m1', 'd1', 'l1', 'l2'), message('m2', 'd2', 'l3', 'l3')],
      viewport: { x: 0, y: 0, zoom: 1 },
   } as SchemaModel);

const ids = (rows: { id: string }[] | undefined): string[] => (rows ?? []).map((r) => r.id);

// ---- applySchemaMutation -----------------------------------------------------------------------

describe('applySchemaMutation', () => {
   type Case = [SchemaMutation['kind'], SchemaMutation, (s: SchemaModel) => void];
   const cases: Case[] = [
      [
         'table.created',
         { kind: 'table.created', table: table('t3') },
         (s) => expect(ids(s.tables)).toEqual(['t1', 't2', 't3']),
      ],
      [
         'table.updated',
         { kind: 'table.updated', table: { ...table('t1'), name: 'renamed' } },
         (s) => expect(s.tables[0].name).toBe('renamed'),
      ],
      [
         'table.moved',
         { kind: 'table.moved', tableId: 't2', x: 5, y: 6 },
         (s) => expect(s.tables[1]).toMatchObject({ x: 5, y: 6 }),
      ],
      [
         'table.deleted',
         { kind: 'table.deleted', tableId: 't1' },
         (s) => {
            expect(ids(s.tables)).toEqual(['t2']);
            expect(s.relationships).toEqual([]);
            expect(s.elements[0].startBinding).toBeUndefined();
            expect(s.elements[1].endBinding).toEqual({ targetKind: 'element', targetId: 'e1' });
         },
      ],
      [
         'column.created',
         { kind: 'column.created', tableId: 't2', column: column('c4') },
         (s) => expect(ids(s.tables[1].columns)).toEqual(['c3', 'c4']),
      ],
      [
         'column.updated',
         { kind: 'column.updated', tableId: 't1', column: column('c2', 'two') },
         (s) => expect(s.tables[0].columns[1].name).toBe('two'),
      ],
      [
         'column.deleted',
         { kind: 'column.deleted', tableId: 't1', columnId: 'c1' },
         (s) => {
            expect(ids(s.tables[0].columns)).toEqual(['c2']);
            expect(ids(s.relationships)).toEqual(['r2']);
         },
      ],
      [
         'column.reordered',
         { kind: 'column.reordered', tableId: 't1', orderedColumnIds: ['c2', 'gone', 'c1'] },
         (s) => expect(ids(s.tables[0].columns)).toEqual(['c2', 'c1']),
      ],
      [
         'index.created',
         { kind: 'index.created', tableId: 't2', index: index('i3') },
         (s) => expect(ids(s.tables[1].indexes)).toEqual(['i3']),
      ],
      [
         'index.updated',
         { kind: 'index.updated', tableId: 't1', index: index('i1', 'renamed') },
         (s) => expect(s.tables[0].indexes?.[0].name).toBe('renamed'),
      ],
      [
         'index.deleted',
         { kind: 'index.deleted', tableId: 't1', indexId: 'i1' },
         (s) => expect(ids(s.tables[0].indexes)).toEqual(['i2']),
      ],
      [
         'index.reordered',
         { kind: 'index.reordered', tableId: 't1', orderedIndexIds: ['i2', 'i1'] },
         (s) => expect(ids(s.tables[0].indexes)).toEqual(['i2', 'i1']),
      ],
      [
         'relationship.created',
         {
            kind: 'relationship.created',
            relationship: { id: 'r3', sourceColumnId: 'c1', targetColumnId: 'c2', type: 'ONE_TO_ONE' },
         },
         (s) => expect(ids(s.relationships)).toEqual(['r1', 'r2', 'r3']),
      ],
      [
         'relationship.updated',
         {
            kind: 'relationship.updated',
            relationship: { id: 'r1', sourceColumnId: 'c1', targetColumnId: 'c3', type: 'MANY_TO_MANY' },
         },
         (s) => expect(s.relationships[0].type).toBe('MANY_TO_MANY'),
      ],
      [
         'relationship.deleted',
         { kind: 'relationship.deleted', relationshipId: 'r1' },
         (s) => expect(ids(s.relationships)).toEqual(['r2']),
      ],
      [
         'element.created',
         { kind: 'element.created', element: element('e3', 2) },
         (s) => expect(ids(s.elements)).toEqual(['e1', 'e2', 'e3']),
      ],
      [
         'element.updated',
         { kind: 'element.updated', element: element('e1', 5) },
         // A new zIndex restacks: elements draw in array order.
         (s) => expect(ids(s.elements)).toEqual(['e2', 'e1']),
      ],
      [
         'element.moved',
         { kind: 'element.moved', elementId: 'e2', x: 7 },
         (s) => expect(s.elements[1]).toMatchObject({ x: 7, y: 0 }),
      ],
      [
         'element.deleted',
         { kind: 'element.deleted', elementId: 'e1' },
         (s) => {
            expect(ids(s.elements)).toEqual(['e2']);
            expect(s.elements[0].endBinding).toBeUndefined();
         },
      ],
      [
         'element.reordered',
         { kind: 'element.reordered', orderedElementIds: ['e2', 'e1'] },
         (s) =>
            expect(s.elements.map((e) => [e.id, e.zIndex])).toEqual([
               ['e2', 0],
               ['e1', 1],
            ]),
      ],
      [
         'sequenceDiagram.created',
         { kind: 'sequenceDiagram.created', diagram: diagram('d3') },
         (s) => expect(ids(s.sequenceDiagrams)).toEqual(['d1', 'd2', 'd3']),
      ],
      [
         'sequenceDiagram.updated',
         { kind: 'sequenceDiagram.updated', diagram: { ...diagram('d1'), rowSpacing: 99 } },
         (s) => expect(s.sequenceDiagrams[0].rowSpacing).toBe(99),
      ],
      [
         'sequenceDiagram.deleted',
         { kind: 'sequenceDiagram.deleted', diagramId: 'd1' },
         (s) => {
            expect(ids(s.sequenceDiagrams)).toEqual(['d2']);
            expect(ids(s.lifelines)).toEqual(['l3']);
            expect(ids(s.sequenceMessages)).toEqual(['m2']);
         },
      ],
      [
         'lifeline.created',
         { kind: 'lifeline.created', lifeline: lifeline('l4', 'd2') },
         (s) => expect(ids(s.lifelines)).toEqual(['l1', 'l2', 'l3', 'l4']),
      ],
      [
         'lifeline.updated',
         { kind: 'lifeline.updated', lifeline: { ...lifeline('l2', 'd1'), label: 'B' } },
         (s) => expect(s.lifelines[1].label).toBe('B'),
      ],
      ['lifeline.moved', { kind: 'lifeline.moved', lifelineId: 'l1', x: 40 }, (s) => expect(s.lifelines[0].x).toBe(40)],
      [
         'lifeline.deleted',
         { kind: 'lifeline.deleted', lifelineId: 'l1' },
         (s) => {
            expect(ids(s.lifelines)).toEqual(['l2', 'l3']);
            expect(ids(s.sequenceMessages)).toEqual(['m2']);
         },
      ],
      [
         'message.created',
         { kind: 'message.created', message: message('m3', 'd1', 'l2', 'l1') },
         (s) => expect(ids(s.sequenceMessages)).toEqual(['m1', 'm2', 'm3']),
      ],
      [
         'message.updated',
         { kind: 'message.updated', message: { ...message('m1', 'd1', 'l1', 'l2'), label: 'hi' } },
         (s) => expect(s.sequenceMessages[0].label).toBe('hi'),
      ],
      [
         'message.moved',
         { kind: 'message.moved', messageId: 'm2', y: 300 },
         (s) => expect(s.sequenceMessages[1].y).toBe(300),
      ],
      [
         'message.deleted',
         { kind: 'message.deleted', messageId: 'm1' },
         (s) => expect(ids(s.sequenceMessages)).toEqual(['m2']),
      ],
      ['home.updated', { kind: 'home.updated', home: { x: 1, y: 2, zoom: 3 } }, (s) => expect(s).toBe(s)],
      ['themes.updated', { kind: 'themes.updated', themes: [] }, (s) => expect(s).toBe(s)],
      [
         'table.patched',
         { kind: 'table.patched', tableId: 't1', patch: { name: 'users', x: 9 } },
         (s) => expect(s.tables[0]).toMatchObject({ name: 'users', x: 9, columns: base().tables[0].columns }),
      ],
      [
         'column.patched',
         { kind: 'column.patched', tableId: 't1', columnId: 'c2', patch: { name: 'email' } },
         (s) => expect(s.tables[0].columns.map((c) => c.name)).toEqual(['c1', 'email']),
      ],
      [
         'index.patched',
         { kind: 'index.patched', tableId: 't1', indexId: 'i1', patch: { isUnique: true } },
         (s) => expect(s.tables[0].indexes![0].isUnique).toBe(true),
      ],
      [
         'relationship.patched',
         { kind: 'relationship.patched', relationshipId: 'r2', patch: { type: 'ONE_TO_ONE' } },
         (s) => expect(s.relationships.map((r) => r.type)).toEqual(['ONE_TO_MANY', 'ONE_TO_ONE']),
      ],
      [
         'element.patched',
         { kind: 'element.patched', elementId: 'e1', patch: { zIndex: 5 }, unset: ['startBinding'] },
         (s) => {
            expect(ids(s.elements)).toEqual(['e2', 'e1']);
            expect(s.elements[1].startBinding).toBeUndefined();
         },
      ],
      [
         'sequenceDiagram.patched',
         { kind: 'sequenceDiagram.patched', diagramId: 'd2', patch: { rowSpacing: 90 } },
         (s) => expect(s.sequenceDiagrams[1].rowSpacing).toBe(90),
      ],
      [
         'lifeline.patched',
         { kind: 'lifeline.patched', lifelineId: 'l1', patch: { label: 'API' } },
         (s) => expect(s.lifelines[0].label).toBe('API'),
      ],
      [
         'message.patched',
         { kind: 'message.patched', messageId: 'm1', patch: { label: 'GET' } },
         (s) => expect(s.sequenceMessages[0].label).toBe('GET'),
      ],
   ];

   it('covers every mutation kind', () => {
      // 41 kinds in shared/src/realtime SchemaMutation; update this when a kind is added.
      expect(new Set(cases.map(([kind]) => kind)).size).toBe(41);
   });

   it.each(cases)('%s (without touching the input)', (_kind, mutation, check) => {
      const before = base();
      // `base()` is deep-frozen: an in-place write would throw.
      check(applySchemaMutation(before, mutation));
   });

   it.each<[SchemaMutation['kind'], SchemaMutation]>([
      ['table.created', { kind: 'table.created', table: table('t1') }],
      [
         'relationship.created',
         {
            kind: 'relationship.created',
            relationship: { id: 'r1', sourceColumnId: 'x', targetColumnId: 'y', type: 'ONE_TO_MANY' },
         },
      ],
      ['element.created', { kind: 'element.created', element: element('e1', 9) }],
      ['sequenceDiagram.created', { kind: 'sequenceDiagram.created', diagram: diagram('d1') }],
      ['lifeline.created', { kind: 'lifeline.created', lifeline: lifeline('l1', 'd2') }],
      ['message.created', { kind: 'message.created', message: message('m1', 'd2', 'l3', 'l3') }],
      ['home.updated', { kind: 'home.updated', home: null }],
   ])('returns the same schema for a duplicate %s (echo of a local create) and non-schema kinds', (_k, mutation) => {
      const before = base();
      expect(applySchemaMutation(before, mutation)).toBe(before);
   });
});

// ---- applyRemoteMutations ----------------------------------------------------------------------

describe('applyRemoteMutations', () => {
   const slots = () => ({ schema: base(), home: null, customThemes: [] });

   it('folds a batch into one new schema', () => {
      const start = slots();
      const patch = applyRemoteMutations(start, [
         { kind: 'table.moved', tableId: 't1', x: 1, y: 1 },
         { kind: 'element.deleted', elementId: 'e2' },
      ]);
      expect(Object.keys(patch)).toEqual(['schema']);
      expect(patch.schema!.tables[0]).toMatchObject({ x: 1, y: 1 });
      expect(ids(patch.schema!.elements)).toEqual(['e1']);
   });

   it('returns no schema when nothing changed', () => {
      expect(applyRemoteMutations(slots(), [{ kind: 'table.created', table: table('t1') }])).toEqual({});
   });

   it('routes home and themes into their own slots', () => {
      const theme = { name: 'Dark' } as never;
      const patch = applyRemoteMutations(slots(), [
         { kind: 'home.updated', home: { x: 1, y: 2, zoom: 3 } },
         { kind: 'themes.updated', themes: [theme] },
      ]);
      expect(patch).toEqual({ home: { x: 1, y: 2, zoom: 3 }, customThemes: [theme] });
   });

   it('applies only home/themes before a schema is loaded', () => {
      const patch = applyRemoteMutations({ schema: null, home: null, customThemes: [] }, [
         { kind: 'table.created', table: table('t9') },
         { kind: 'home.updated', home: null },
      ]);
      expect(patch).toEqual({ home: null });
   });
});

// ---- shared row helpers ------------------------------------------------------------------------

describe('schema row helpers', () => {
   it('clearBindingsTo drops only the bindings to that target, keeping other rows as they were', () => {
      const s = base();
      const out = clearBindingsTo(s.elements, 'e1');
      expect(out[0]).toBe(s.elements[0]);
      expect(out[1].endBinding).toBeUndefined();
   });

   it('reorderElementsIn renumbers the named elements and keeps unnamed ones last', () => {
      const s = { ...base(), elements: [element('a', 0), element('b', 1), element('c', 2)] };
      expect(reorderElementsIn(s, ['c', 'a']).elements.map((e) => [e.id, e.zIndex])).toEqual([
         ['c', 0],
         ['a', 1],
         ['b', 1],
      ]);
   });

   it('applyItemMoves keeps rows that did not move by identity', () => {
      const s = base();
      const out = applyItemMoves(s, {
         elements: new Map([
            ['e1', { x: 0, y: 0 }],
            ['e2', { x: 5, y: 5 }],
         ]),
      });
      expect(out.elements[0]).toBe(s.elements[0]);
      expect(out.elements[1]).toMatchObject({ x: 5, y: 5 });
      expect(out.tables).toBe(s.tables);
   });

   it('pickKeys / sameValues compare only the patched keys', () => {
      const before = pickKeys({ a: 1, b: undefined, c: 3 }, ['a', 'b']);
      expect(before).toEqual({ a: 1, b: '' });
      expect(sameValues(before, { a: 1, b: '', c: 9 })).toBe(true);
      expect(sameValues(before, { a: 2, b: '' })).toBe(false);
   });
});
