import { randomUUID } from 'node:crypto';
import type { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

// Keeps each multi-row INSERT under SQLite's bound-variable limit even for wide rows.
const CHUNK = 25;

export async function insertAll<T extends ObjectLiteral>(
  manager: EntityManager,
  target: EntityTarget<T>,
  rows: QueryDeepPartialEntity<T>[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await manager.insert(target, rows.slice(i, i + CHUNK));
  }
}

/** Old id -> freshly minted id. Lookups of unknown ids return undefined. */
export class IdMap {
  private readonly ids = new Map<string, string>();
  mint(oldId: string): string {
    const id = randomUUID();
    this.ids.set(oldId, id);
    return id;
  }
  get(oldId: string | undefined): string | undefined {
    return oldId === undefined ? undefined : this.ids.get(oldId);
  }
}

/** A validated image file from an import, ready to insert (id is the file's own id). */
export interface ImportedImage {
  id: string;
  mimeType: string;
  data: Buffer;
  /** Hex SHA-256 of `data`, when already computed. */
  sha256?: string;
  /** True when the bytes are already in the media store (the row then stores no blob). */
  stored?: boolean;
}

export interface WriteOptions {
  /** Image files referenced by image elements' `fileId`. Elements whose file is missing are dropped. */
  images?: ImportedImage[];
  /** Translation applied to every world coordinate (default none). */
  dx?: number;
  dy?: number;
  /** Merging into a project that already has elements: stack the new ones above them. */
  stackAboveExisting?: boolean;
  /**
   * Ids already in the target project that unresolved references may keep pointing at
   * (slide ownership, arrow bindings), instead of being dropped. Used when content is
   * duplicated inside the same project.
   */
  linkExisting?: { elementIds: ReadonlySet<string>; tableIds: ReadonlySet<string> };
  /**
   * Slides join an existing presentation of the same name instead of forming a
   * renamed "(copy)" clone. Used when slides are added to a deck (MCP add_slides).
   */
  joinPresentations?: boolean;
  /**
   * Keep every id as written instead of minting fresh ones (desktop sync mirrors: the
   * same project on two servers shares ids). Ids taken by another project fail the insert.
   */
  keepIds?: boolean;
}

/** What the per-entity writers of one import share: the target and the options. */
export interface WriteContext {
  manager: EntityManager;
  projectId: string;
  options: WriteOptions;
}
