import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { ANALYTICS_CONNECTION } from '../analytics.config';
import type { AnalyticsRow, AnalyticsSink } from '../analytics.types';
import { utcDay } from '../privacy';

/** The slice of better-sqlite3's API the sink uses. */
interface Statement {
  run(...params: unknown[]): { changes: number };
}
interface NativeDb {
  prepare(sql: string): Statement;
  exec(sql: string): unknown;
  transaction<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void;
}

/** Rows per transaction; a 500-row insert takes ~1-3 ms in WAL mode. */
export const DB_SINK_BATCH = 500;

const COLUMNS = [
  'ts', 'name', 'source', 'actorType', 'actorId', 'tokenId', 'projectId', 'route', 'status',
  'durationMs', 'count', 'props', 'mcpTool', 'ipHash', 'ua', 'requestId',
] as const;

/**
 * Writes flushed rows into analytics.sqlite through the 'analytics' connection's
 * native better-sqlite3 handle: one prepared INSERT, one transaction per batch of
 * up to {@link DB_SINK_BATCH} rows, plus INSERT OR IGNORE of the day's active
 * actors (analytics_actor_day) in the same transaction.
 */
@Injectable()
export class DbAnalyticsSink implements AnalyticsSink {
  readonly name = 'db';
  private insertBatch: ((rows: AnalyticsRow[], actors: string[][]) => void) | null = null;

  constructor(@InjectDataSource(ANALYTICS_CONNECTION) private readonly dataSource: DataSource) {}

  write(rows: AnalyticsRow[]): void {
    const insert = this.prepared();
    for (let i = 0; i < rows.length; i += DB_SINK_BATCH) {
      const batch = rows.slice(i, i + DB_SINK_BATCH);
      const actors = new Map<string, string[]>();
      for (const row of batch) {
        if (!row.actorId || row.actorType === 'system' || row.actorType === 'anon') continue;
        const tuple = [utcDay(row.ts), row.actorType, row.actorId, row.source];
        actors.set(tuple.join('\u0001'), tuple);
      }
      insert(batch, [...actors.values()]);
    }
  }

  purge(beforeTs: number): number {
    const db = this.native();
    const removed = db.prepare('DELETE FROM analytics_event WHERE ts < ?').run(beforeTs).changes;
    if (removed > 0) db.exec('PRAGMA incremental_vacuum');
    return removed;
  }

  erase(actorId: string): number {
    const db = this.native();
    const events = db.prepare('DELETE FROM analytics_event WHERE actorId = ?').run(actorId).changes;
    const days = db.prepare('DELETE FROM analytics_actor_day WHERE actorId = ?').run(actorId).changes;
    return events + days;
  }

  private native(): NativeDb {
    return (this.dataSource.driver as unknown as { databaseConnection: NativeDb }).databaseConnection;
  }

  private prepared(): (rows: AnalyticsRow[], actors: string[][]) => void {
    if (this.insertBatch) return this.insertBatch;
    const db = this.native();
    const event = db.prepare(
      `INSERT INTO analytics_event (${COLUMNS.map((c) => `"${c}"`).join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`,
    );
    const actorDay = db.prepare(
      'INSERT OR IGNORE INTO analytics_actor_day (day, actorType, actorId, source) VALUES (?, ?, ?, ?)',
    );
    this.insertBatch = db.transaction((rows: AnalyticsRow[], actors: string[][]) => {
      for (const row of rows) event.run(...COLUMNS.map((c) => row[c]));
      for (const tuple of actors) actorDay.run(...tuple);
    });
    return this.insertBatch;
  }
}
