import { In } from 'typeorm';
import type { SchemaModel } from '@devdesigner/shared';
import { ProjectImageEntity } from '../../canvas/images/project-image.entity';
import { imageHash } from '../../canvas/images/image-hash';
import { IdMap, insertAll, type WriteContext } from './write-context';

/**
 * Image files get fresh ids; returns the lookup that re-points an image element's
 * old `fileId` (undefined when its file is not in the import, so the element drops).
 */
export async function writeImages(
  ctx: WriteContext,
  schema: SchemaModel,
): Promise<(old: string | undefined) => string | undefined> {
  // Bytes this project already stores (same hash) are not stored again: the element is
  // pointed at the existing file. With linkExisting, a fileId already in this project
  // may be referenced without embedding its bytes at all (same-project duplicates).
  const imageIds = new IdMap();
  const imported = (ctx.options.images ?? []).map((img) => ({ ...img, sha256: img.sha256 ?? imageHash(img.data) }));
  const reuse = new Map<string, string>();
  if (imported.length) {
    const have = await ctx.manager.find(ProjectImageEntity, {
      where: { projectId: ctx.projectId, sha256: In([...new Set(imported.map((i) => i.sha256))]) },
      select: { id: true, sha256: true, mimeType: true },
    });
    for (const img of imported) {
      const hit = have.find((h) => h.sha256 === img.sha256 && h.mimeType === img.mimeType);
      if (hit) reuse.set(img.id, hit.id);
    }
  }
  const fresh = imported.filter((img) => !reuse.has(img.id));
  for (const img of fresh) imageIds.mint(img.id);
  await insertAll(
    ctx.manager,
    ProjectImageEntity,
    fresh.map((img) => ({
      id: imageIds.get(img.id)!,
      projectId: ctx.projectId,
      mimeType: img.mimeType,
      // Files already in the media store keep no copy in SQLite.
      data: img.stored ? null : img.data,
      location: img.stored ? ('media' as const) : ('db' as const),
      sha256: img.sha256,
      byteSize: img.data.length,
    })),
  );
  const embedded = new Set(imported.map((i) => i.id));
  const referenced = [
    ...new Set(
      schema.elements
        .filter((e) => e.type === 'image' && e.fileId && !embedded.has(e.fileId))
        .map((e) => e.fileId as string),
    ),
  ];
  if (ctx.options.linkExisting && referenced.length) {
    const own = await ctx.manager.find(ProjectImageEntity, {
      where: { projectId: ctx.projectId, id: In(referenced) },
      select: { id: true },
    });
    for (const row of own) reuse.set(row.id, row.id);
  }
  const fileOf = (old: string | undefined): string | undefined =>
    old === undefined ? undefined : (imageIds.get(old) ?? reuse.get(old));
  return fileOf;
}
