import { validateSchema } from './index';
import type { SchemaModel, TableModel } from '../models';

const col = (id: string, name: string, type = 'INT', pk = false) => ({
  id,
  name,
  dataType: { name: type },
  isPrimaryKey: pk,
  isNullable: !pk,
  isUnique: false,
  isAutoIncrement: false,
});
const table = (id: string, name: string, columns: TableModel['columns']): TableModel => ({
  id,
  name,
  columns,
  x: 0,
  y: 0,
});
const schema = (over: Partial<SchemaModel>): SchemaModel => ({
  tables: [],
  relationships: [],
  notes: [],
  elements: [],
  sequenceDiagrams: [],
  lifelines: [],
  sequenceMessages: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  ...over,
});

describe('validateSchema', () => {
  it('passes a clean schema', () => {
    const s = schema({
      tables: [
        table('t1', 'users', [col('c1', 'id', 'INT', true)]),
        table('t2', 'posts', [col('c2', 'id', 'INT', true), col('c3', 'user_id', 'BIGINT')]),
      ],
      relationships: [
        { id: 'r1', sourceColumnId: 'c1', targetColumnId: 'c3', type: 'ONE_TO_MANY' },
      ],
    });
    expect(validateSchema(s)).toEqual([]);
  });

  it('reports duplicates, empty tables, missing PKs and dangling relationships', () => {
    const s = schema({
      tables: [
        table('t1', 'users', [col('c1', 'id'), col('c2', 'ID')]),
        table('t2', 'USERS', []),
      ],
      relationships: [
        { id: 'r1', sourceColumnId: 'c1', targetColumnId: 'gone', type: 'ONE_TO_MANY' },
        { id: 'r2', sourceColumnId: 'c1', targetColumnId: 'c1', type: 'ONE_TO_ONE' },
      ],
    });
    const messages = validateSchema(s).map((i) => `${i.severity}:${i.targetId}`);
    expect(messages).toEqual(
      expect.arrayContaining([
        'error:t2', // duplicate name and no columns
        'warning:t1', // no primary key
        'error:c2', // duplicate column
        'error:r1', // dangling
        'error:r2', // self relationship
      ]),
    );
  });

  it('warns on mismatched foreign key types', () => {
    const s = schema({
      tables: [
        table('t1', 'a', [col('c1', 'id', 'INT', true)]),
        table('t2', 'b', [col('c2', 'id', 'INT', true), col('c3', 'a_id', 'VARCHAR')]),
      ],
      relationships: [
        { id: 'r1', sourceColumnId: 'c1', targetColumnId: 'c3', type: 'ONE_TO_MANY' },
      ],
    });
    expect(validateSchema(s).some((i) => i.targetId === 'r1' && i.severity === 'warning')).toBe(true);
  });
});
