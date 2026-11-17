import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  type OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Not, Repository } from 'typeorm';
import { MEDIA_MIME_TYPES, bytesMatchMediaType, maxMediaBytes } from '@devdesigner/shared';
import type { ProjectExportImage, UploadImageResponse } from '@devdesigner/shared';
import type { Readable } from 'node:stream';
import { ElementEntity } from '../elements/element.entity';
import { imageHash } from './image-hash';
import { ProjectImageEntity } from './project-image.entity';
import { QuotaService } from '../../../platform/quotas/quota.service';
import { MEDIA_STORE, type ByteRange, type MediaStore } from './storage/media-store';
import { sanitizeSvg, SvgRejectedError } from './storage/svg-sanitizer';
import type { ImportedImage } from '../../project-file/writers/write-context';
import { track } from '../../../platform/analytics/track';

const TRACKED_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'video/mp4', 'video/webm'] as const;
type TrackedMediaType = (typeof TRACKED_MEDIA_TYPES)[number] | 'other';
const mediaTypeOf = (mimeType: string): TrackedMediaType =>
  (TRACKED_MEDIA_TYPES as readonly string[]).includes(mimeType) ? (mimeType as TrackedMediaType) : 'other';

/** Orphaned uploads younger than this survive, so undo/redo can still bring them back. */
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
/** Orphan cleanup runs at most this often per project (it scans every image element). */
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;

/** What GET /images/:id serves: a stored file (streamable) or, if the store failed, legacy bytes. */
export type ImageSource =
  | { mimeType: string; sha256: string; size: number; data?: undefined }
  | { mimeType: string; sha256: string; size: number; data: Buffer };

/**
 * Storage and access control for the images and videos behind canvas image elements.
 * Metadata lives in `project_images`; bytes in the content-addressed media store
 * (`storage/`). Rows from before the store keep their blob until moved: lazily on
 * first read, or all at once by `npm run media:migrate`. A blob is only cleared after
 * its file has been written and verified.
 */
@Injectable()
export class ImagesService implements OnModuleInit {
  private readonly logger = new Logger(ImagesService.name);
  private readonly lastPrune = new Map<string, number>();

