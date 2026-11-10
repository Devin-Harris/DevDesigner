import { BadRequestException, Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';
import type { UploadImageResponse } from '@devdesigner/shared';
import { ProjectAccess, RequiresAccess, type ResolvedProjectAccess } from '../../../collaboration/access/access-policy';
import { RateLimit } from '../../../platform/throttle/rate-limit';
import { UploadImageDto } from './dto/upload-image.dto';
import { ImagesService } from './images.service';
import type { ByteRange } from './storage/media-store';

/**
 * Parse a single `bytes=` range against a file size. Returns the range, 'invalid'
 * for an unsatisfiable one (416), or null when the header is absent or not a single
 * byte range (the whole file is sent, as RFC 9110 allows).
 */
export function parseRange(header: string | undefined, size: number): ByteRange | 'invalid' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}

const ifNoneMatch = (req: Request, etag: string): boolean =>
  String(req.headers['if-none-match'] ?? '')
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .some((t) => t === etag || t === '*');

/** Upload and fetch the image / video files behind canvas image elements. */
@Controller()
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  /** JSON upload `{ mimeType, data: base64 }` (MCP and older clients). */
  @Post('projects/:projectId/images')
  @RequiresAccess('write')
  @RateLimit('imageUpload')
  upload(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Body() dto: UploadImageDto,
  ): Promise<UploadImageResponse> {
    return this.images.upload(projectId, dto.mimeType, dto.data);
  }

  /**
   * Raw upload: the request body IS the file and Content-Type is its media type
   * (no base64: a third smaller and never parsed as JSON). Body parsed by the raw
   * parser main.ts mounts on this path.
   */
  @Post('projects/:projectId/images/raw')
  @RequiresAccess('write')
  @RateLimit('imageUpload')
  uploadRaw(@ProjectAccess() { projectId }: ResolvedProjectAccess, @Req() req: Request): Promise<UploadImageResponse> {
    const mimeType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (!Buffer.isBuffer(req.body)) {
      throw new BadRequestException('Send the file bytes as the request body with its media type as Content-Type.');
    }
    return this.images.uploadBytes(projectId, mimeType, req.body);
  }

  /**
   * The file, streamed. Content-addressed, so the ETag is its hash and it may be cached
   * forever; `Range` requests get 206 (video seeking) and bad ranges 416.
   */
  @Get('images/:imageId')
  @RequiresAccess('read', { from: 'image' })
  async get(
    @ProjectAccess() { projectId }: ResolvedProjectAccess,
    @Param('imageId') imageId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const source = await this.images.source(projectId, imageId);
    const etag = `"${source.sha256}"`;
    res.set({
      'Content-Type': source.mimeType,
      // Belt and braces: even if opened directly, an SVG can't run script or load anything.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=31536000, immutable',
      ETag: etag,
      'Accept-Ranges': 'bytes',
    });
    if (ifNoneMatch(req, etag)) {
      res.status(304).end();
      return;
    }
    const range = parseRange(typeof req.headers.range === 'string' ? req.headers.range : undefined, source.size);
    if (range === 'invalid') {
      res.status(416).set('Content-Range', `bytes */${source.size}`).end();
      return;
    }
    if (source.data) {
      // The media store was unavailable: serve the legacy bytes from memory.
      res.status(range ? 206 : 200);
      if (range) res.set('Content-Range', `bytes ${range.start}-${range.end}/${source.size}`);
      res.send(range ? source.data.subarray(range.start, range.end + 1) : source.data);
      return;
    }
    if (range) {
      // A partial body must reach the client byte-exact: no compression.
      res.status(206).set({
        'Content-Range': `bytes ${range.start}-${range.end}/${source.size}`,
        'Content-Length': String(range.end - range.start + 1),
        'Cache-Control': 'private, max-age=31536000, immutable, no-transform',
      });
    } else {
      res.status(200).set('Content-Length', String(source.size));
    }
    try {
      await pipeline(this.images.openRead(source.sha256, range ?? undefined), res);
    } catch {
      // Client went away mid-stream, or the file vanished: nothing more to send.
      if (!res.headersSent) res.status(500).end();
      else res.destroy();
    }
  }
}
