import { randomUUID } from 'node:crypto';
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
 * so the graph routes answer 304 without rebuilding it. Counters live in memory;
 * the boot id keeps tags from a previous server process from ever matching.
 */
const BOOT = randomUUID().slice(0, 8);
const revisions = new Map<string, number>();

/** Current revision of a project (0 until its first change in this process). */
export function projectRevision(projectId: string): number {
  return revisions.get(projectId) ?? 0;
}

/** Record that a project's graph changed. Call after the write has committed. */
export function bumpProjectRevision(projectId: string): number {
  const next = projectRevision(projectId) + 1;
  revisions.set(projectId, next);
  return next;
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
  return `W/"p-${BOOT}-${projectId}-${revision}-${accessLevel}"`;
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

/** Test hook: reset all counters. */
export function resetProjectRevisionsForTests(): void {
  revisions.clear();
}
