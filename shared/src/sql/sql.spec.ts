// Unit tests for the MySQL generator (BUILD_INSTRUCTIONS.md section 9). Covers a
// single table, PK + constraints, a one-to-many foreign key, a composite PK,
// correct topological ordering, a cycle (ALTER TABLE fallback), and MANY_TO_MANY
// junction generation.

import { generateMySQL, generateSql } from './index';
import type {
  ColumnModel,
  RelationshipModel,
  SchemaModel,
  TableModel,
} from '../models';

function column(partial: Partial<ColumnModel> & { id: string; name: string }): ColumnModel {
  return {
    dataType: { name: 'INT' },
    isPrimaryKey: false,
    isNullable: true,
    isUnique: false,
    isAutoIncrement: false,
    ...partial,
  };
}

function table(partial: Partial<TableModel> & { id: string; name: string }): TableModel {
  return { columns: [], x: 0, y: 0, ...partial };
}

function schema(partial: Partial<SchemaModel>): SchemaModel {
  return {
    tables: [],
    relationships: [],
    notes: [],
    elements: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    ...partial,
  };
}

describe('generateMySQL', () => {
  it('emits a single table with a primary key and constraints', () => {
    const users = table({
      id: 't_users',
      name: 'users',
      columns: [
        column({
          id: 'c_id',
          name: 'id',
          dataType: { name: 'INT' },
          isPrimaryKey: true,
          isNullable: false,
          isAutoIncrement: true,
        }),
        column({
          id: 'c_email',
          name: 'email',
          dataType: { name: 'VARCHAR', length: 255 },
          isNullable: false,
          isUnique: true,
        }),
        column({
          id: 'c_active',
          name: 'active',
          dataType: { name: 'BOOLEAN' },
          defaultValue: 'TRUE',
        }),
      ],
    });

    const sql = generateMySQL(schema({ tables: [users] }));

    expect(sql).toContain('CREATE TABLE `users` (');
    expect(sql).toContain('`id` INT NOT NULL AUTO_INCREMENT');
    expect(sql).toContain('`email` VARCHAR(255) NOT NULL UNIQUE');
    expect(sql).toContain('`active` TINYINT(1) DEFAULT TRUE');
    expect(sql).toContain('PRIMARY KEY (`id`)');
  });

  it('quotes string defaults and passes numeric defaults through', () => {
    const t = table({
      id: 't1',
      name: 'settings',
      columns: [
        column({ id: 'c1', name: 'label', dataType: { name: 'VARCHAR', length: 50 }, defaultValue: "o'clock" }),
        column({ id: 'c2', name: 'weight', dataType: { name: 'INT' }, defaultValue: '5' }),
        column({ id: 'c3', name: 'created', dataType: { name: 'DATETIME' }, defaultValue: 'CURRENT_TIMESTAMP' }),
      ],
    });
    const sql = generateMySQL(schema({ tables: [t] }));
    expect(sql).toContain("DEFAULT 'o''clock'");
    expect(sql).toContain('DEFAULT 5');
    expect(sql).toContain('DEFAULT CURRENT_TIMESTAMP');
  });

  it('maps DECIMAL and ENUM using args', () => {
    const t = table({
      id: 't1',
      name: 'products',
      columns: [
        column({ id: 'c1', name: 'price', dataType: { name: 'DECIMAL', args: ['10', '2'] }, isNullable: false }),
        column({ id: 'c2', name: 'size', dataType: { name: 'ENUM', args: ['S', 'M', 'L'] } }),
      ],
    });
    const sql = generateMySQL(schema({ tables: [t] }));
    expect(sql).toContain('`price` DECIMAL(10, 2) NOT NULL');
    expect(sql).toContain("`size` ENUM('S', 'M', 'L')");
  });

  it('generates a one-to-many foreign key on the many (target) side', () => {
    const users = table({
      id: 't_users',
      name: 'users',
      columns: [column({ id: 'u_id', name: 'id', dataType: { name: 'INT' }, isPrimaryKey: true, isNullable: false })],
    });
    const posts = table({
      id: 't_posts',
      name: 'posts',
      columns: [
        column({ id: 'p_id', name: 'id', dataType: { name: 'INT' }, isPrimaryKey: true, isNullable: false }),
        column({ id: 'p_author', name: 'author_id', dataType: { name: 'INT' }, isNullable: false }),
      ],
    });
    const rel: RelationshipModel = {
      id: 'r1',
      sourceColumnId: 'u_id', // one side
      targetColumnId: 'p_author', // many side holds the FK
      type: 'ONE_TO_MANY',
      onDelete: 'CASCADE',
    };
    const sql = generateMySQL(schema({ tables: [posts, users], relationships: [rel] }));

    // users must be created before posts (referenced table first).
    expect(sql.indexOf('CREATE TABLE `users`')).toBeLessThan(sql.indexOf('CREATE TABLE `posts`'));
    expect(sql).toContain('CONSTRAINT `fk_posts_author_id` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`) ON DELETE CASCADE');
  });

  it('emits a composite primary key', () => {
    const t = table({
      id: 't1',
      name: 'memberships',
      columns: [
        column({ id: 'c1', name: 'user_id', dataType: { name: 'INT' }, isPrimaryKey: true, isNullable: false }),
        column({ id: 'c2', name: 'group_id', dataType: { name: 'INT' }, isPrimaryKey: true, isNullable: false }),
      ],
    });
    const sql = generateMySQL(schema({ tables: [t] }));
    expect(sql).toContain('PRIMARY KEY (`user_id`, `group_id`)');
  });

  it('orders tables topologically across a chain', () => {
    const a = table({ id: 'a', name: 'a', columns: [column({ id: 'a_id', name: 'id', isPrimaryKey: true, isNullable: false })] });
    const b = table({
      id: 'b',
      name: 'b',
      columns: [
        column({ id: 'b_id', name: 'id', isPrimaryKey: true, isNullable: false }),
        column({ id: 'b_a', name: 'a_id', isNullable: false }),
      ],
    });
    const c = table({
      id: 'c',
      name: 'c',
      columns: [
        column({ id: 'c_id', name: 'id', isPrimaryKey: true, isNullable: false }),
        column({ id: 'c_b', name: 'b_id', isNullable: false }),
      ],
    });
    // c -> b -> a. Provide reversed input to prove ordering is computed, not input order.
    const rels: RelationshipModel[] = [
      { id: 'r_ab', sourceColumnId: 'a_id', targetColumnId: 'b_a', type: 'ONE_TO_MANY' },
      { id: 'r_bc', sourceColumnId: 'b_id', targetColumnId: 'c_b', type: 'ONE_TO_MANY' },
    ];
    const sql = generateMySQL(schema({ tables: [c, b, a], relationships: rels }));
    const ia = sql.indexOf('CREATE TABLE `a`');
    const ib = sql.indexOf('CREATE TABLE `b`');
    const ic = sql.indexOf('CREATE TABLE `c`');
    expect(ia).toBeLessThan(ib);
    expect(ib).toBeLessThan(ic);
    expect(sql).not.toContain('ALTER TABLE');
  });

  it('defers cyclic foreign keys to ALTER TABLE statements', () => {
    const a = table({
      id: 'a',
      name: 'a',
      columns: [
        column({ id: 'a_id', name: 'id', isPrimaryKey: true, isNullable: false }),
        column({ id: 'a_b', name: 'b_id', isNullable: true }),
      ],
    });
    const b = table({
      id: 'b',
      name: 'b',
      columns: [
        column({ id: 'b_id', name: 'id', isPrimaryKey: true, isNullable: false }),
        column({ id: 'b_a', name: 'a_id', isNullable: true }),
      ],
    });
    const rels: RelationshipModel[] = [
      { id: 'r1', sourceColumnId: 'a_id', targetColumnId: 'b_a', type: 'ONE_TO_MANY' },
      { id: 'r2', sourceColumnId: 'b_id', targetColumnId: 'a_b', type: 'ONE_TO_MANY' },
    ];
    const sql = generateMySQL(schema({ tables: [a, b], relationships: rels }));
    // Exactly one FK is inline, the other is deferred to break the cycle.
    expect(sql).toContain('ALTER TABLE');
    const alters = sql.match(/ALTER TABLE/g) ?? [];
    expect(alters.length).toBe(1);
  });

  it('synthesizes a junction table for MANY_TO_MANY', () => {
    const students = table({ id: 's', name: 'students', columns: [column({ id: 's_id', name: 'id', isPrimaryKey: true, isNullable: false })] });
    const courses = table({ id: 'co', name: 'courses', columns: [column({ id: 'co_id', name: 'id', isPrimaryKey: true, isNullable: false })] });
    const rel: RelationshipModel = { id: 'r', sourceColumnId: 's_id', targetColumnId: 'co_id', type: 'MANY_TO_MANY' };
    const sql = generateMySQL(schema({ tables: [students, courses], relationships: [rel] }));
    expect(sql).toContain('CREATE TABLE `students_courses` (');
    expect(sql).toContain('PRIMARY KEY (`students_id`, `courses_id`)');
    expect(sql).toContain('REFERENCES `students` (`id`)');
    expect(sql).toContain('REFERENCES `courses` (`id`)');
  });

  it('produces deterministic output across runs', () => {
    const s = schema({
      tables: [
        table({ id: 't1', name: 'alpha', columns: [column({ id: 'c1', name: 'id', isPrimaryKey: true, isNullable: false })] }),
        table({ id: 't2', name: 'beta', columns: [column({ id: 'c2', name: 'id', isPrimaryKey: true, isNullable: false })] }),
      ],
    });
    expect(generateMySQL(s)).toBe(generateMySQL(s));
  });
});

describe('generateSql dispatch', () => {
  it('routes mysql to the MySQL generator', () => {
    const s = schema({ tables: [table({ id: 't', name: 'x', columns: [column({ id: 'c', name: 'id', isPrimaryKey: true, isNullable: false })] })] });
    expect(generateSql(s, { dialect: 'mysql' })).toContain('CREATE TABLE `x`');
  });

  it('throws for dialects that are not wired yet', () => {
    const s = schema({});
    expect(() => generateSql(s, { dialect: 'postgres' })).toThrow(/not supported/);
  });
});
