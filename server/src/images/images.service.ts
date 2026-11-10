import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Not, Repository } from 'typeorm';
import { MEDIA_MIME_TYPES, bytesMatchMediaType, maxMediaBytes } from '@devdesigner/shared';
import type { ProjectExportImage, UploadImageResponse } from '@devdesigner/shared';
import { AccessService } from '../access/access.service';
import { ElementEntity } from '../elements/element.entity';
import { imageHash } from './image-hash';
import { ProjectImageEntity } from './project-image.entity';
import { svgRejectionReason } from './svg-safety';

/** Orphaned uploads younger than this survive, so undo/redo can still bring them back. */
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
/** Orphan cleanup runs at most this often per project (it scans every image element). */
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;

/** Storage and access control for the images behind canvas image elements. */
@Injectable()
export class ImagesService {
  private readonly lastPrune = new Map<string, number>();

  constructor(
    @InjectRepository(ProjectImageEntity)
    private readonly images: Repository<ProjectImageEntity>,
    @InjectRepository(ElementEntity)
    private readonly elements: Repository<ElementEntity>,
    private readonly access: AccessService,
  ) {}

  async upload(
    projectId: string,
    mimeType: string,
    base64: string,
    userId: string | null,
    shareToken: string | null,
  ): Promise<UploadImageResponse> {
    await this.access.assertCanWrite(projectId, userId, shareToken);
    const data = this.validate(mimeType, base64);
    const sha256 = imageHash(data);
    // Same bytes already stored for this project: reuse that file (and the client's cached copy).
    const existing = await this.images.findOne({ where: { projectId, sha256, mimeType }, select: { id: true } });
    if (existing) {
      return { id: existing.id };
    }
    const saved = await this.images.save(this.images.create({ projectId, mimeType, data, sha256 }));
    void this.pruneOrphans(projectId);
    return { id: saved.id };
  }

  /** Bytes + type for display; the caller must be able to read the owning project. */
  async read(
    imageId: string,
    userId: string | null,
    shareToken: string | null,
  ): Promise<{ mimeType: string; data: Buffer }> {
    // Authorize before loading the blob, so refused requests never read the bytes.
    const meta = await this.images.findOne({ where: { id: imageId }, select: { id: true, projectId: true } });
    if (!meta) {
      throw new NotFoundException(`Image ${imageId} not found.`);
    }
    await this.access.assertCanRead(meta.projectId, userId, shareToken);
    const image = await this.images.findOne({ where: { id: imageId }, select: { id: true, mimeType: true, data: true } });
    if (!image) {
      throw new NotFoundException(`Image ${imageId} not found.`);
    }
    return { mimeType: image.mimeType, data: image.data };
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
