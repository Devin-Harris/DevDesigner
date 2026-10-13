import type { CanvasElementModel, SchemaModel, TableModel } from '@dbdesigner/shared';
import { Batch } from './batch';
import { planUndo, schemaChanged } from './journal';
import { renderSvg } from './render';
import { diffSchema } from './schema-diff';
import { parseSqlDdl } from './sql-import';

const col = (id: string, name: string, extra: Partial<TableModel['columns'][number]> = {}) => ({
  id,
  name,
  dataType: { name: 'INT' as const },
  isPrimaryKey: false,
  isNullable: true,
  isUnique: false,
  isAutoIncrement: false,
  ...extra,
});

const base = (): SchemaModel => ({
  tables: [
    { id: 't1', name: 'users', x: 0, y: 0, columns: [col('c1', 'id', { isPrimaryKey: true, isNullable: false })] },
    { id: 't2', name: 'posts', x: 400, y: 0, columns: [col('c2', 'id', { isPrimaryKey: true, isNullable: false }), col('c3', 'user_id')] },
  ],
  relationships: [{ id: 'r1', sourceColumnId: 'c1', targetColumnId: 'c3', type: 'ONE_TO_MANY' }],
  notes: [],
  elements: [],
  sequenceDiagrams: [],
  lifelines: [],
  sequenceMessages: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});

const rect = (id: string, x: number, y: number, extra: Partial<CanvasElementModel> = {}): CanvasElementModel => ({
  id,
  type: 'rectangle',
  x,
  y,
  width: 100,
  height: 60,
  angle: 0,
  strokeColor: '#1e1e1e',
  fillStyle: 'none',
  strokeWidth: 2,
  strokeStyle: 'solid',
  opacity: 100,
  zIndex: 0,
  ...extra,
} as CanvasElementModel);

describe('parseSqlDdl', () => {
  it('reads PostgreSQL tables, keys and references', () => {
    const { spec, skipped } = parseSqlDdl(`
      -- users
      CREATE TABLE IF NOT EXISTS public."users" (
        id SERIAL PRIMARY KEY,
        email CHARACTER VARYING(255) NOT NULL UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
      );
      CREATE TABLE posts (
        id BIGINT GENERATED ALWAYS AS IDENTITY,
        user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        title TEXT,
        CONSTRAINT posts_pk PRIMARY KEY (id)
      );
      CREATE INDEX posts_user ON posts (user_id);
    `);
    expect(spec.tables.map((t) => t.name)).toEqual(['users', 'posts']);
    const users = spec.tables[0];
    expect(users.columns[0]).toMatchObject({ name: 'id', type: 'INT', primaryKey: true, autoIncrement: true });
    expect(users.columns[1]).toMatchObject({ name: 'email', type: 'VARCHAR(255)', nullable: false, unique: true });
    expect(users.columns[2]).toMatchObject({ name: 'created_at', type: 'TIMESTAMP', default: 'now()' });
    expect(spec.tables[1].columns[0]).toMatchObject({ primaryKey: true, autoIncrement: true });
    expect(spec.relationships).toEqual([{ from: 'users.id', to: 'posts.user_id', type: 'ONE_TO_MANY', onDelete: 'CASCADE' }]);
    expect(skipped).toEqual(['CREATE INDEX']);
  });

  it('reads MySQL backticks, table-level FKs and ALTER TABLE ADD', () => {
    const { spec } = parseSqlDdl(`
      CREATE TABLE \`orders\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`customer_id\` int(11) NOT NULL COMMENT 'who',
        \`total\` decimal(10,2) DEFAULT '0.00',
        PRIMARY KEY (\`id\`),
        KEY \`idx\` (\`customer_id\`),
        CONSTRAINT \`fk1\` FOREIGN KEY (\`customer_id\`) REFERENCES \`customers\` (\`id\`)
      ) ENGINE=InnoDB COMMENT='All orders';
      CREATE TABLE customers (id int PRIMARY KEY);
      ALTER TABLE orders ADD COLUMN note varchar(40), ADD UNIQUE KEY u1 (note);
    `);
    const orders = spec.tables.find((t) => t.name === 'orders')!;
    expect(orders.note).toBe('All orders');
    expect(orders.columns.map((c) => c.name)).toEqual(['id', 'customer_id', 'total', 'note']);
    expect(orders.columns[0]).toMatchObject({ primaryKey: true, autoIncrement: true });
    expect(orders.columns[1].note).toBe('who');
    expect(orders.columns[2]).toMatchObject({ type: 'decimal(10,2)', default: '0.00' });
    expect(orders.columns[3].unique).toBe(true);
    expect(spec.relationships).toEqual([{ from: 'customers.id', to: 'orders.customer_id', type: 'ONE_TO_MANY' }]);
  });
});

