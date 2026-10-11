import type { ProjectGraphResponse, SchemaModel } from '@dbdesigner/shared';
import { UserError, findColumn, findTable, formatDataType, summarizeProject } from './model';

const schema: SchemaModel = {
  tables: [
    {
      id: 't1',
      name: 'Users',
      x: 0,
      y: 0,
      columns: [
        {
          id: 'c1',
          name: 'id',
          dataType: { name: 'INT' },
          isPrimaryKey: true,
          isNullable: false,
          isUnique: false,
          isAutoIncrement: true,
        },
      ],
    },
    {
      id: 't2',
      name: 'posts',
      x: 400,
      y: 0,
      columns: [
        {
          id: 'c2',
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
  relationships: [{ id: 'r1', sourceColumnId: 'c1', targetColumnId: 'c2', type: 'ONE_TO_MANY' }],
  notes: [],
  elements: [],
  sequenceDiagrams: [],
  lifelines: [],
  sequenceMessages: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

describe('model helpers', () => {
  it('resolves tables case-insensitively and by id', () => {
    expect(findTable(schema, 'users').id).toBe('t1');
    expect(findTable(schema, 't2').name).toBe('posts');
  });

  it('lists existing tables in the not-found message', () => {
    expect(() => findTable(schema, 'nope')).toThrow(UserError);
    expect(() => findTable(schema, 'nope')).toThrow(/Users, posts/);
  });

  it('resolves table.column references', () => {
    const hit = findColumn(schema, 'posts.USER_ID');
    expect(hit.column.id).toBe('c2');
    expect(() => findColumn(schema, 'posts')).toThrow(/table.column/);
    expect(() => findColumn(schema, 'posts.missing')).toThrow(/No column/);
  });

  it('formats data types', () => {
    expect(formatDataType({ name: 'VARCHAR', length: 50 })).toBe('VARCHAR(50)');
    expect(formatDataType({ name: 'ENUM', args: ['a', 'b'] })).toBe('ENUM(a,b)');
    expect(formatDataType({ name: 'INT' })).toBe('INT');
  });

  it('summarizes relationships in table.column form', () => {
    const graph = {
      project: { id: 'p', name: 'P', description: null, archived: false, type: 'ERD' },
      schema,
      accessLevel: 'OWNER',
    } as unknown as ProjectGraphResponse;
    const summary = summarizeProject(graph) as { relationships: Array<{ from: string; to: string }> };
    expect(summary.relationships[0]).toMatchObject({ from: 'Users.id', to: 'posts.user_id' });
  });
});
