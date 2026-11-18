import type { SchemaModel, TableModel } from '../models';
import { mergeSchemas } from './merge';

const table = (id: string, name: string, x = 0): TableModel =>
  ({ id, name, x, y: 0, columns: [], indexes: [] }) as unknown as TableModel;

const schema = (tables: TableModel[], extra: Partial<SchemaModel> = {}): SchemaModel => ({
  tables,
  relationships: [],
  notes: [],
  elements: [],
  sequenceDiagrams: [],
  lifelines: [],
  sequenceMessages: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  ...extra,
});

describe('mergeSchemas', () => {
  const base = schema([table('a', 'A'), table('b', 'B')]);

  it('merges changes made on different items without conflicts', () => {
    const mine = schema([table('a', 'A2'), table('b', 'B'), table('c', 'C')]);
    const server = schema([table('a', 'A'), table('b', 'B', 50)]);
    const r = mergeSchemas(base, mine, server);
    expect(r.conflicts).toEqual([]);
    const byId = Object.fromEntries(r.schema.tables.map((t) => [t.id, t]));
    expect(byId.a.name).toBe('A2');
    expect(byId.b.x).toBe(50);
    expect(byId.c.name).toBe('C');
  });

  it('applies one-sided deletes', () => {
    const mine = schema([table('b', 'B')]);
    const server = schema([table('a', 'A'), table('b', 'B'), table('d', 'D')]);
    const r = mergeSchemas(base, mine, server);
    expect(r.schema.tables.map((t) => t.id).sort()).toEqual(['b', 'd']);
  });

  it('reports items changed on both sides and honours choices', () => {
    const mine = schema([table('a', 'Mine'), table('b', 'B')]);
    const server = schema([table('a', 'Server'), table('b', 'B')]);
    const r = mergeSchemas(base, mine, server);
    expect(r.conflicts.map((c) => c.key)).toEqual(['table:a']);
    expect(r.schema.tables.find((t) => t.id === 'a')!.name).toBe('Server');
    const chosen = mergeSchemas(base, mine, server, { 'table:a': 'mine' });
    expect(chosen.schema.tables.find((t) => t.id === 'a')!.name).toBe('Mine');
  });

  it('treats identical changes on both sides as agreed', () => {
    const both = schema([table('a', 'Same'), table('b', 'B')]);
    expect(mergeSchemas(base, both, both).conflicts).toEqual([]);
  });

  it('ignores per-server fields such as fileId', () => {
    const el = (fileId: string) => ({ id: 'img', type: 'image', fileId, x: 0, y: 0 }) as never;
    const b = schema([], { elements: [el('1')] });
    const r = mergeSchemas(b, schema([], { elements: [el('2')] }), schema([], { elements: [el('3')] }));
    expect(r.conflicts).toEqual([]);
  });
});
