import { dirname, join, resolve } from 'node:path';
import { FsMediaStore } from './fs-media-store';
import type { MediaStore } from './media-store';

/**
 * Where media files live: MEDIA_DIR, else a `media` folder next to the SQLite file,
 * so a deploy that keeps DATABASE_PATH on a persistent volume (Railway) keeps the
 * media on that same volume with no extra configuration.
 */
export function mediaDirFrom(env: { MEDIA_DIR?: string; DATABASE_PATH?: string }): string {
  if (env.MEDIA_DIR && env.MEDIA_DIR.trim() !== '') return resolve(env.MEDIA_DIR.trim());
  return join(dirname(resolve(env.DATABASE_PATH?.trim() || 'devdesigner.sqlite')), 'media');
}

/** The configured store (MEDIA_DRIVER: only `fs` exists today). */
export function createMediaStore(env: { MEDIA_DRIVER?: string; MEDIA_DIR?: string; DATABASE_PATH?: string }): MediaStore {
  const driver = (env.MEDIA_DRIVER ?? 'fs').trim().toLowerCase() || 'fs';
  if (driver !== 'fs') throw new Error(`Unknown MEDIA_DRIVER "${driver}" (supported: fs).`);
  return new FsMediaStore(mediaDirFrom(env));
}
