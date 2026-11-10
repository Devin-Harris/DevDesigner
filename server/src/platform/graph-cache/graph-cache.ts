import { promisify } from 'node:util';
import { gzip as gzipCb } from 'node:zlib';
import { Injectable, StreamableFile } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AccessLevel, ProjectGraphResponse } from '@devdesigner/shared';
import type { Request, Response } from 'express';
import {
  etagMatches,
  projectGraphTag,
  projectRevision,
  setGraphCacheHeaders,
} from '../http/project-revision';

const gzip = promisify(gzipCb);

/** Same threshold as the compression middleware in main.ts. */
const GZIP_MIN_BYTES = 1024;

interface Entry {
  projectId: string;
  json: Buffer;
  gzip?: Buffer;
}

/**
 * Serialized project graphs keyed by project + revision + access level (perf
 * P3.4 / S8), bounded by total bytes (GRAPH_CACHE_MAX_BYTES, default 64 MB; 0 =
 * off). A hit skips the ~9 queries, the mapping, JSON.stringify and gzip: the
 * gzipped body is computed once per entry and sent with Content-Encoding set, which
 * the compression middleware leaves alone. A new revision makes older entries of
 * that project unreachable, and they are dropped as soon as the new one is stored.
 */
@Injectable()
export class GraphCache {
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;
  readonly maxBytes: number;

  constructor(config: ConfigService) {
    this.maxBytes = Number(config.get<number>('GRAPH_CACHE_MAX_BYTES', 64 * 1024 * 1024));
  }

  get size(): number {
    return this.entries.size;
  }

  get totalBytes(): number {
    return this.bytes;
  }

  /**
   * Answer a graph GET: 304 when the caller's tag is current, else the (cached or
   * freshly built) body. The revision is taken BEFORE building, so a write landing
   * mid-read leaves the tag outdated rather than the body.
   */
  async respond(
    projectId: string,
    accessLevel: AccessLevel,
    req: Request,
    res: Response,
    build: () => Promise<ProjectGraphResponse>,
  ): Promise<StreamableFile | undefined> {
    const revision = projectRevision(projectId);
    const tag = projectGraphTag(projectId, accessLevel, revision);
    setGraphCacheHeaders(res, tag);
    if (etagMatches(req.headers['if-none-match'], tag)) {
      res.status(304);
      return undefined;
    }
    const key = `${projectId}:${revision}:${accessLevel}`;
    let entry = this.get(key);
    if (!entry) {
      const graph = await build();
      entry = { projectId, json: Buffer.from(JSON.stringify(graph)) };
      // Only a body read at the still-current revision may be reused.
      if (projectRevision(projectId) === revision) this.set(key, entry);
    }
    const acceptsGzip = /\bgzip\b/i.test(String(req.headers['accept-encoding'] ?? ''));
    if (acceptsGzip && entry.json.length >= GZIP_MIN_BYTES) {
      if (!entry.gzip) {
        entry.gzip = await gzip(entry.json);
        if (this.entries.get(key) === entry) this.account(entry.gzip.length);
      }
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      return new StreamableFile(entry.gzip, { type: 'application/json; charset=utf-8', length: entry.gzip.length });
    }
    return new StreamableFile(entry.json, { type: 'application/json; charset=utf-8', length: entry.json.length });
  }

  /** Drop every cached body of a project (viewport change, delete). */
  invalidateProject(projectId: string): void {
    for (const [key, entry] of this.entries) if (entry.projectId === projectId) this.remove(key);
  }

  private get(key: string): Entry | undefined {
    const entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return entry;
  }

  private set(key: string, entry: Entry): void {
    const size = entry.json.length;
    if (this.maxBytes <= 0 || size > this.maxBytes / 4) return;
    // Older revisions of this project can never be asked for again.
    this.invalidateProject(entry.projectId);
    this.entries.set(key, entry);
    this.account(size);
  }

  private account(delta: number): void {
    this.bytes += delta;
    for (const key of this.entries.keys()) {
      if (this.bytes <= this.maxBytes) break;
      this.remove(key);
    }
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entry.json.length + (entry.gzip?.length ?? 0);
  }
}
