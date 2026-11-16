import type { Readable } from 'node:stream';

/** Inclusive byte range of a stored file. */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Content-addressed storage for image and video bytes (perf P4.5 / security S4.4).
 * Files are keyed by their hex SHA-256, so identical uploads share one file across
 * projects and a key never changes meaning. Metadata (project, type, size) stays in
 * SQLite (`project_images`); only the bytes live here.
 *
 * The filesystem driver is the only one today. An S3-compatible driver implements
 * the same interface (put = PutObject after a local hash check, openRead = ranged
 * GetObject, ...) and is selected with MEDIA_DRIVER.
 */
export interface MediaStore {
  /** Driver name, for logs. */
  readonly kind: string;
  /**
   * Store `data` under `sha256` and verify what landed (re-hash). Idempotent: an
   * existing, intact file is kept. Rejects when the bytes do not hash to `sha256`.
   */
  put(sha256: string, data: Buffer): Promise<void>;
  /** Size in bytes, or null when the file is missing. */
  size(sha256: string): Promise<number | null>;
  /** The whole file (exports, migrations). Rejects when missing. */
  read(sha256: string): Promise<Buffer>;
  /** A stream of the file, or of one inclusive byte range of it. */
  openRead(sha256: string, range?: ByteRange): Readable;
  /** Remove a file (no error when missing). */
  delete(sha256: string): Promise<void>;
  /** Every stored key with its last-modified time (garbage collection). */
  list(): AsyncIterable<{ sha256: string; modifiedAt: Date }>;
}

/** Nest injection token for the configured {@link MediaStore}. */
export const MEDIA_STORE = Symbol('MEDIA_STORE');

export const SHA256_HEX = /^[0-9a-f]{64}$/;
