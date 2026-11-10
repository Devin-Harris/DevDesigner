import { BadRequestException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Not, Repository } from 'typeorm';
import { MEDIA_MIME_TYPES, bytesMatchMediaType, maxMediaBytes } from '@devdesigner/shared';
import type { ProjectExportImage, UploadImageResponse } from '@devdesigner/shared';
import { ElementEntity } from '../elements/element.entity';
import { imageHash } from './image-hash';
import { ProjectImageEntity } from './project-image.entity';
import { svgRejectionReason } from './svg-safety';
import { QuotaService } from '../../../platform/quotas/quota.service';

/** Orphaned uploads younger than this survive, so undo/redo can still bring them back. */
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
/** Orphan cleanup runs at most this often per project (it scans every image element). */
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;

/** Storage and access control for the images behind canvas image elements. */
@Injectable()
export class ImagesService implements OnModuleInit {
  private readonly lastPrune = new Map<string, number>();

  constructor(
    @InjectRepository(ProjectImageEntity)
    private readonly images: Repository<ProjectImageEntity>,
    @InjectRepository(ElementEntity)
    private readonly elements: Repository<ElementEntity>,
    private readonly quota: QuotaService,
  ) {}

  /** Rows stored before `byteSize` existed get it from their blob (once; quotas sum it). */
  async onModuleInit(): Promise<void> {
    await this.images.query('UPDATE project_images SET byteSize = LENGTH(data) WHERE byteSize IS NULL AND data IS NOT NULL');
  }

  /** Store an upload for a project the caller may write to (checked by the route guard). */
  async upload(projectId: string, mimeType: string, base64: string): Promise<UploadImageResponse> {
    const data = this.validate(mimeType, base64);
    const sha256 = imageHash(data);
    // Same bytes already stored for this project: reuse that file (and the client's cached copy).
    const existing = await this.images.findOne({ where: { projectId, sha256, mimeType }, select: { id: true } });
    if (existing) {
      return { id: existing.id };
    }
    await this.quota.assertImageRoom(projectId, data.length);
    const saved = await this.images.save(this.images.create({ projectId, mimeType, data, sha256, byteSize: data.length }));
    void this.pruneOrphans(projectId);
    return { id: saved.id };
  }

  /**
   * Bytes + type for display. The route guard has already resolved the image's
   * project and authorized the read, so refused requests never load the blob.
   */
  async read(projectId: string, imageId: string): Promise<{ mimeType: string; data: Buffer }> {
    const image = await this.images.findOne({
      where: { id: imageId, projectId },
      select: { id: true, mimeType: true, data: true },
    });
    if (!image) {
      throw new NotFoundException(`Image ${imageId} not found.`);
    }
    return { mimeType: image.mimeType, data: image.data };
  }

  /**
   * Bytes of `files` this project does not already store (same hash and type are
   * deduplicated on write, so they cost nothing): what a media quota should count.
   */
  async newBytes(projectId: string, files: Array<{ mimeType: string; data: Buffer }>): Promise<number> {
    if (!files.length) return 0;
    const hashed = files.map((f) => ({ ...f, sha256: imageHash(f.data) }));
    const have = await this.images.find({
      where: { projectId, sha256: In([...new Set(hashed.map((f) => f.sha256))]) },
      select: { id: true, sha256: true, mimeType: true },
    });
    const known = new Set(have.map((h) => `${h.sha256}:${h.mimeType}`));
    const counted = new Set<string>();
    let total = 0;
    for (const f of hashed) {
      const key = `${f.sha256}:${f.mimeType}`;
      if (known.has(key) || counted.has(key)) continue;
      counted.add(key);
      total += f.data.length;
    }
    return total;
  }

  async existsInProject(imageId: string, projectId: string): Promise<boolean> {
    return this.images.exists({ where: { id: imageId, projectId } });
  }

  /** Every image a project's elements reference, base64-encoded for an export file. */
  async exportForProject(projectId: string): Promise<ProjectExportImage[]> {
    const ids = await this.referencedIds(projectId);
    if (!ids.length) {
      return [];
    }
    const images = await this.images.find({ where: { projectId, id: In(ids) } });
    return images.map((i) => ({ id: i.id, mimeType: i.mimeType, data: i.data.toString('base64') }));
  }

  /** Decode + validate an embedded/uploaded image; throws 400 on anything unacceptable. */
  validate(mimeType: string, base64: string): Buffer {
    if (!MEDIA_MIME_TYPES.includes(mimeType)) {
      throw new BadRequestException(
        `Unsupported file type. Use ${MEDIA_MIME_TYPES.join(', ')}.`,
      );
    }
    const data = Buffer.from(base64, 'base64');
    if (data.length === 0) {
      throw new BadRequestException('The image is empty.');
    }
    const max = maxMediaBytes(mimeType);
    if (data.length > max) {
      throw new BadRequestException(
        `${mimeType.startsWith('video/') ? 'Videos' : 'Images'} can be at most ${Math.round(max / (1024 * 1024))} MB.`,
      );
    }
    if (!bytesMatchMediaType(mimeType, data)) {
      throw new BadRequestException(`The file's contents are not a valid ${mimeType} file.`);
    }
    if (mimeType === 'image/svg+xml') {
      const reason = svgRejectionReason(data.toString('utf8'));
      if (reason) {
        throw new BadRequestException(`This SVG can't be used: it ${reason}.`);
      }
    }
    return data;
  }

  private async referencedIds(projectId: string): Promise<string[]> {
    const rows = await this.elements.find({
      where: { projectId, type: 'image' },
      select: { id: true, fileId: true },
    });
    return [...new Set(rows.map((r) => r.fileId).filter((v): v is string => !!v))];
  }

  /** Delete old uploads no element references any more (best effort). */
  private async pruneOrphans(projectId: string): Promise<void> {
    const now = Date.now();
    if (now - (this.lastPrune.get(projectId) ?? 0) < PRUNE_INTERVAL_MS) {
      return;
    }
    this.lastPrune.set(projectId, now);
    try {
      const referenced = await this.referencedIds(projectId);
      await this.images.delete({
        projectId,
        createdAt: LessThan(new Date(Date.now() - ORPHAN_GRACE_MS)),
        ...(referenced.length ? { id: Not(In(referenced)) } : {}),
      });
    } catch {
      // Cleanup is opportunistic; never fail an upload over it.
    }
  }
}
