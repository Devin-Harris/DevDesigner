import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import type { AccessLevel } from '@devdesigner/shared';
import type { Response } from 'express';

/**
 * Per-project revision counters behind the project graph's ETag.
 *
 * Every persisted change to a project's graph is broadcast through
 * `RealtimePublisher`, which bumps that project's revision after the write has
 * committed. Project-row writes that are not broadcast (rename, archive, type)
 * bump it directly. Viewport writes deliberately do NOT bump it: the viewport is
 * per-viewer state, and panning would otherwise invalidate every cached graph.
 *
 * "No bump since revision N" therefore means a graph read at N is still current,
 * so the graph routes answer 304 without rebuilding it.
 *
 * Revisions are persisted in `projects.revision` (perf P3.4) through a store the
 * ProjectRevisionStore provider registers at boot: a bump is one synchronous
 * `UPDATE ... RETURNING` on the SQLite handle, so tags survive restarts and the
 * Projects list can tell when a project's content changed. Without a store (unit
 * tests) the counters only live in memory.
 *
 * The tag also carries a BUILD id (the deploy's commit, else the start script's
 * mtime), so a deploy that changes how graphs are serialized never serves a
 * client the copy an older build produced.
 */
export interface RevisionStore {
  /** The stored revision, or undefined when the project does not exist. */
  read(projectId: string): number | undefined;
  /** Increment and return the stored revision (undefined when the project is gone). */
  bump(projectId: string): number | undefined;
}

const revisions = new Map<string, number>();
let store: RevisionStore | null = null;

function buildId(): string {
  const commit = process.env['RAILWAY_GIT_COMMIT_SHA'] ?? process.env['GIT_COMMIT'] ?? '';
  let mtime = '';
  try {
    mtime = String(statSync(process.argv[1] ?? '').mtimeMs);
  } catch {
    // No readable entry script: the commit (or nothing) identifies the build.
  }
  return createHash('sha1').update(`${commit}|${mtime}`).digest('hex').slice(0, 8);
}
const BUILD = buildId();

/** Use `next` for persistence (null = in-memory only). Clears the in-memory copies. */
export function setRevisionStore(next: RevisionStore | null): void {
  store = next;
  revisions.clear();
}

/** Current revision of a project (0 for a project that was never changed). */
export function projectRevision(projectId: string): number {
  const known = revisions.get(projectId);
  if (known !== undefined) return known;
  const stored = store?.read(projectId);
  if (stored === undefined) return 0;
  revisions.set(projectId, stored);
  return stored;
}

/** Record that a project's graph changed. Call after the write has committed. */
export function bumpProjectRevision(projectId: string): number {
  const previous = projectRevision(projectId);
  let stored: number | undefined;
  try {
    stored = store?.bump(projectId);
  } catch {
    // A failed persist must not fail the write that already committed; the
    // in-memory counter still moves, so this process never reuses a tag.
  }
  // Never hand out a revision twice, even if the stored value lags (e.g. a bump
  // that rode in a rolled-back transaction).
  const next = Math.max(previous + 1, stored ?? 0);
  revisions.set(projectId, next);
  return next;
}

/** Forget a project's in-memory counter (after it is deleted). */
export function forgetProjectRevision(projectId: string): void {
  revisions.delete(projectId);
}

/**
 * Weak ETag for a project graph as seen at a given access level. The level is part
 * of the tag because the graph response carries it: the same URL read by the owner
 * and by a share-link guest must not share a cached copy.
 */
export function projectGraphTag(
  projectId: string,
  accessLevel: AccessLevel,
  revision = projectRevision(projectId),
): string {
  return `W/"p-${BUILD}-${projectId}-${revision}-${accessLevel}"`;
}

/** Whether an If-None-Match header matches a tag (handles lists and `*`). */
export function etagMatches(header: string | string[] | undefined, tag: string): boolean {
  if (!header) return false;
  const raw = Array.isArray(header) ? header.join(',') : header;
  return raw
    .split(',')
    .map((t) => t.trim())
    .some((t) => t === '*' || t === tag);
}

/** Graph responses are private and always revalidated against their ETag. */
export function setGraphCacheHeaders(res: Response, tag: string): void {
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('ETag', tag);
}

/** Test hook: reset all counters (the store, if any, stays). */
export function resetProjectRevisionsForTests(): void {
  revisions.clear();
}
