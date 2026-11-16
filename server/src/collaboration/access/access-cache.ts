import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import {
  PROJECT_MUTATION_EVENT,
  PROJECT_MUTATIONS_EVENT,
  type MutationBatchEvent,
  type MutationEvent,
  type SchemaMutation,
} from '@devdesigner/shared';
import {
  ACCESS_CHANGED_EVENT,
  ACCESS_REVOKED_EVENT,
  type AccessChangedEvent,
  type AccessRevokedEvent,
} from '../../platform/realtime/access-events';
import type { ProjectEntityKind } from './entity-project-resolver';

/** A small Map-based LRU whose entries also expire after `ttlMs`. */
export class TtlLru<K, V> {
  private readonly map = new Map<K, { value: V; expires: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** The cached value, or undefined when missing or expired. */
  get(key: K): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh recency (Map keeps insertion order; the first key is the least recent).
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: K, value: V): void {
    if (this.ttlMs <= 0 || this.maxEntries <= 0) return;
    this.map.delete(key);
    this.map.set(key, { value, expires: this.now() + this.ttlMs });
    while (this.map.size > this.maxEntries) {
      this.map.delete(this.map.keys().next().value as K);
    }
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  /** Drop every entry whose value matches. */
  deleteWhere(match: (value: V, key: K) => boolean): void {
    for (const [key, { value }] of this.map) if (match(value, key)) this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

/** What a share token grants, as cached (expiry is re-checked on every read). */
export interface CachedShareLink {
  projectId: string;
  accessLevel: 'EDIT' | 'VIEW';
  expiresAt: number | null;
  revoked: boolean;
}

const MAX_ENTRIES = 10_000;
/** Child rows never move to another project, so their mapping may live longer. */
const CHILD_TTL_FACTOR = 10;

/** Child kinds whose `*.deleted` mutation carries the id under this field. */
const DELETED_ID_FIELD: Partial<Record<SchemaMutation['kind'], [ProjectEntityKind, string]>> = {
  'column.deleted': ['column', 'columnId'],
  'index.deleted': ['index', 'indexId'],
  'relationship.deleted': ['relationship', 'relationshipId'],
  'element.deleted': ['element', 'elementId'],
  'lifeline.deleted': ['lifeline', 'lifelineId'],
  'message.deleted': ['message', 'messageId'],
};

/**
 * In-process cache for the access layer (perf P3.3 / S2): project -> owner, share
 * token -> link, and child id -> project. It saves 1-3 SELECTs on every REST call.
 *
 * Safety: entries expire after ACCESS_CACHE_TTL_MS (default 30 s; 0 turns the
 * cache off), and every change to who may access a project invalidates at once,
 * synchronously, before the event's other listeners run:
 *  - `access.revoked` (share link revoked, project deleted, ownership moved),
 *  - `access.changed` (share link created, project row updated),
 *  - `*.deleted` mutations evict that child id (a table or diagram delete evicts
 *    every child of the project, since its columns, indexes and participants cascade).
 * The realtime gateway's access re-checks bypass the cache altogether.
 */
@Injectable()
export class AccessCache {
  readonly owners: TtlLru<string, string | null>;
  readonly links: TtlLru<string, CachedShareLink | null>;
  readonly children: TtlLru<string, string>;

  constructor(config: ConfigService) {
    const ttl = Number(config.get<number>('ACCESS_CACHE_TTL_MS', 30_000));
    this.owners = new TtlLru(MAX_ENTRIES, ttl);
    this.links = new TtlLru(MAX_ENTRIES, ttl);
    this.children = new TtlLru(MAX_ENTRIES, ttl * CHILD_TTL_FACTOR);
  }

  childKey(kind: ProjectEntityKind, id: string): string {
    return `${kind}:${id}`;
  }

  /** Forget everything about a project (owner, its links, its child ids). */
  invalidateProject(projectId: string): void {
    this.owners.delete(projectId);
    this.links.deleteWhere((link) => link?.projectId === projectId);
    this.children.deleteWhere((pid) => pid === projectId);
  }

  @OnEvent(ACCESS_REVOKED_EVENT, { prependListener: true })
  onAccessRevoked(event: AccessRevokedEvent): void {
    this.invalidate(event);
  }

  @OnEvent(ACCESS_CHANGED_EVENT, { prependListener: true })
  onAccessChanged(event: AccessChangedEvent): void {
    this.invalidate(event);
  }

  @OnEvent(PROJECT_MUTATION_EVENT, { prependListener: true })
  onMutation(event: MutationEvent): void {
    this.evictDeleted(event.projectId, [event.mutation]);
  }

  @OnEvent(PROJECT_MUTATIONS_EVENT, { prependListener: true })
  onMutations(event: MutationBatchEvent): void {
    this.evictDeleted(event.projectId, event.mutations);
  }

  private invalidate(event: { projectId: string; token?: string }): void {
    if (event.token) this.links.delete(event.token);
    // A token-scoped event still drops the project's other entries: cheap and safe.
    this.invalidateProject(event.projectId);
  }

  private evictDeleted(projectId: string, mutations: SchemaMutation[]): void {
    for (const m of mutations) {
      if (m.kind === 'table.deleted' || m.kind === 'sequenceDiagram.deleted') {
        this.children.deleteWhere((pid) => pid === projectId);
        continue;
      }
      const field = DELETED_ID_FIELD[m.kind];
      if (field) {
        const id = (m as unknown as Record<string, unknown>)[field[1]];
        if (typeof id === 'string') this.children.delete(this.childKey(field[0], id));
      }
    }
  }
}
