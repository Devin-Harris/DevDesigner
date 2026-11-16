import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Project } from './project.entity';
import { AddProjectOwnerIndex1793900000000 } from '../../../migrations/1793900000000-AddProjectOwnerIndex';

/**
 * The Projects-list index (perf P1.14): synchronize creates it from the entity, and
 * the migration creates / drops the same index by name.
 */
describe('projects(ownerId, archived, updatedAt) index', () => {
  let ds: DataSource;
  const NAME = 'idx_projects_owner_archived_updated';

  beforeEach(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Project],
      synchronize: true,
    });
    await ds.initialize();
  });

  afterEach(async () => {
    await ds.destroy();
  });

  async function indexColumns(): Promise<string[] | null> {
    const list: Array<{ name: string }> = await ds.query(`PRAGMA index_list('projects')`);
    if (!list.some((i) => i.name === NAME)) return null;
    const info: Array<{ name: string }> = await ds.query(`PRAGMA index_info('${NAME}')`);
    return info.map((c) => c.name);
  }

  it('is created by synchronize from the entity', async () => {
    expect(await indexColumns()).toEqual(['ownerId', 'archived', 'updatedAt']);
  });

  it('is used by the list query', async () => {
    const plan: Array<{ detail: string }> = await ds.query(
      `EXPLAIN QUERY PLAN SELECT * FROM projects WHERE ownerId = ? AND archived = ? ORDER BY updatedAt DESC`,
      ['u', 0],
    );
    expect(plan.map((p) => p.detail).join(' ')).toContain(NAME);
  });

  it('migration up/down matches the entity', async () => {
    const migration = new AddProjectOwnerIndex1793900000000();
    const runner = ds.createQueryRunner();
    try {
      await migration.down(runner);
      expect(await indexColumns()).toBeNull();
      await migration.up(runner);
      expect(await indexColumns()).toEqual(['ownerId', 'archived', 'updatedAt']);
    } finally {
      await runner.release();
    }
  });
});
