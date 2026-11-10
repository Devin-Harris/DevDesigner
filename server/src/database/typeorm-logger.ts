import { Logger } from '@nestjs/common';
import type { Logger as TypeOrmLoggerContract } from 'typeorm';

const MAX_SQL_LENGTH = 1000;
const clip = (sql: string): string => (sql.length > MAX_SQL_LENGTH ? `${sql.slice(0, MAX_SQL_LENGTH)}…` : sql);

/**
 * Forwards TypeORM's slow-query, error and warn output to the app logger. Query
 * parameters are never logged (they carry user content); regular queries stay silent.
 */
export class TypeOrmLogger implements TypeOrmLoggerContract {
  private readonly logger = new Logger('TypeORM');

  logQuery(): void {}

  logQueryError(error: string | Error, query: string): void {
    this.logger.error({ err: error, query: clip(query) }, 'Query failed');
  }

  logQuerySlow(time: number, query: string): void {
    this.logger.warn({ ms: time, query: clip(query) }, 'Slow query');
  }

  logSchemaBuild(): void {}

  logMigration(message: string): void {
    this.logger.log(message);
  }

  log(level: 'log' | 'info' | 'warn', message: unknown): void {
    if (level === 'warn') this.logger.warn(message);
  }
}
