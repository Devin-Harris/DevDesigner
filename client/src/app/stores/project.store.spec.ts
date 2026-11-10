/**
 * Characterization specs for the CURRENT ProjectStore (cleanliness pass 0.8). They pin today's
 * behavior so the store split (pass 3.3) and the perf work can be checked against it. Only the
 * HTTP-boundary services and MatSnackBar are mocked.
 */
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { patchState, watchState } from '@ngrx/signals';
import { unprotected } from '@ngrx/signals/testing';
import type {
   CanvasElementModel,
   ColumnModel,
   IndexModel,
   LifelineModel,
   RelationshipModel,
   SchemaModel,
   SchemaMutation,
   SequenceDiagramModel,
   SequenceMessageModel,
   TableModel,
} from '@devdesigner/shared';
import { type Observable, Subject, of, throwError } from 'rxjs';
import { ColumnsApiService } from '../core/services/columns-api.service';
import { ElementsApiService } from '../core/services/elements-api.service';
import { IndexesApiService } from '../core/services/indexes-api.service';
import { ProjectsApiService } from '../core/services/projects-api.service';
import { RelationshipsApiService } from '../core/services/relationships-api.service';
import { SequenceApiService } from '../core/services/sequence-api.service';
import { ShareLinksApiService } from '../core/services/share-links-api.service';
import { ShareSessionService } from '../core/services/share-session.service';
import { TablesApiService } from '../core/services/tables-api.service';
import { ProjectStore } from './project.store';

// ---- factories ---------------------------------------------------------------------------------

const column = (id: string, overrides: Partial<ColumnModel> = {}): ColumnModel => ({
   id,
   name: id,
   dataType: { name: 'INT' },
   isPrimaryKey: false,
   isNullable: true,
   isUnique: false,
   isAutoIncrement: false,
   ...overrides,
});

const table = (id: string, overrides: Partial<TableModel> = {}): TableModel => ({
   id,
   name: id,
   columns: [],
   x: 0,
   y: 0,
   ...overrides,
});

const element = (id: string, overrides: Partial<CanvasElementModel> = {}): CanvasElementModel => ({
   id,
   type: 'rectangle' as CanvasElementModel['type'],
   x: 0,
   y: 0,
   width: 100,
   height: 50,
   angle: 0,
   strokeColor: '#000000',
   fillStyle: 'none' as CanvasElementModel['fillStyle'],
   strokeWidth: 2,
   strokeStyle: 'solid' as CanvasElementModel['strokeStyle'],
   opacity: 100,
   zIndex: 0,
   ...overrides,
});

const relationship = (id: string, sourceColumnId: string, targetColumnId: string): RelationshipModel => ({
   id,
   sourceColumnId,
   targetColumnId,
   type: 'ONE_TO_MANY' as RelationshipModel['type'],
});

const diagram = (id: string, overrides: Partial<SequenceDiagramModel> = {}): SequenceDiagramModel =>
   ({
      id,
      lifelineSpacing: 200,
      rowSpacing: 60,
      headerHeight: 40,
      originY: 0,
      zIndex: 0,
      ...overrides,
   }) as SequenceDiagramModel;

const lifeline = (id: string, diagramId: string, overrides: Partial<LifelineModel> = {}): LifelineModel => ({
   id,
   diagramId,
   label: id,
   x: 0,
   width: 120,
   order: 0,
   ...overrides,
});

const message = (id: string, diagramId: string, from: string, to: string, y = 0): SequenceMessageModel => ({
   id,
   diagramId,
   fromLifelineId: from,
   toLifelineId: to,
   y,
   style: 'solid',
   direction: 'forward',
   arrowhead: 'arrow',
});

const schema = (overrides: Partial<SchemaModel> = {}): SchemaModel => ({
   tables: [],
   relationships: [],
   notes: [],
   elements: [],
   sequenceDiagrams: [],
   lifelines: [],
   sequenceMessages: [],
   viewport: { x: 0, y: 0, zoom: 1 },
   ...overrides,
});

// ---- harness -----------------------------------------------------------------------------------

function createStore(start: Partial<SchemaModel> = {}) {
   const api = {
      projects: {
         batch: jest.fn(() => of({})),
         importInto: jest.fn(),
         updateHome: jest.fn(() => of({})),
         updateThemes: jest.fn(() => of({})),
         updateViewport: jest.fn(() => of(undefined)),
         getGraph: jest.fn(),
      },
      tables: { remove: jest.fn((): Observable<unknown> => of(undefined)), update: jest.fn(() => of({})) },
      columns: { remove: jest.fn((): Observable<unknown> => of(undefined)) },
      elements: {
         create: jest.fn((_projectId: string, body: CanvasElementModel) => of(body)),
         remove: jest.fn((): Observable<unknown> => of(undefined)),
         update: jest.fn(() => of({})),
      },
      snackBar: { open: jest.fn() },
   };
   TestBed.configureTestingModule({
      providers: [
         { provide: ProjectsApiService, useValue: api.projects },
         { provide: TablesApiService, useValue: api.tables },
         { provide: ColumnsApiService, useValue: api.columns },
         { provide: IndexesApiService, useValue: {} },
         { provide: RelationshipsApiService, useValue: {} },
         { provide: ElementsApiService, useValue: api.elements },
         { provide: SequenceApiService, useValue: {} },
         { provide: ShareLinksApiService, useValue: {} },
         { provide: ShareSessionService, useValue: { setToken: jest.fn() } },
         { provide: MatSnackBar, useValue: api.snackBar },
      ],
   });
   const store = TestBed.inject(ProjectStore);
   patchState(unprotected(store), { projectId: 'p1', accessMode: 'OWNER', schema: schema(start) });
   return { store, api };
}

