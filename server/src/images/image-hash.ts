import { createHash } from 'node:crypto';

/** Hex SHA-256 of image bytes: the key identical uploads/imports are deduplicated by. */
export function imageHash(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
