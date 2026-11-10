import type { EntityManager } from 'typeorm';
import type { SchemaModel } from '@devdesigner/shared';
import { Project } from '../projects/project.entity';
import type { ParsedProjectImport } from './project-import.parser';
import { createWriteContext, type ImportedImage, type WriteOptions } from './writers/write-context';
import { writeTables } from './writers/tables.writer';
import { writeRelationships } from './writers/relationships.writer';
import { writeImages } from './writers/images.writer';
import { writeElements } from './writers/elements.writer';
import { writeSequence } from './writers/sequence.writer';

export type { ImportedImage, WriteOptions } from './writers/write-context';

/** A world-space point the imported content's top-left corner is moved to. */
export interface ImportAnchor {
  x: number;
  y: number;
}

/**
 * Translation that moves the content's top-left corner (smallest x / y across
 * every positioned item) onto `anchor`, preserving the content's own layout.
 * Zero when there is nothing to position.
 */
export function offsetToAnchor(
  schema: SchemaModel,
  anchor: ImportAnchor,
): { dx: number; dy: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const t of schema.tables) {
    xs.push(t.x);
    ys.push(t.y);
  }
  for (const e of schema.elements) {
    xs.push(e.x);
    ys.push(e.y);
  }
  for (const l of schema.lifelines) xs.push(l.x);
  for (const m of schema.sequenceMessages) ys.push(m.y);
  for (const d of schema.sequenceDiagrams) ys.push(d.originY);
  for (const r of schema.relationships) {
    for (const p of r.waypoints ?? []) {
      xs.push(p.x);
      ys.push(p.y);
    }
  }
  if (xs.length === 0 || ys.length === 0) return { dx: 0, dy: 0 };
  return { dx: anchor.x - Math.min(...xs), dy: anchor.y - Math.min(...ys) };
}

/** The content written by `writeSchemaInto`, as models carrying the NEW ids. */
export type WrittenSchema = Omit<SchemaModel, 'viewport' | 'home' | 'notes'>;

/**
 * Insert a validated schema into `projectId` (a brand-new project or an existing
 * one). EVERY id is regenerated (so a file can be imported repeatedly, or onto the
 * server it came from, with no collisions) and every cross-reference is rewritten
 * through the id maps. References that no longer resolve (a relationship to a
 * missing column, a binding to a missing shape) are dropped rather than failing
 * the whole import.
 *
 * Must be called inside a transaction so a failure leaves nothing half-written.
 */
export async function writeSchemaInto(
  manager: EntityManager,
  projectId: string,
  schema: SchemaModel,
  options: WriteOptions = {},
): Promise<WrittenSchema> {
  const ctx = createWriteContext(manager, projectId, schema, options);
  // Parents before children: elements and arrows may point at tables and messages,
  // whose ids are already minted in the context.
  const tables = await writeTables(ctx, schema);
  const relationships = await writeRelationships(ctx, schema);
  const fileOf = await writeImages(ctx, schema);
  const elements = await writeElements(ctx, schema, fileOf);
  const sequence = await writeSequence(ctx, schema);
  return { tables, relationships, elements, ...sequence };
}

/** Insert a validated project file as a brand-new project. */
export async function writeImportedProject(
  manager: EntityManager,
  parsed: ParsedProjectImport,
  ownerId: string | null,
  images: ImportedImage[] = [],
): Promise<Project> {
  const { schema } = parsed;
  const project = await manager.save(
    manager.create(Project, {
      name: parsed.name,
      description: parsed.description,
      type: parsed.type,
      ownerId,
      archived: false,
      viewportX: schema.viewport.x,
      viewportY: schema.viewport.y,
      zoom: schema.viewport.zoom,
      homeX: schema.home?.x ?? null,
      homeY: schema.home?.y ?? null,
      homeZoom: schema.home?.zoom ?? null,
      themesJson: schema.themes?.length ? JSON.stringify(schema.themes) : null,
    }),
  );
  await writeSchemaInto(manager, project.id, schema, { images });
  return project;
}
