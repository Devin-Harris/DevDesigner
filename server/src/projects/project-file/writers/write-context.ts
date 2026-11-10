import { randomUUID } from 'node:crypto';
import type { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { SchemaModel } from '@devdesigner/shared';

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
}

/**
 * State shared by the per-entity writers of one import: the target, the translation
 * and the old -> new id maps every cross-reference is rewritten through.
 */
export interface WriteContext {
  manager: EntityManager;
  projectId: string;
  options: WriteOptions;
  dx: number;
  dy: number;
  tableIds: IdMap;
  columnIds: IdMap;
  elementIds: IdMap;
  diagramIds: IdMap;
  lifelineIds: IdMap;
  messageIds: IdMap;
  morphIds: IdMap;
  /** New group id for an old one (groups are re-minted together), or null. */
  group(old: string | undefined): string | null;
  /** New slide-frame id for an old one, an existing frame (linkExisting), or null. */
  slideOf(old: string | undefined): string | null;
}

export function createWriteContext(
  manager: EntityManager,
  projectId: string,
  schema: SchemaModel,
  options: WriteOptions,
): WriteContext {
  const groupIds = new IdMap();
  const ctx: WriteContext = {
    manager,
    projectId,
    options,
    dx: options.dx ?? 0,
    dy: options.dy ?? 0,
    tableIds: new IdMap(),
    columnIds: new IdMap(),
    elementIds: new IdMap(),
    diagramIds: new IdMap(),
    lifelineIds: new IdMap(),
    messageIds: new IdMap(),
    morphIds: new IdMap(),
    group: (old) => (old === undefined ? null : (groupIds.get(old) ?? groupIds.mint(old))),
    slideOf: (old) =>
      old === undefined
        ? null
        : (ctx.elementIds.get(old) ?? (options.linkExisting?.elementIds.has(old) ? old : null)),
  };
  // Minted up front, because other rows point at them before they are written:
  // tables, diagrams and elements at their slide frame; a slide's animations at its
  // tables, diagrams and elements; an arrow at a table or a message label.
  for (const e of schema.elements) ctx.elementIds.mint(e.id);
  for (const d of schema.sequenceDiagrams) ctx.diagramIds.mint(d.id);
  for (const t of schema.tables) ctx.tableIds.mint(t.id);
  for (const m of schema.sequenceMessages) ctx.messageIds.mint(m.id);
  return ctx;
}
