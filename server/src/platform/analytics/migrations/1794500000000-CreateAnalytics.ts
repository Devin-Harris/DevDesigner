import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema of the analytics database (audit 04 §4.4). Runs automatically
 * on the 'analytics' connection (migrationsRun), never on the app database.
 * IF NOT EXISTS keeps it safe on a file created before migrations tracked it.
 */
export class CreateAnalytics1794500000000 implements MigrationInterface {
  name = 'CreateAnalytics1794500000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE IF NOT EXISTS "analytics_event" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "ts" integer NOT NULL,
      "name" varchar(48) NOT NULL,
      "source" varchar(8) NOT NULL,
      "actorType" varchar(8) NOT NULL,
      "actorId" varchar(64),
      "tokenId" varchar(36),
      "projectId" varchar(36),
      "route" varchar(96),
      "status" smallint,
      "durationMs" integer,
      "count" integer NOT NULL DEFAULT (1),
      "props" text,
      "mcpTool" varchar(48),
      "ipHash" varchar(16),
      "ua" varchar(32),
      "requestId" varchar(128)
    )`);
    await q.query(`CREATE INDEX IF NOT EXISTS "idx_ae_ts" ON "analytics_event" ("ts")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "idx_ae_name_ts" ON "analytics_event" ("name", "ts")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "idx_ae_actor_ts" ON "analytics_event" ("actorId", "ts")`);
    await q.query(`CREATE INDEX IF NOT EXISTS "idx_ae_project_ts" ON "analytics_event" ("projectId", "ts")`);

    await q.query(`CREATE TABLE IF NOT EXISTS "analytics_daily" (
      "day" varchar(10) NOT NULL,
      "name" varchar(48) NOT NULL,
      "dim" varchar(96) NOT NULL DEFAULT (''),
      "source" varchar(8) NOT NULL DEFAULT (''),
      "events" integer NOT NULL,
      "actors" integer NOT NULL,
      "errors" integer NOT NULL DEFAULT (0),
      "p50Ms" integer,
      "p95Ms" integer,
      PRIMARY KEY ("day", "name", "dim", "source")
    )`);

    await q.query(`CREATE TABLE IF NOT EXISTS "analytics_actor_day" (
      "day" varchar(10) NOT NULL,
      "actorType" varchar(8) NOT NULL,
      "actorId" varchar(64) NOT NULL,
      "source" varchar(8) NOT NULL,
      PRIMARY KEY ("day", "actorType", "actorId", "source")
    ) WITHOUT ROWID`);

    await q.query(`CREATE TABLE IF NOT EXISTS "analytics_project_snapshot" (
      "day" varchar(10) NOT NULL,
      "projectId" varchar(36) NOT NULL,
      "ownerKind" varchar(8) NOT NULL,
      "tables" integer,
      "columns" integer,
      "relationships" integer,
      "elements" integer,
      "elementsByType" text,
      "sequenceItems" integer,
      "slides" integer,
      "images" integer,
      "imageBytes" integer,
      "textBytes" integer,
      "approxBytes" integer,
      "lastOpenedAt" integer,
      "shareLinksActive" integer,
      PRIMARY KEY ("day", "projectId")
    ) WITHOUT ROWID`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "analytics_project_snapshot"`);
    await q.query(`DROP TABLE IF EXISTS "analytics_actor_day"`);
    await q.query(`DROP TABLE IF EXISTS "analytics_daily"`);
    await q.query(`DROP TABLE IF EXISTS "analytics_event"`);
  }
}