describe('diffSchema', () => {
  it('finds added/changed/dropped tables, columns and relationships', () => {
    const d = diffSchema(base(), {
      tables: [
        { name: 'users', columns: [{ name: 'id', type: 'INT', primaryKey: true }, { name: 'email', type: 'VARCHAR(100)' }] },
        { name: 'comments', columns: [{ name: 'id', type: 'INT', primaryKey: true }, { name: 'user_id', type: 'INT', references: 'users.id' }] },
      ],
    });
    expect(d.addTables.map((t) => t.name)).toEqual(['comments']);
    expect(d.addColumns.map((c) => `${c.table}.${c.column.name}`)).toEqual(['users.email']);
    expect(d.dropTables.map((t) => t.name)).toEqual(['posts']);
    expect(d.addRelationships).toEqual([{ from: 'users.id', to: 'comments.user_id', type: 'ONE_TO_MANY' }]);
    // r1 goes with the dropped posts table, so it is not listed separately.
    expect(d.dropRelationships).toEqual([]);
  });

  it('reports column changes with a patch', () => {
    const d = diffSchema(base(), {
      tables: [
        { name: 'users', columns: [{ name: 'id', type: 'BIGINT', primaryKey: true }] },
        { name: 'posts', columns: [{ name: 'id', type: 'INT', primaryKey: true }, { name: 'user_id', type: 'INT', nullable: false }] },
      ],
      relationships: [{ from: 'users.id', to: 'posts.user_id' }],
    });
    expect(d.changeColumns).toEqual([
      expect.objectContaining({ table: 'users', column: 'id', patch: { dataType: { name: 'BIGINT' } } }),
      expect.objectContaining({ table: 'posts', column: 'user_id', patch: { isNullable: false } }),
    ]);
    expect(d.addRelationships).toEqual([]);
    expect(d.dropRelationships).toEqual([]);
  });
});

describe('planUndo', () => {
  it('reverts moved fields, deletes created items and restores deleted ones', () => {
    const before = base();
    before.elements = [rect('e1', 0, 0), rect('e2', 50, 50)];
    const after = structuredClone(before);
    after.tables[0].x = 999;
    after.elements = [rect('e1', 10, 0, { backgroundColor: '#ff0000', fillStyle: 'solid' }), rect('e3', 0, 0)];
    const plan = planUndo(before, after, structuredClone(after));
    expect(plan.patches).toEqual(
      expect.arrayContaining([
        { section: 'tables', id: 't1', patch: { x: 0 } },
        { section: 'elements', id: 'e1', patch: { x: 0, backgroundColor: null, fillStyle: 'none' } },
      ]),
    );
    expect(plan.deletes).toEqual([{ section: 'elements', id: 'e3' }]);
    expect(plan.restore.elements.map((e) => e.id)).toEqual(['e2']);
    expect(plan.conflicts).toEqual([]);
  });

  it('leaves fields changed again since alone', () => {
    const before = base();
    const after = structuredClone(before);
    after.tables[0].x = 100;
    const current = structuredClone(after);
    current.tables[0].x = 300;
    const plan = planUndo(before, after, current);
    expect(plan.patches).toEqual([]);
    expect(plan.conflicts[0]).toMatch(/tables t1.x changed again/);
  });

  it('tracks columns of surviving tables', () => {
    const before = base();
    const after = structuredClone(before);
    after.tables[0].columns.push(col('c9', 'email'));
    after.tables[1].columns = after.tables[1].columns.filter((c) => c.id !== 'c3');
    const plan = planUndo(before, after, structuredClone(after));
    expect(plan.columnDeletes).toEqual(['c9']);
    expect(plan.restore.columns).toEqual([{ tableId: 't2', column: expect.objectContaining({ id: 'c3' }) }]);
    expect(schemaChanged(before, after)).toBe(true);
    expect(schemaChanged(before, structuredClone(before))).toBe(false);
  });
});

describe('Batch', () => {
  it('merges patches per item and lets deletes win', () => {
    const b = new Batch().set('tables', 't1', { x: 1 }).set('tables', 't1', { y: 2 }).set('elements', 'e1', { x: 3 }).delete('elements', 'e1');
    expect(b.size).toBe(2);
    expect(b.toDto()).toEqual({ tables: [{ id: 't1', x: 1, y: 2 }], deletes: { elements: ['e1'] } });
  });
});

describe('renderSvg', () => {
  it('draws tables, shapes and relationships within the region', () => {
    const s = base();
    s.elements = [rect('e1', 0, 300, { text: 'Hello & <world>' })];
    const { svg, drawn } = renderSvg(s, { showIds: true });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('users');
    expect(svg).toContain('Hello &amp;');
    expect(svg).toContain('&lt;world&gt;');
    expect(svg).toContain('<polyline');
    expect(drawn).toBe(3);
    const only = renderSvg(s, { region: { x: -10, y: 290, w: 200, h: 100 } });
    expect(only.drawn).toBe(1);
  });
});