  constructor(
    @InjectRepository(ProjectImageEntity)
    private readonly images: Repository<ProjectImageEntity>,
    @InjectRepository(ElementEntity)
    private readonly elements: Repository<ElementEntity>,
    private readonly quota: QuotaService,
    @Inject(MEDIA_STORE) private readonly store: MediaStore,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  /** Rows stored before `byteSize` existed get it from their blob (once; quotas sum it). */
  async onModuleInit(): Promise<void> {
    await this.images.query('UPDATE project_images SET byteSize = LENGTH(data) WHERE byteSize IS NULL AND data IS NOT NULL');
  }

  /** Store a base64 upload (JSON route, MCP) for a project the caller may write to. */
  upload(projectId: string, mimeType: string, base64: string): Promise<UploadImageResponse> {
    return this.uploadBytes(projectId, mimeType, this.decodeBase64(base64));
  }

  /** Store raw bytes (raw-body route) for a project the caller may write to. */
  async uploadBytes(projectId: string, mimeType: string, raw: Buffer): Promise<UploadImageResponse> {
    const data = this.validateBytes(mimeType, raw);
    const sha256 = imageHash(data);
    // Same bytes already stored for this project: reuse that file (and the client's cached copy).
    const existing = await this.images.findOne({ where: { projectId, sha256, mimeType }, select: { id: true } });
    if (existing) {
      track(this.events, 'image.uploaded', { mimeType: mediaTypeOf(mimeType), bytes: data.length, deduped: true }, { projectId });
      return { id: existing.id };
    }
    await this.quota.assertImageRoom(projectId, data.length);
    await this.store.put(sha256, data);
    const saved = await this.images.save(
      this.images.create({ projectId, mimeType, data: null, location: 'media', sha256, byteSize: data.length }),
    );
    // A concurrent orphan prune elsewhere may have removed a shared file in between.
    if ((await this.store.size(sha256)) === null) await this.store.put(sha256, data);
    void this.pruneOrphans(projectId);
    track(this.events, 'image.uploaded', { mimeType: mediaTypeOf(mimeType), bytes: data.length, deduped: false }, { projectId });
    return { id: saved.id };
  }

  /**
   * What to serve for an image. The route guard has already resolved the image's
   * project and authorized the read. A legacy row is moved to the media store here
   * (write + verify, then clear the blob); if that fails its blob is served as is.
   */
  async source(projectId: string, imageId: string): Promise<ImageSource> {
    const image = await this.images.findOne({
      where: { id: imageId, projectId },
      select: { id: true, mimeType: true, sha256: true, byteSize: true, location: true },
    });
    if (!image) {
      throw new NotFoundException(`Image ${imageId} not found.`);
    }
    if (image.location === 'media' && image.sha256) {
      const size = await this.store.size(image.sha256);
      if (size === null) {
        this.logger.error(`Media file ${image.sha256} of image ${imageId} is missing.`);
        throw new NotFoundException(`Image ${imageId} not found.`);
      }
      return { mimeType: image.mimeType, sha256: image.sha256, size };
    }
    const legacy = await this.images.findOne({ where: { id: imageId, projectId }, select: { id: true, data: true } });
    const data = legacy?.data;
    if (!data) throw new NotFoundException(`Image ${imageId} not found.`);
    const sha256 = await this.moveToStore(imageId, data);
    return sha256
      ? { mimeType: image.mimeType, sha256, size: data.length }
      : { mimeType: image.mimeType, sha256: imageHash(data), size: data.length, data };
  }

  /** Stream a stored file (or one byte range of it). */
  openRead(sha256: string, range?: ByteRange): Readable {
    return this.store.openRead(sha256, range);
  }

  /**
   * Copy a legacy blob into the media store, verify it, then clear the blob. Returns
   * the hash, or null when the store write failed (the blob is left untouched).
   */
  async moveToStore(imageId: string, data: Buffer): Promise<string | null> {
    const sha256 = imageHash(data);
    try {
      await this.store.put(sha256, data);
    } catch (err) {
      this.logger.warn(`Could not move image ${imageId} to the media store: ${(err as Error).message}`);
      return null;
    }
    await this.images.update(
      { id: imageId, location: 'db' },
      { data: null, location: 'media', sha256, byteSize: data.length },
    );
    return sha256;
  }

  async existsInProject(imageId: string, projectId: string): Promise<boolean> {
    return this.images.exists({ where: { id: imageId, projectId } });
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

  /**
   * Put validated import files into the media store before the import's transaction,
   * so the rows it writes carry no blob. A rolled-back import leaves only
   * content-addressed files that the media GC reclaims.
   */
  async storeImported(files: ImportedImage[]): Promise<ImportedImage[]> {
    const out: ImportedImage[] = [];
    for (const file of files) {
      const sha256 = imageHash(file.data);
      await this.store.put(sha256, file.data);
      out.push({ ...file, sha256, stored: true });
    }
    return out;
  }

  /** Every image a project's elements reference, base64-encoded for an export file. */
  async exportForProject(projectId: string): Promise<ProjectExportImage[]> {
    const ids = await this.referencedIds(projectId);
    if (!ids.length) {
      return [];
    }
    const rows = await this.images.find({
      where: { projectId, id: In(ids) },
      select: { id: true, mimeType: true, sha256: true, location: true },
    });
    const out: ProjectExportImage[] = [];
    for (const row of rows) {
      let data: Buffer | null = null;
      if (row.location === 'media' && row.sha256) {
        data = await this.store.read(row.sha256).catch(() => null);
      } else {
        data = (await this.images.findOne({ where: { id: row.id }, select: { id: true, data: true } }))?.data ?? null;
      }
      if (data) out.push({ id: row.id, mimeType: row.mimeType, data: data.toString('base64') });
      else this.logger.error(`Export skipped image ${row.id}: its bytes are missing.`);
    }
    return out;
  }

  /** Decode + validate an embedded/uploaded image; throws 400 on anything unacceptable. */
  validate(mimeType: string, base64: string): Buffer {
    return this.validateBytes(mimeType, this.decodeBase64(base64));
  }

  /**
   * Validate raw bytes: allowed type, size, magic bytes. SVG is re-serialized through
   * the allow-list sanitizer, and the SANITIZED bytes are what gets stored.
   */
  validateBytes(mimeType: string, data: Buffer): Buffer {
    if (!MEDIA_MIME_TYPES.includes(mimeType)) {
      throw new BadRequestException(`Unsupported file type. Use ${MEDIA_MIME_TYPES.join(', ')}.`);
    }
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
      try {
        return Buffer.from(sanitizeSvg(data.toString('utf8')), 'utf8');
      } catch (err) {
        if (err instanceof SvgRejectedError) {
          throw new BadRequestException(`This SVG can't be used: it ${err.message}.`);
        }
        throw err;
      }
    }
    return data;
  }

  private decodeBase64(base64: string): Buffer {
    return Buffer.from(base64, 'base64');
  }

  private async referencedIds(projectId: string): Promise<string[]> {
    const rows = await this.elements.find({
      where: { projectId, type: In(['image', 'embed']) },
      select: { id: true, fileId: true },
    });
    return [...new Set(rows.map((r) => r.fileId).filter((v): v is string => !!v))];
  }

  /** Delete old uploads no element references any more, and files nothing else uses (best effort). */
  private async pruneOrphans(projectId: string): Promise<void> {
    const now = Date.now();
    if (now - (this.lastPrune.get(projectId) ?? 0) < PRUNE_INTERVAL_MS) {
      return;
    }
    this.lastPrune.set(projectId, now);
    try {
      const referenced = await this.referencedIds(projectId);
      const where = {
        projectId,
        createdAt: LessThan(new Date(Date.now() - ORPHAN_GRACE_MS)),
        ...(referenced.length ? { id: Not(In(referenced)) } : {}),
      };
      const doomed = await this.images.find({ where, select: { id: true, sha256: true, location: true } });
      if (!doomed.length) return;
      await this.images.delete({ id: In(doomed.map((d) => d.id)) });
      const hashes = [...new Set(doomed.filter((d) => d.location === 'media' && d.sha256).map((d) => d.sha256 as string))];
      for (const sha256 of hashes) {
        // Files are shared by hash across projects: only remove one nobody points at.
        if (!(await this.images.exists({ where: { sha256, location: 'media' } }))) await this.store.delete(sha256);
      }
    } catch {
      // Cleanup is opportunistic; never fail an upload over it.
    }
  }
}
