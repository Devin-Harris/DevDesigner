import {
  buildSpecFile,
  estimateTableHeight,
  findFreeSpot,
  layoutGraph,
  isUnsignedType,
  parseDataType,
  type Rect,
} from './index';

describe('parseDataType', () => {
  it('parses lengths, precision and enum values', () => {
    expect(parseDataType('varchar(100)')).toEqual({ name: 'VARCHAR', length: 100 });
    expect(parseDataType('VARCHAR')).toEqual({ name: 'VARCHAR', length: 255 });
    expect(parseDataType('DECIMAL(10, 2)')).toEqual({ name: 'DECIMAL', args: ['10', '2'] });
    expect(parseDataType("ENUM('a','b')")).toEqual({ name: 'ENUM', args: ['a', 'b'] });
    expect(parseDataType('int')).toEqual({ name: 'INT' });
    expect(parseDataType(undefined)).toEqual({ name: 'VARCHAR', length: 255 });
  });

  it('drops the UNSIGNED modifier (it is a column flag)', () => {
    expect(parseDataType('INT UNSIGNED')).toEqual({ name: 'INT' });
    expect(parseDataType('bigint(20) unsigned')).toEqual({ name: 'BIGINT', args: ['20'] });
    expect(isUnsignedType('INT UNSIGNED')).toBe(true);
    expect(isUnsignedType('INT')).toBe(false);
  });
});

describe('layoutGraph', () => {
  const box = (key: string) => ({ key, w: 280, h: estimateTableHeight(3) });
  const overlap = (a: Rect, b: Rect) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  it('never overlaps nodes, connected or not', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map(box);
    const edges: Array<[string, string]> = [
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'd'],
      ['e', 'f'],
    ];
    const pos = layoutGraph(nodes, edges);
    const rects = nodes.map((n) => ({ ...pos.get(n.key)!, w: n.w, h: n.h }));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlap(rects[i], rects[j])).toBe(false);
      }
    }
  });

  it('puts related nodes in adjacent columns', () => {
    const pos = layoutGraph([box('a'), box('b')], [['a', 'b']]);
    expect(pos.get('a')!.x).not.toBe(pos.get('b')!.x);
  });
});

describe('findFreeSpot', () => {
  it('returns a spot clear of existing content', () => {
    const existing: Rect[] = [{ x: 0, y: 0, w: 280, h: 140 }];
    const p = findFreeSpot(existing, 280, 140);
    const r = { ...p, w: 280, h: 140 };
    const hit =
      r.x < 280 && r.x + r.w > 0 && r.y < 140 && r.y + r.h > 0;
    expect(hit).toBe(false);
  });

  it('prefers a spot beside the near rect', () => {
    const near: Rect = { x: 0, y: 0, w: 280, h: 140 };
    const p = findFreeSpot([near], 280, 140, { near });
    expect(p.x).toBeGreaterThan(280);
  });
});

describe('buildSpecFile', () => {
  it('builds tables, FK shorthand relationships and a sequence diagram', () => {
    const { file, warnings } = buildSpecFile({
      tables: [
        { name: 'users', columns: [{ name: 'id', type: 'INT', primaryKey: true }] },
        {
          name: 'posts',
          columns: [
            { name: 'id', type: 'INT', primaryKey: true },
            { name: 'user_id', type: 'INT', references: 'users.id' },
            { name: 'bad', references: 'nope.id' },
          ],
        },
      ],
      relationships: [{ from: 'users.id', to: 'posts.user_id', type: 'ONE_TO_ONE' }],
      sequenceDiagrams: [
        {
          participants: ['Client', 'API'],
          messages: [
            { from: 'Client', to: 'API', label: 'login' },
            { from: 'API', to: 'Ghost', label: 'x' },
          ],
        },
      ],
    });
    expect(file.schema.tables).toHaveLength(2);
    expect(file.schema.relationships).toHaveLength(2);
    expect(file.schema.sequenceDiagrams).toHaveLength(1);
    expect(file.schema.lifelines).toHaveLength(2);
    expect(file.schema.sequenceMessages).toHaveLength(1);
    expect(warnings).toHaveLength(2);
    const [users, posts] = file.schema.tables;
    expect(users.x === posts.x && users.y === posts.y).toBe(false);
    const pk = users.columns[0];
    expect(pk.isPrimaryKey).toBe(true);
    expect(pk.isNullable).toBe(false);
  });

  it('titles sequence diagrams and skips messages from a participant to itself', () => {
    const { file, warnings } = buildSpecFile({
      sequenceDiagrams: [
        {
          title: ' Login flow ',
          participants: ['A', 'B'],
          messages: [
            { from: 'A', to: 'A', label: 'self' },
            { from: 'A', to: 'B', label: 'ok' },
            { from: 'B', to: 'B', label: 'note', style: 'break' },
          ],
        },
      ],
    });
    expect(file.schema.sequenceDiagrams[0].title).toBe('Login flow');
    expect(file.schema.sequenceMessages.map((m) => m.label)).toEqual(['ok', 'note']);
    expect(warnings).toHaveLength(1);
  });

  it('skips duplicate table names', () => {
    const { file, warnings } = buildSpecFile({
      tables: [
        { name: 'a', columns: [] },
        { name: 'A', columns: [] },
      ],
    });
    expect(file.schema.tables).toHaveLength(1);
    expect(warnings).toHaveLength(1);
  });
});

describe('table colors', () => {
  const spec = {
    tables: [
      { name: 'users', columns: [{ name: 'id', type: 'INT', primaryKey: true }] },
      { name: 'posts', columns: [{ name: 'user_id', type: 'INT', references: 'users.id' }] },
      { name: 'audit', columns: [{ name: 'id', type: 'INT', primaryKey: true }] },
      { name: 'tagged', color: 'amber-soft', columns: [{ name: 'id', type: 'INT' }] },
      { name: 'bad', color: 'nope', columns: [{ name: 'id', type: 'INT' }] },
    ],
  };
  const built = buildSpecFile(spec);
  const color = (n: string): string | undefined =>
    built.file.schema.tables.find((t) => t.name === n)?.color;

  it('colors connected tables alike and unrelated groups differently', () => {
    expect(color('users')).toBeDefined();
    expect(color('posts')).toBe(color('users'));
    expect(color('audit')).not.toBe(color('users'));
  });

  it('resolves names, and warns about unknown colors then falls back to a group color', () => {
    expect(color('tagged')).toBe('#fef3c7');
    expect(built.warnings.some((w) => /nope/.test(w))).toBe(true);
    expect(color('bad')).toBeDefined();
  });
});
