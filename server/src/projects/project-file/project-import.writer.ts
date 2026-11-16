import type { EntityManager } from 'typeorm';
import {
  importsElement,
  planImportStacking,
  remapProjectIds,
  type CanvasElementModel,
  type ProjectContent,
  type SchemaModel,
} from '@devdesigner/shared';
import { Project } from '../projects/project.entity';
import type { ParsedProjectImport } from './project-import.parser';
import type { ImportedImage, WriteContext, WriteOptions } from './writers/write-context';
import { writeTables } from './writers/tables.writer';
import { writeRelationships } from './writers/relationships.writer';
import { writeImages } from './writers/images.writer';
import { existingContent, writeElements } from './writers/elements.writer';
import { writeSequence } from './writers/sequence.writer';

export type { ImportedImage, WriteOptions } from './writers/write-context';
export { offsetToAnchor, type ImportAnchor } from '@devdesigner/shared';

/** The content written by `writeSchemaInto`, as models carrying the NEW ids. */
export type WrittenSchema = ProjectContent;

/**
 * Insert a validated schema into `projectId` (a brand-new project or an existing
 * one). The shared planner (`remapProjectIds`) regenerates EVERY id (so a file can
 * be imported repeatedly, or onto the server it came from, with no collisions),
 * rewrites every cross-reference and drops references that no longer resolve;
 * the writers here only persist its result.
 *
 * Must be called inside a transaction so a failure leaves nothing half-written.
 */
export async function writeSchemaInto(
  manager: EntityManager,
  projectId: string,
  schema: SchemaModel,
  options: WriteOptions = {},
): Promise<WrittenSchema> {
  const ctx: WriteContext = { manager, projectId, options };
  // Image files first: an image element whose file is missing is dropped by the plan.
  const fileOf = await writeImages(ctx, schema);
  const stacking = options.stackAboveExisting
    ? await stackingFor(ctx, schema.elements.filter((e) => importsElement(e, fileOf)))
    : undefined;
  const plan = remapProjectIds(schema, {
    dx: options.dx,
    dy: options.dy,
    ...stacking,
    fileOf,
    linkExisting: options.linkExisting,
  });
  // Parents before children: elements and arrows may point at tables and messages.
  await writeTables(ctx, plan.tables);
  await writeRelationships(ctx, plan.relationships);
  await writeElements(ctx, plan.elements);
  await writeSequence(ctx, plan);
  return plan;
}

/** Stack merged elements above the project's and put its slides after the existing ones. */
async function stackingFor(
  ctx: WriteContext,
  elements: CanvasElementModel[],
): Promise<ReturnType<typeof planImportStacking> | undefined> {
  if (!elements.length) return undefined;
  const existing = await existingContent(ctx, elements.some((e) => e.slide));
  return planImportStacking(elements, existing, ctx.options.joinPresentations);
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
