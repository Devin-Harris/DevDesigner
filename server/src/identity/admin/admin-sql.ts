import type { AdminOwnerKind } from '@devdesigner/shared';

/*
 * SQL fragments shared by the admin services. All of them read the app database or
 * analytics.sqlite read-only; none select content columns (text is only measured).
 */

/** Guide sandbox projects (current and legacy marks) never count as real projects. */
export const NOT_SANDBOX = `(p.description IS NULL OR p.description NOT IN ('dd-guide-sandbox', 'dbd-guide-sandbox'))`;

/** Stored image bytes: media files carry byteSize, legacy rows only their blob. */
export const IMAGE_BYTES = 'COALESCE(i.byteSize, LENGTH(i.data), 0)';

/** UTC day of an analytics `ts` (epoch ms). */
export const TS_DAY = `strftime('%Y-%m-%d', ts / 1000, 'unixepoch')`;

/** Estimated requests: sampled GETs are scaled back up by their sample rate. */
export const EST_REQUESTS = `SUM(count * 1.0 / COALESCE(NULLIF(json_extract(props, '$.sample'), 0), 1))`;

/** Signed-in actors (sessions and API tokens both carry the user id). */
export const USER_ACTORS = `('user', 'token')`;

/**
 * Per-project sizes as one grouped join (not a correlated subquery per row). Takes
 * one parameter: "now" for share-link expiry. Callers append WHERE / ORDER BY.
 */
export const PROJECT_AGGREGATE_SQL = `
  SELECT p.id, p.name, p.ownerId, p.archived, p.createdAt, p.updatedAt, p.lastOpenedAt,
    u.email AS ownerEmail,
    COALESCE(t.n, 0) AS tables,
    COALESCE(e.n, 0) AS elements,
    COALESCE(e.textBytes, 0) AS textBytes,
    COALESCE(img.bytes, 0) AS imageBytes,
    COALESCE(s.n, 0) AS activeShareLinks
  FROM projects p
  LEFT JOIN users u ON u.id = p.ownerId
  LEFT JOIN (SELECT projectId, COUNT(*) AS n FROM tables GROUP BY projectId) t ON t.projectId = p.id
  LEFT JOIN (
    SELECT projectId, COUNT(*) AS n, SUM(LENGTH(COALESCE(text, '')) + LENGTH(COALESCE(runsJson, ''))) AS textBytes
    FROM elements GROUP BY projectId
  ) e ON e.projectId = p.id
  LEFT JOIN (SELECT i.projectId, SUM(${IMAGE_BYTES}) AS bytes FROM project_images i GROUP BY i.projectId) img
    ON img.projectId = p.id
  LEFT JOIN (
    SELECT projectId, COUNT(*) AS n FROM share_links
    WHERE revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > ?) GROUP BY projectId
  ) s ON s.projectId = p.id`;

export interface ProjectAggregateRow {
  id: string;
  name: string;
  ownerId: string | null;
  archived: number | boolean;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  ownerEmail: string | null;
  tables: number;
  elements: number;
  textBytes: number;
  imageBytes: number;
  activeShareLinks: number;
}

export function ownerKindOf(ownerId: string | null): AdminOwnerKind {
  if (!ownerId) return 'anon';
  return ownerId.startsWith('guest:') ? 'guest' : 'user';
}

/** Escape LIKE wildcards in a user search term (used with ESCAPE '\\'). */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export const num = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};