/** Let queued promise chains (enqueue -> runSave -> rollback) settle. */
const settle = async (): Promise<void> => {
   for (let i = 0; i < 10; i++) await Promise.resolve();
};

// ---- applyRemote -------------------------------------------------------------------------------

describe('ProjectStore.applyRemote', () => {
   const c1 = column('c1');
   const c2 = column('c2');
   const c3 = column('c3');
   const idx1: IndexModel = { id: 'i1', name: 'i1', columnIds: ['c1'], isUnique: false };
   const idx2: IndexModel = { id: 'i2', name: 'i2', columnIds: ['c2'], isUnique: true };

   const base = (): Partial<SchemaModel> => ({
      tables: [table('t1', { columns: [c1, c2], indexes: [idx1, idx2] }), table('t2', { columns: [c3] })],
      relationships: [relationship('r1', 'c1', 'c3'), relationship('r2', 'c2', 'c3')],
      elements: [
         element('e1', { zIndex: 0, startBinding: { targetKind: 'table', targetId: 't1' } }),
         element('e2', { zIndex: 1, endBinding: { targetKind: 'element', targetId: 'e1' } }),
      ],
      sequenceDiagrams: [diagram('d1'), diagram('d2')],
      lifelines: [lifeline('l1', 'd1'), lifeline('l2', 'd1'), lifeline('l3', 'd2')],
      sequenceMessages: [message('m1', 'd1', 'l1', 'l2'), message('m2', 'd2', 'l3', 'l3')],
   });

   type Case = [SchemaMutation['kind'], SchemaMutation, (s: SchemaModel) => void];
   const cases: Case[] = [
      [
         'table.created',
         { kind: 'table.created', table: table('t3') },
         (s) => expect(s.tables.map((t) => t.id)).toEqual(['t1', 't2', 't3']),
      ],
      [
         'table.updated',
         { kind: 'table.updated', table: table('t1', { name: 'renamed' }) },
         (s) => expect(s.tables[0]).toEqual(table('t1', { name: 'renamed' })),
      ],
      [
         'table.moved',
         { kind: 'table.moved', tableId: 't2', x: 10, y: 20 },
         (s) => expect(s.tables[1]).toMatchObject({ x: 10, y: 20, columns: [c3] }),
      ],
      [
         'table.deleted',
         { kind: 'table.deleted', tableId: 't1' },
         (s) => {
            expect(s.tables.map((t) => t.id)).toEqual(['t2']);
            // Relationships on its columns cascade; arrows bound to it fall back to their points.
            expect(s.relationships).toEqual([]);
            expect(s.elements[0].startBinding).toBeUndefined();
            expect(s.elements[1].endBinding).toEqual({ targetKind: 'element', targetId: 'e1' });
         },
      ],
      [
         'column.created',
         { kind: 'column.created', tableId: 't2', column: column('c4') },
         (s) => expect(s.tables[1].columns.map((c) => c.id)).toEqual(['c3', 'c4']),
      ],
      [
         'column.updated',
         { kind: 'column.updated', tableId: 't1', column: column('c2', { name: 'two' }) },
         (s) => expect(s.tables[0].columns[1].name).toBe('two'),
      ],
      [
         'column.deleted',
         { kind: 'column.deleted', tableId: 't1', columnId: 'c1' },
         (s) => {
            expect(s.tables[0].columns.map((c) => c.id)).toEqual(['c2']);
            expect(s.relationships.map((r) => r.id)).toEqual(['r2']);
         },
      ],
      [
         'column.reordered',
         { kind: 'column.reordered', tableId: 't1', orderedColumnIds: ['c2', 'missing', 'c1'] },
         (s) => expect(s.tables[0].columns.map((c) => c.id)).toEqual(['c2', 'c1']),
      ],
      [
         'index.created',
         { kind: 'index.created', tableId: 't2', index: { id: 'i3', name: 'i3', columnIds: ['c3'], isUnique: false } },
         (s) => expect(s.tables[1].indexes?.map((i) => i.id)).toEqual(['i3']),
      ],
      [
         'index.updated',
         { kind: 'index.updated', tableId: 't1', index: { ...idx1, name: 'renamed' } },
         (s) => expect(s.tables[0].indexes?.[0].name).toBe('renamed'),
      ],
      [
         'index.deleted',
         { kind: 'index.deleted', tableId: 't1', indexId: 'i1' },
         (s) => expect(s.tables[0].indexes?.map((i) => i.id)).toEqual(['i2']),
      ],
      [
         'index.reordered',
         { kind: 'index.reordered', tableId: 't1', orderedIndexIds: ['i2', 'i1'] },
         (s) => expect(s.tables[0].indexes?.map((i) => i.id)).toEqual(['i2', 'i1']),
      ],
      [
         'relationship.created',
         { kind: 'relationship.created', relationship: relationship('r3', 'c3', 'c1') },
         (s) => expect(s.relationships.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']),
      ],
      [
         'relationship.updated',
         { kind: 'relationship.updated', relationship: { ...relationship('r1', 'c1', 'c3'), autoRoute: false } },
         (s) => expect(s.relationships[0].autoRoute).toBe(false),
      ],
      [
         'relationship.deleted',
         { kind: 'relationship.deleted', relationshipId: 'r1' },
         (s) => expect(s.relationships.map((r) => r.id)).toEqual(['r2']),
      ],
      [
         'element.created',
         { kind: 'element.created', element: element('e3') },
         (s) => expect(s.elements.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']),
      ],
      [
         'element.updated',
         { kind: 'element.updated', element: element('e2', { text: 'hi' }) },
         (s) => expect(s.elements[1]).toEqual(element('e2', { text: 'hi' })),
      ],
      [
         'element.moved',
         { kind: 'element.moved', elementId: 'e1', x: 5, points: [{ x: 1, y: 2 }] },
         (s) => expect(s.elements[0]).toMatchObject({ x: 5, y: 0, points: [{ x: 1, y: 2 }] }),
      ],
      [
         'element.deleted',
         { kind: 'element.deleted', elementId: 'e1' },
         (s) => {
            expect(s.elements.map((e) => e.id)).toEqual(['e2']);
            expect(s.elements[0].endBinding).toBeUndefined();
         },
      ],
      [
         'element.reordered',
         { kind: 'element.reordered', orderedElementIds: ['e2'] },
         (s) => {
            // Named elements take their index as zIndex; unnamed ones keep theirs, at the end.
            expect(s.elements.map((e) => [e.id, e.zIndex])).toEqual([
               ['e2', 0],
               ['e1', 0],
            ]);
         },
      ],
      [
         'sequenceDiagram.created',
         { kind: 'sequenceDiagram.created', diagram: diagram('d3') },
         (s) => expect(s.sequenceDiagrams.map((d) => d.id)).toEqual(['d1', 'd2', 'd3']),
      ],
      [
         'sequenceDiagram.updated',
         { kind: 'sequenceDiagram.updated', diagram: diagram('d1', { rowSpacing: 99 }) },
         (s) => expect(s.sequenceDiagrams[0].rowSpacing).toBe(99),
      ],
      [
         'sequenceDiagram.deleted',
         { kind: 'sequenceDiagram.deleted', diagramId: 'd1' },
         (s) => {
            expect(s.sequenceDiagrams.map((d) => d.id)).toEqual(['d2']);
            expect(s.lifelines.map((l) => l.id)).toEqual(['l3']);
            expect(s.sequenceMessages.map((m) => m.id)).toEqual(['m2']);
         },
      ],
      [
         'lifeline.created',
         { kind: 'lifeline.created', lifeline: lifeline('l4', 'd2') },
         (s) => expect(s.lifelines.map((l) => l.id)).toEqual(['l1', 'l2', 'l3', 'l4']),
      ],
      [
         'lifeline.updated',
         { kind: 'lifeline.updated', lifeline: lifeline('l1', 'd1', { label: 'Client' }) },
         (s) => expect(s.lifelines[0].label).toBe('Client'),
      ],
      [
         'lifeline.moved',
         { kind: 'lifeline.moved', lifelineId: 'l2', x: 300 },
         (s) => expect(s.lifelines[1].x).toBe(300),
      ],
      [
         'lifeline.deleted',
         { kind: 'lifeline.deleted', lifelineId: 'l2' },
         (s) => {
            expect(s.lifelines.map((l) => l.id)).toEqual(['l1', 'l3']);
            expect(s.sequenceMessages.map((m) => m.id)).toEqual(['m2']);
         },
      ],
      [
         'message.created',
         { kind: 'message.created', message: message('m3', 'd1', 'l2', 'l1') },
         (s) => expect(s.sequenceMessages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']),
      ],
      [
         'message.updated',
         { kind: 'message.updated', message: { ...message('m1', 'd1', 'l1', 'l2'), label: 'GET' } },
         (s) => expect(s.sequenceMessages[0].label).toBe('GET'),
      ],
      [
         'message.moved',
         { kind: 'message.moved', messageId: 'm1', y: 120 },
         (s) => expect(s.sequenceMessages[0].y).toBe(120),
      ],
      [
         'message.deleted',
         { kind: 'message.deleted', messageId: 'm1' },
         (s) => expect(s.sequenceMessages.map((m) => m.id)).toEqual(['m2']),
      ],
      [
         'home.updated',
         { kind: 'home.updated', home: { x: 1, y: 2, zoom: 3 } },
         (s) => expect(s.home).toEqual({ x: 1, y: 2, zoom: 3 }),
      ],
      ['themes.updated', { kind: 'themes.updated', themes: [] }, (s) => expect(s.themes).toEqual([])],
   ];

   it('has a case for every mutation kind', () => {
      // 33 kinds in shared/src/realtime SchemaMutation; update this when a kind is added.
      expect(new Set(cases.map(([kind]) => kind)).size).toBe(33);
   });

   it.each(cases)('%s', (_kind, mutation, check) => {
      const { store, api } = createStore(base());
      store.applyRemote(mutation);
      // home and themes live in their own state slots (perf P1.1); read them back as schema fields.
      check({ ...store.schema()!, home: store.home(), themes: store.customThemes() });
      // Remote changes are already persisted: no request is ever sent.
      expect(api.projects.batch).not.toHaveBeenCalled();
      expect(api.elements.create).not.toHaveBeenCalled();
   });

   it.each<[string, SchemaMutation, boolean]>([
      ['table.created', { kind: 'table.created', table: table('t1', { name: 'dup' }) }, true],
      ['column.created', { kind: 'column.created', tableId: 't1', column: column('c1', { name: 'dup' }) }, false],
      ['index.created', { kind: 'index.created', tableId: 't1', index: { ...idx1, name: 'dup' } }, false],
      ['relationship.created', { kind: 'relationship.created', relationship: relationship('r1', 'x', 'y') }, true],
      ['element.created', { kind: 'element.created', element: element('e1', { x: 999 }) }, true],
      ['sequenceDiagram.created', { kind: 'sequenceDiagram.created', diagram: diagram('d1', { zIndex: 9 }) }, true],
      ['lifeline.created', { kind: 'lifeline.created', lifeline: lifeline('l1', 'd1', { label: 'dup' }) }, true],
      ['message.created', { kind: 'message.created', message: message('m1', 'd2', 'l3', 'l3', 500) }, true],
   ])('ignores a duplicate %s (echo of a local create)', (_kind, mutation, keepsReference) => {
      const { store } = createStore(base());
      const before = store.schema();
      store.applyRemote(mutation);
      expect(store.schema()).toEqual(before);
      // Current behavior: column/index duplicates go through mapTable, which always replaces the
      // schema object (an extra derived recompute; a candidate for perf phase 1).
      if (keepsReference) expect(store.schema()).toBe(before);
      else expect(store.schema()).not.toBe(before);
   });

   it('ignores updates for rows that do not exist', () => {
      const { store } = createStore(base());
      store.applyRemote({ kind: 'element.updated', element: element('ghost') });
      expect(store.schema()!.elements.map((e) => e.id)).toEqual(['e1', 'e2']);
   });

   it('is a no-op before a schema is loaded', () => {
      const { store } = createStore();
      patchState(unprotected(store), { schema: null });
      store.applyRemote({ kind: 'table.created', table: table('t1') });
      expect(store.schema()).toBeNull();
   });

   it('applyRemoteBatch writes the schema once for many mutations', () => {
      const { store } = createStore(base());
      const before = store.schema();
      const schemaWrites: unknown[] = [];
      // watchState runs synchronously on every patchState, so it counts writes exactly.
      TestBed.runInInjectionContext(() => watchState(store, (state) => schemaWrites.push(state.schema)));
      schemaWrites.length = 0;
      store.applyRemoteBatch([
         { kind: 'table.moved', tableId: 't1', x: 1, y: 1 },
         { kind: 'table.moved', tableId: 't2', x: 2, y: 2 },
         { kind: 'element.deleted', elementId: 'e2' },
      ]);
      expect(schemaWrites).toHaveLength(1);
      expect(store.schema()).not.toBe(before);
      expect(store.schema()!.tables.map((t) => [t.x, t.y])).toEqual([
         [1, 1],
         [2, 2],
      ]);
      expect(store.schema()!.elements.map((e) => e.id)).toEqual(['e1']);
   });

   it('applyRemoteBatch with nothing to change keeps the same schema object', () => {
      const { store } = createStore(base());
      const before = store.schema();
      store.applyRemoteBatch([{ kind: 'table.created', table: table('t1') }]);
      expect(store.schema()).toBe(before);
   });
});

// ---- optimistic saves --------------------------------------------------------------------------

describe('ProjectStore optimistic saves', () => {
   it('deletes an element locally at once, before the request resolves', async () => {
      const { store, api } = createStore({ elements: [element('e1'), element('e2')] });
      const pending = new Subject<void>();
      api.elements.remove.mockReturnValue(pending);
      patchState(unprotected(store), { selectedElementIds: ['e1', 'e2'] });

      await store.deleteElement('e1');

      expect(store.schema()!.elements.map((e) => e.id)).toEqual(['e2']);
      expect(store.selectedElementIds()).toEqual(['e2']);
   });

   it('rolls a failed element delete back to its original position and tells the user', async () => {
      const { store, api } = createStore({
         elements: [
            element('e1'),
            element('e2'),
            element('arrow', { endBinding: { targetKind: 'element', targetId: 'e1' } }),
         ],
      });
      api.elements.remove.mockReturnValue(throwError(() => new Error('500')));

      await store.deleteElement('e1');
      await settle();

      // The element comes back at its old index, and the cascade (cleared binding) is undone too.
      expect(store.schema()!.elements.map((e) => e.id)).toEqual(['e1', 'e2', 'arrow']);
      expect(store.schema()!.elements[2].endBinding).toEqual({ targetKind: 'element', targetId: 'e1' });
      expect(api.snackBar.open).toHaveBeenCalledWith(
         "Couldn't delete the element; the change was reverted.",
         'Dismiss',
         expect.anything()
      );
      expect(store.saveStatus()).toBe('error');
   });

   it('rollback restores only the rows the failed change touched', async () => {
      const { store, api } = createStore({ tables: [table('t1'), table('t2')] });
      api.tables.remove.mockReturnValue(throwError(() => new Error('500')));
      const deleting = store.deleteTable('t1');
      // A remote change to another row lands while the delete is in flight.
      store.applyRemote({ kind: 'table.moved', tableId: 't2', x: 50, y: 60 });
      await deleting;

      expect(store.schema()!.tables.map((t) => [t.id, t.x])).toEqual([
         ['t1', 0],
         ['t2', 50],
      ]);
   });

   it('reports saved after a successful delete', async () => {
      const { store } = createStore({ tables: [table('t1')] });
      await store.deleteTable('t1');
      expect(store.schema()!.tables).toEqual([]);
      expect(store.saveStatus()).toBe('saved');
   });

   describe('staged batch (moves and field edits)', () => {
      beforeEach(() => jest.useFakeTimers());
      afterEach(() => jest.useRealTimers());

      it('restacks locally and sends only the rows whose zIndex changed (P1.9)', async () => {
         const { store, api } = createStore({
            elements: [element('a', { zIndex: 0 }), element('b', { zIndex: 1 }), element('c', { zIndex: 2 })],
         });
         store.reorderElements(['a', 'c', 'b']);
         expect(store.schema()!.elements.map((e) => [e.id, e.zIndex])).toEqual([
            ['a', 0],
            ['c', 1],
            ['b', 2],
         ]);

         await jest.advanceTimersByTimeAsync(400);

         expect(api.projects.batch).toHaveBeenCalledWith('p1', {
            elements: [
               { id: 'c', zIndex: 1 },
               { id: 'b', zIndex: 2 },
            ],
         });
      });

      it('merges rapid moves of a row into one PATCH /batch after 400ms idle', async () => {
         const { store, api } = createStore({ elements: [element('e1')] });
         store.moveElement('e1', 10, 10);
         store.moveElement('e1', 20, 30);
         expect(store.schema()!.elements[0]).toMatchObject({ x: 20, y: 30 });
         expect(api.projects.batch).not.toHaveBeenCalled();

         await jest.advanceTimersByTimeAsync(400);

         expect(api.projects.batch).toHaveBeenCalledTimes(1);
         expect(api.projects.batch).toHaveBeenCalledWith('p1', { elements: [{ id: 'e1', x: 20, y: 30 }] });
      });

      it('rolls every row of a rejected batch back to where the gesture started', async () => {
         const { store, api } = createStore({
            elements: [element('e1', { x: 1, y: 2 })],
            tables: [table('t1', { x: 3, y: 4 })],
         });
         api.projects.batch.mockReturnValue(throwError(() => new Error('409')));
         store.moveElement('e1', 100, 100);
         store.moveElement('e1', 200, 200);
         store.moveTable('t1', 300, 300);

         await jest.advanceTimersByTimeAsync(400);

         expect(store.schema()!.elements[0]).toMatchObject({ x: 1, y: 2 });
         expect(store.schema()!.tables[0]).toMatchObject({ x: 3, y: 4 });
         expect(api.snackBar.open).toHaveBeenCalledWith(
            "Couldn't save your changes; the change was reverted.",
            'Dismiss',
            expect.anything()
         );
      });

      it('does not resurrect a row deleted after it was moved', async () => {
         const { store, api } = createStore({ elements: [element('e1')] });
         api.projects.batch.mockReturnValue(throwError(() => new Error('500')));
         store.moveElement('e1', 50, 50);
         // Deleting flushes the pending batch first, then removes the row.
         await store.deleteElementSilently('e1');
         await jest.advanceTimersByTimeAsync(400);

         expect(api.projects.batch).toHaveBeenCalledTimes(1);
         expect(store.schema()!.elements).toEqual([]);
      });
   });

   it('shows an optimistic element create at once with a client id', async () => {
      const { store, api } = createStore();
      const pending = new Subject<CanvasElementModel>();
      api.elements.create.mockReturnValue(pending);

      const created = await store.addElement({ ...element('ignored'), id: undefined } as never);

      expect(created?.id).toEqual(expect.any(String));
      expect(store.schema()!.elements.map((e) => e.id)).toEqual([created!.id]);
      expect(store.selectedElementIds()).toEqual([created!.id]);
   });

   it('removes a rejected create and never brings it back on a later rollback', async () => {
      const { store, api } = createStore();
      api.elements.create.mockReturnValue(throwError(() => new Error('409')));
      const created = await store.addElement({ ...element('x1'), id: 'x1' } as never);
      await settle();

      expect(store.schema()!.elements).toEqual([]);
      expect(store.selectedElementIds()).toEqual([]);
      expect(created?.id).toBe('x1');
      // A delete of a failed create is refused (nothing to restore later).
      await store.deleteElement('x1');
      expect(api.elements.remove).not.toHaveBeenCalled();
   });
});

// ---- history -----------------------------------------------------------------------------------

describe('ProjectStore history', () => {
   beforeEach(() => jest.useFakeTimers());
   afterEach(() => jest.useRealTimers());

   it('undoes and redoes a single element update', async () => {
      const { store } = createStore({ elements: [element('e1', { strokeColor: '#111111' })] });
      await store.updateElement('e1', { strokeColor: '#222222' });
      expect(store.undoDepth()).toBe(1);

      store.undoElement();
      await jest.advanceTimersByTimeAsync(0);
      expect(store.schema()!.elements[0].strokeColor).toBe('#111111');
      expect(store.undoDepth()).toBe(0);
      expect(store.redoDepth()).toBe(1);

      store.redoElement();
      await jest.advanceTimersByTimeAsync(0);
      expect(store.schema()!.elements[0].strokeColor).toBe('#222222');
   });

   it('records everything inside batchHistory as ONE undo step, undone in reverse order', async () => {
      const { store } = createStore({ elements: [element('e1', { x: 0 })] });
      await store.batchHistory(async () => {
         await store.updateElement('e1', { x: 10 });
         await store.updateElement('e1', { x: 20 });
         await store.updateElement('e1', { width: 300 });
      });
      expect(store.undoDepth()).toBe(1);

      store.undoElement();
      await jest.advanceTimersByTimeAsync(0);
      expect(store.schema()!.elements[0]).toMatchObject({ x: 0, width: 100 });

      store.redoElement();
      await jest.advanceTimersByTimeAsync(0);
      expect(store.schema()!.elements[0]).toMatchObject({ x: 20, width: 300 });
   });

   it('records a batch with a single entry as that entry, and an empty batch as nothing', async () => {
      const { store } = createStore({ elements: [element('e1')] });
      await store.batchHistory(async () => undefined);
      expect(store.undoDepth()).toBe(0);
      await store.batchHistory(() => store.updateElement('e1', { x: 5 }));
      expect(store.undoDepth()).toBe(1);
   });

   it('nested batchHistory calls join the outer batch', async () => {
      const { store } = createStore({ elements: [element('e1')] });
      await store.batchHistory(async () => {
         await store.updateElement('e1', { x: 5 });
         await store.batchHistory(() => store.updateElement('e1', { y: 5 }));
      });
      expect(store.undoDepth()).toBe(1);
   });

   it('a new edit clears the redo stack', async () => {
      const { store } = createStore({ elements: [element('e1')] });
      await store.updateElement('e1', { x: 5 });
      store.undoElement();
      await jest.advanceTimersByTimeAsync(0);
      expect(store.redoDepth()).toBe(1);
      await store.updateElement('e1', { y: 5 });
      expect(store.redoDepth()).toBe(0);
   });

   it('undo/redo themselves never push history entries', async () => {
      const { store } = createStore({ elements: [element('e1')] });
      await store.updateElement('e1', { x: 5 });
      store.undoElement();
      await jest.advanceTimersByTimeAsync(0);
      store.redoElement();
      await jest.advanceTimersByTimeAsync(0);
      expect([store.undoDepth(), store.redoDepth()]).toEqual([1, 0]);
   });

   it('undoing a delete re-creates the element under the same id', async () => {
      const { store, api } = createStore({ elements: [element('e1', { text: 'keep' })] });
      await store.deleteElement('e1');
      await jest.advanceTimersByTimeAsync(0);
      store.undoElement();
      await jest.advanceTimersByTimeAsync(0);

      expect(store.schema()!.elements.map((e) => [e.id, e.text])).toEqual([['e1', 'keep']]);
      expect(api.elements.create).toHaveBeenCalledWith('p1', expect.objectContaining({ id: 'e1' }));
   });

   it('undo with an empty stack is a no-op', () => {
      const { store } = createStore();
      store.undoElement();
      store.redoElement();
      expect([store.undoDepth(), store.redoDepth()]).toEqual([0, 0]);
   });

   it('recordElementMove undoes a whole drag of several elements', async () => {
      const { store } = createStore({ elements: [element('a', { x: 10, y: 10 }), element('b', { x: 50, y: 50 })] });
      store.moveElement('a', 110, 10);
      store.moveElement('b', 150, 50);
      store.recordElementMove([
         { id: 'a', from: { x: 10, y: 10 }, to: { x: 110, y: 10 } },
         { id: 'b', from: { x: 50, y: 50 }, to: { x: 150, y: 50 } },
      ]);
      store.undoElement();
      await jest.advanceTimersByTimeAsync(0);
      expect(store.schema()!.elements.map((e) => e.x)).toEqual([10, 50]);
   });
});

// ---- importFile --------------------------------------------------------------------------------

describe('ProjectStore.importFile', () => {
   it('applies the returned mutations and selects the imported tables, elements and diagrams', async () => {
      const { store, api } = createStore({ tables: [table('existing')] });
      const mutations: SchemaMutation[] = [
         { kind: 'table.created', table: table('t-new') },
         { kind: 'column.created', tableId: 't-new', column: column('c-new') },
         { kind: 'element.created', element: element('e-new') },
         { kind: 'sequenceDiagram.created', diagram: diagram('d-new') },
         { kind: 'lifeline.created', lifeline: lifeline('l-new', 'd-new') },
      ];
      api.projects.importInto.mockReturnValue(of({ mutations }));
      patchState(unprotected(store), { selectedRelationshipIds: ['old'] });

      const count = await store.importFile({ any: 'file' }, { x: 100, y: 200 });

      expect(count).toBe(5);
      expect(api.projects.importInto).toHaveBeenCalledWith('p1', { file: { any: 'file' }, anchor: { x: 100, y: 200 } });
      expect(store.schema()!.tables.map((t) => t.id)).toEqual(['existing', 't-new']);
      expect(store.schema()!.tables[1].columns.map((c) => c.id)).toEqual(['c-new']);
      expect(store.selectedTableIds()).toEqual(['t-new']);
      expect(store.selectedElementIds()).toEqual(['e-new']);
      expect(store.selectedDiagramIds()).toEqual(['d-new']);
      expect(store.selectedRelationshipIds()).toEqual([]);
      expect(store.selectedLifelineIds()).toEqual([]);
   });

   it('throws when no project is open', async () => {
      const { store } = createStore();
      patchState(unprotected(store), { projectId: null });
      await expect(store.importFile({}, { x: 0, y: 0 })).rejects.toThrow('No project is open.');
   });
});

// ---- view state (perf P1.1-P1.3) --------------------------------------------------------------

describe('ProjectStore remote restack', () => {
   it('re-sorts elements when a remote update changes a zIndex (they draw in array order)', () => {
      const { store } = createStore({
         elements: [element('a', { zIndex: 0 }), element('b', { zIndex: 1 }), element('c', { zIndex: 2 })],
      });
      store.applyRemoteBatch([
         { kind: 'element.updated', element: element('c', { zIndex: 1 }) },
         { kind: 'element.updated', element: element('b', { zIndex: 2 }) },
      ]);
      expect(store.schema()!.elements.map((e) => e.id)).toEqual(['a', 'c', 'b']);
   });
});

describe('ProjectStore view state', () => {
   afterEach(() => {
      jest.useRealTimers();
      localStorage.clear();
   });

   it('pans without touching the schema or calling the server, and remembers the view locally', () => {
      jest.useFakeTimers();
      const { store, api } = createStore({ elements: [element('e1')] });
      const before = store.schema();
      const slideFrames = store.slideFrames();

      store.setViewport(10, 20, 0.5);
      store.setViewport(30, 40, 0.75);

      expect(store.viewport()).toEqual({ x: 30, y: 40, zoom: 0.75 });
      expect(store.schema()).toBe(before);
      expect(store.slideFrames()).toBe(slideFrames);
      expect(localStorage.getItem('dd.viewport.p1')).toBeNull();
      jest.advanceTimersByTime(1000);
      expect(JSON.parse(localStorage.getItem('dd.viewport.p1')!)).toEqual({ x: 30, y: 40, zoom: 0.75 });
      expect(api.projects.updateViewport).not.toHaveBeenCalled();
   });

   it('writes a pending view on pagehide', () => {
      jest.useFakeTimers();
      const { store } = createStore();
      store.setViewport(1, 2, 3);
      window.dispatchEvent(new Event('pagehide'));
      expect(JSON.parse(localStorage.getItem('dd.viewport.p1')!)).toEqual({ x: 1, y: 2, zoom: 3 });
   });

   it('keeps a guide sandbox view in its local stand-in backend', () => {
      jest.useFakeTimers();
      const { store, api } = createStore();
      patchState(unprotected(store), { projectId: 'sandbox-x-1' });
      store.setViewport(5, 6, 1);
      jest.advanceTimersByTime(600);
      expect(api.projects.updateViewport).toHaveBeenCalledWith('sandbox-x-1', { viewportX: 5, viewportY: 6, zoom: 1 });
      expect(localStorage.length).toBe(0);
   });

   it("opens a project at this browser's last view of it, else at the server's", async () => {
      const { store, api } = createStore();
      const graph = (id: string) =>
         of({
            project: { id },
            accessLevel: 'OWNER',
            schema: schema({ viewport: { x: 7, y: 8, zoom: 2 }, home: { x: 1, y: 1, zoom: 1 }, themes: [] }),
         });
      api.projects.getGraph.mockImplementation(graph);

      await store.load('fresh');
      expect(store.viewport()).toEqual({ x: 7, y: 8, zoom: 2 });
      expect(store.home()).toEqual({ x: 1, y: 1, zoom: 1 });

      localStorage.setItem('dd.viewport.seen', JSON.stringify({ x: -3, y: 4, zoom: 0.5 }));
      await store.load('seen');
      expect(store.viewport()).toEqual({ x: -3, y: 4, zoom: 0.5 });

      localStorage.setItem('dd.viewport.broken', '{"x":"nope"}');
      await store.load('broken');
      expect(store.viewport()).toEqual({ x: 7, y: 8, zoom: 2 });
   });

   it('saves the home view and themes into their own slots', async () => {
      const { store, api } = createStore();
      const before = store.schema();
      await store.setHome({ x: 1, y: 2, zoom: 3 });
      await store.setCustomThemes([]);
      expect(store.home()).toEqual({ x: 1, y: 2, zoom: 3 });
      expect(api.projects.updateHome).toHaveBeenCalledWith('p1', { home: { x: 1, y: 2, zoom: 3 } });
      expect(api.projects.updateThemes).toHaveBeenCalledWith('p1', { themes: [] });
      expect(store.schema()).toBe(before);
   });

   it('keeps derived slide and group collections stable across unrelated edits', () => {
      const frame = element('f1', { type: 'frame' as CanvasElementModel['type'], slide: { order: 0 } });
      const { store } = createStore({
         elements: [frame, element('a', { groupId: 'g', slideId: 'f1' }), element('b', { groupId: 'g' })],
      });
      const slideFrames = store.slideFrames();
      const groups = store.groups();
      const byItem = store.groupByItem();
      const hidden = store.hiddenBySlides();
      const fks = store.foreignKeyColumnIds();

      store.applyRemote({ kind: 'element.moved', elementId: 'b', x: 50, y: 60 });

      expect(store.schema()!.elements[2].x).toBe(50);
      expect(store.slideFrames()).toBe(slideFrames);
      expect(store.groups()).toBe(groups);
      expect(store.groupByItem()).toBe(byItem);
      expect(store.hiddenBySlides()).toBe(hidden);
      expect(store.foreignKeyColumnIds()).toBe(fks);
      expect(byItem.get('a')).toBe('g');
   });
});

// ---- bulk local moves (perf P2.1) ---------------------------------------------------------------

describe('ProjectStore.moveItemsLocal', () => {
   beforeEach(() => jest.useFakeTimers());
   afterEach(() => jest.useRealTimers());

   const start = (): Partial<SchemaModel> => ({
      elements: [element('a'), element('b'), element('still', { x: 500 })],
      tables: [table('t1', { columns: [column('c1')] }), table('t2', { columns: [column('c2')] })],
      relationships: [relationship('r1', 'c1', 'c2')],
      sequenceDiagrams: [diagram('d1', { originY: 0, headerHeight: 40, rowSpacing: 60 })],
      lifelines: [lifeline('l1', 'd1', { x: 10 })],
      sequenceMessages: [message('m1', 'd1', 'l1', 'l1', 100)],
   });

   it('moves everything in one schema write and leaves untouched rows as they were', () => {
      const { store } = createStore(start());
      const still = store.schema()!.elements[2];
      const writes: unknown[] = [];
      TestBed.runInInjectionContext(() => watchState(store, (state) => writes.push(state.schema)));
      writes.length = 0;

      store.moveItemsLocal({
         elements: new Map([
            ['a', { x: 10, y: 20 }],
            ['b', { x: 30, y: 40 }],
         ]),
         tables: new Map([['t1', { x: 5, y: 6 }]]),
         waypoints: new Map([['r1', [{ x: 1, y: 2 }]]]),
         sequences: [
            {
               diagramId: 'd1',
               startXs: new Map([['l1', 10]]),
               dx: 7,
               startOriginY: 0,
               dy: 3,
               startRows: new Map([['m1', 1]]),
            },
         ],
      });

      expect(writes).toHaveLength(1);
      const s = store.schema()!;
      expect(s.elements.map((e) => [e.x, e.y])).toEqual([
         [10, 20],
         [30, 40],
         [500, 0],
      ]);
      expect(s.elements[2]).toBe(still);
      expect([s.tables[0].x, s.tables[0].y, s.tables[1].x]).toEqual([5, 6, 0]);
      expect(s.relationships[0].waypoints).toEqual([{ x: 1, y: 2 }]);
      expect(s.lifelines[0].x).toBe(17);
      expect(s.sequenceDiagrams[0].originY).toBe(3);
      expect(s.sequenceMessages[0].y).toBe(3 + 40 + 60);
   });

   it('stages the moved rows into one batch save (sequence shifts stay local)', async () => {
      const { store, api } = createStore(start());
      store.moveItemsLocal({
         elements: new Map([['a', { x: 1, y: 1 }]]),
         tables: new Map([['t2', { x: 2, y: 2 }]]),
         waypoints: new Map([['r1', []]]),
      });
      await jest.advanceTimersByTimeAsync(400);
      expect(api.projects.batch).toHaveBeenCalledTimes(1);
      expect(api.projects.batch).toHaveBeenCalledWith('p1', {
         tables: [{ id: 't2', x: 2, y: 2 }],
         elements: [{ id: 'a', x: 1, y: 1 }],
         relationships: [{ id: 'r1', waypoints: [] }],
      });
   });

   it('undoes and redoes a recorded multi-item move in one write each', async () => {
      const { store } = createStore(start());
      store.moveItemsLocal({
         elements: new Map([
            ['a', { x: 9, y: 9 }],
            ['b', { x: 8, y: 8 }],
         ]),
      });
      store.recordElementMove([
         { id: 'a', from: { x: 0, y: 0 }, to: { x: 9, y: 9 } },
         { id: 'b', from: { x: 0, y: 0 }, to: { x: 8, y: 8 } },
      ]);
      const writes: unknown[] = [];
      TestBed.runInInjectionContext(() => watchState(store, (state) => writes.push(state.schema)));
      writes.length = 0;
      const initial = store.schema();

      await store.undoElement();
      expect(
         store
            .schema()!
            .elements.slice(0, 2)
            .map((e) => [e.x, e.y])
      ).toEqual([
         [0, 0],
         [0, 0],
      ]);
      await store.redoElement();
      expect(store.schema()!.elements[0].x).toBe(9);
      // Each step is one schema change (history-depth patches leave the schema as is).
      expect(writes.filter((w, i) => w !== (i ? writes[i - 1] : initial))).toHaveLength(2);
   });
});
