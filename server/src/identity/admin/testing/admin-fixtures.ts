import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { buildAnalyticsDataSourceOptions } from '../../../platform/analytics/analytics-data-source';
import type { AnalyticsRow } from '../../../platform/analytics/analytics.types';
import { DbAnalyticsSink } from '../../../platform/analytics/sinks/db.sink';
import { sqlDatetime } from '../admin-window';

/** "Now" for every admin spec: 2026-11-10 12:00 UTC. */
export const NOW = Date.UTC(2026, 10, 10, 12);
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** In-memory app + analytics databases with the real schemas. */
export async function openDatabases(): Promise<{ app: DataSource; analytics: DataSource; sink: DbAnalyticsSink }> {
  const app = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [__dirname + '/../../../**/*.entity.ts'],
    synchronize: true,
  });
  const analytics = new DataSource(buildAnalyticsDataSourceOptions(':memory:'));
  await Promise.all([app.initialize(), analytics.initialize()]);
  return { app, analytics, sink: new DbAnalyticsSink(analytics) };
}

export async function insertUser(
  app: DataSource,
  fields: { email: string; createdAt?: number; lastSeenAt?: number; displayName?: string; password?: boolean },
): Promise<string> {
  const id = randomUUID();
  await app.query(
    `INSERT INTO users (id, email, displayName, passwordHash, role, createdAt, lastSeenAt) VALUES (?, ?, ?, ?, 'user', ?, ?)`,
    [
      id,
      fields.email,
      fields.displayName ?? null,
      fields.password === false ? null : '$2a$10$hash',
      sqlDatetime(fields.createdAt ?? NOW - 10 * DAY),
      fields.lastSeenAt ? sqlDatetime(fields.lastSeenAt) : null,
    ],
  );
  return id;
}

export async function insertProject(
  app: DataSource,
  fields: { ownerId: string | null; name?: string; createdAt?: number; lastOpenedAt?: number; description?: string },
): Promise<string> {
  const id = randomUUID();
  const created = sqlDatetime(fields.createdAt ?? NOW - 5 * DAY);
  await app.query(
    `INSERT INTO projects (id, ownerId, name, description, createdAt, updatedAt, lastOpenedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      fields.ownerId,
      fields.name ?? 'Project',
      fields.description ?? null,
      created,
      created,
      fields.lastOpenedAt ? sqlDatetime(fields.lastOpenedAt) : null,
    ],
  );
  return id;
}

export async function insertElement(
  app: DataSource,
  projectId: string,
  fields: { type?: string; text?: string; fileId?: string; slide?: boolean } = {},
): Promise<string> {
  const id = randomUUID();
  await app.query(
    `INSERT INTO elements (id, projectId, type, strokeColor, fillStyle, strokeStyle, text, fileId, slideJson)
     VALUES (?, ?, ?, '#000000', 'none', 'solid', ?, ?, ?)`,
    [id, projectId, fields.type ?? 'rectangle', fields.text ?? null, fields.fileId ?? null, fields.slide ? '{}' : null],
  );
  return id;
}

export async function insertImage(
  app: DataSource,
  projectId: string,
  fields: { mimeType?: string; byteSize?: number; blob?: Buffer; sha256?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await app.query(
    `INSERT INTO project_images (id, projectId, mimeType, data, location, sha256, byteSize, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      projectId,
      fields.mimeType ?? 'image/png',
      fields.blob ?? null,
      fields.blob ? 'db' : 'media',
      fields.sha256 ?? id,
      fields.byteSize ?? null,
      sqlDatetime(NOW - DAY),
    ],
  );
  return id;
}

export async function insertShareLink(
  app: DataSource,
  projectId: string,
  fields: { access?: string; revoked?: boolean; expiresAt?: number } = {},
): Promise<void> {
  await app.query(
    `INSERT INTO share_links (id, projectId, token, accessLevel, createdAt, revokedAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      projectId,
      randomUUID(),
      fields.access ?? 'VIEW',
      sqlDatetime(NOW - DAY),
      fields.revoked ? sqlDatetime(NOW - HOUR) : null,
      fields.expiresAt ? sqlDatetime(fields.expiresAt) : null,
    ],
  );
}

export async function insertToken(
  app: DataSource,
  userId: string,
  fields: { scope?: string; revoked?: boolean; lastUsedAt?: number } = {},
): Promise<string> {
  const id = randomUUID();
  await app.query(
    `INSERT INTO api_tokens (id, userId, name, scope, tokenHash, prefix, createdAt, lastUsedAt, revokedAt)
     VALUES (?, ?, 'CI', ?, ?, 'ddt_abcd', ?, ?, ?)`,
    [
      id,
      userId,
      fields.scope ?? 'write',
      `hash-${id}`,
      sqlDatetime(NOW - 20 * DAY),
      fields.lastUsedAt ? sqlDatetime(fields.lastUsedAt) : null,
      fields.revoked ? sqlDatetime(NOW - DAY) : null,
    ],
  );
  return id;
}

/** One analytics row with sensible defaults (a web user's successful PATCH). */
export function event(overrides: Partial<AnalyticsRow> = {}): AnalyticsRow {
  return {
    ts: NOW - HOUR,
    name: 'api.request',
    source: 'web',
    actorType: 'user',
    actorId: 'user-1',
    tokenId: null,
    projectId: null,
    route: 'PATCH /api/projects/:projectId/batch',
    status: 200,
    durationMs: 10,
    count: 1,
    props: '{"method":"PATCH","sample":1}',
    mcpTool: null,
    ipHash: null,
    ua: null,
    requestId: null,
    ...overrides,
  };
}
