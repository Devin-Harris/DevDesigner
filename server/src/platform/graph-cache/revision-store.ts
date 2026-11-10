import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { setRevisionStore, type RevisionStore } from '../http/project-revision';

interface Statement {
  get(...args: unknown[]): { revision: number } | undefined;
}
interface SqliteHandle {
  prepare(sql: string): Statement;
}

/**
 * Persists project revisions in `projects.revision` (perf P3.4). A bump runs one
 * synchronous `UPDATE ... RETURNING` on the better-sqlite3 handle (no await, so the
 * in-memory counter and the column never disagree), and also stamps `updatedAt`
 * so the Projects list orders by the last content change (perf S10).
 */
export function sqliteRevisionStore(db: SqliteHandle): RevisionStore {
  const read = db.prepare('SELECT revision FROM projects WHERE id = ?');
  const bump = db.prepare(
    "UPDATE projects SET revision = revision + 1, updatedAt = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = ? RETURNING revision",
  );
  return {
    read: (projectId) => read.get(projectId)?.revision,
    bump: (projectId) => bump.get(projectId)?.revision,
  };
}

/** Registers the SQLite revision store at boot (falls back to in-memory revisions). */
@Injectable()
export class ProjectRevisionStore implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProjectRevisionStore.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  onModuleInit(): void {
    const db = (this.dataSource.driver as unknown as { databaseConnection?: SqliteHandle }).databaseConnection;
    if (this.dataSource.options.type !== 'better-sqlite3' || !db) {
      this.logger.warn('Project revisions are in memory only (no better-sqlite3 connection).');
      return;
    }
    try {
      setRevisionStore(sqliteRevisionStore(db));
    } catch (err) {
      // projects.revision missing (synchronize off and the migration not run yet).
      this.logger.warn(`Project revisions are in memory only: ${(err as Error).message}`);
    }
  }

  onModuleDestroy(): void {
    setRevisionStore(null);
  }
}
