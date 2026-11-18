import type { CanvasElementModel, ColumnModel, SchemaModel, TableModel } from '@devdesigner/shared';
import { compareBounds, contentBoxes, diffSchemas } from './schema-diff';

function column(id: string, name: string): ColumnModel {
   return {
      id,
      name,
      dataType: { name: 'int' },
      isPrimaryKey: false,
      isNullable: true,
      isUnique: false,
   } as unknown as ColumnModel;
}

function table(id: string, name: string, x: number, columns: ColumnModel[] = []): TableModel {
   return { id, name, x, y: 0, columns } as unknown as TableModel;
}

function rect(id: string, x: number, text?: string): CanvasElementModel {
   return {
      id,
      type: 'rectangle',
      x,
      y: 300,
      width: 100,
      height: 50,
      zIndex: 1,
      text,
   } as unknown as CanvasElementModel;
}

function schema(parts: Partial<SchemaModel>): SchemaModel {
   return {
      tables: [],
      relationships: [],
      elements: [],
      sequenceDiagrams: [],
      lifelines: [],
      sequenceMessages: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      ...parts,
   } as SchemaModel;
}

describe('diffSchemas', () => {
   const users = table('t1', 'users', 0, [column('c1', 'id'), column('c2', 'email')]);

   it('finds nothing when both versions are the same', () => {
      const s = schema({ tables: [users], elements: [rect('e1', 0)] });
      expect(diffSchemas(s, structuredClone(s))).toEqual([]);
   });

   it('reports items that exist on one side only, with a box on that side', () => {
      const mine = schema({ tables: [users] });
      const server = schema({ tables: [users, table('t2', 'orders', 400)] });
      const [entry] = diffSchemas(mine, server);
      expect(entry).toEqual(
         expect.objectContaining({ key: 'table:t2', side: 'server', label: 'Table orders', mineBox: undefined })
      );
      expect(entry.serverBox?.x0).toBe(400);
   });

   it('rolls column changes up to their table and names them', () => {
      const changed = table('t1', 'users', 0, [column('c1', 'id'), column('c3', 'name')]);
      const [entry] = diffSchemas(schema({ tables: [users] }), schema({ tables: [changed] }));
      expect(entry.side).toBe('changed');
      expect(entry.details).toEqual(['column email only on this computer', 'column name only on the server']);
   });

   it('describes moves and text edits in words', () => {
      const mine = schema({ elements: [rect('e1', 0, 'Hello')] });
      const server = schema({ elements: [{ ...rect('e1', 50, 'Hello there') }] });
      const [entry] = diffSchemas(mine, server);
      expect(entry.label).toBe('Rectangle "Hello there"');
      expect(entry.details).toEqual(['moved', 'text changed']);
      expect(entry.mineBox?.x0).toBe(0);
      expect(entry.serverBox?.x0).toBe(50);
   });

   it('ignores per-server image file ids', () => {
      const a = { ...rect('e1', 0), type: 'image', fileId: 'local-file' } as CanvasElementModel;
      const b = { ...a, fileId: 'server-file' } as CanvasElementModel;
      expect(diffSchemas(schema({ elements: [a] }), schema({ elements: [b] }))).toEqual([]);
   });

   it('frames both drawings in one box', () => {
      const mine = schema({ tables: [users] });
      const server = schema({ tables: [users, table('t2', 'orders', 900)] });
      const box = compareBounds(diffSchemas(mine, server), [...contentBoxes(mine), ...contentBoxes(server)]);
      expect(box.x0).toBeLessThan(0);
      expect(box.x1).toBeGreaterThan(900);
   });
});
