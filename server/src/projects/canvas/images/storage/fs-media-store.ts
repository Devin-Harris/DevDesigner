import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { SHA256_HEX, type ByteRange, type MediaStore } from './media-store';

const sha256Of = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

/**
 * Filesystem driver: `<root>/<aa>/<bb>/<sha256>`. Writes go to a temp file in the
 * same folder, are fsynced by writeFile's flush, renamed into place (atomic on one
 * volume) and then read back and re-hashed before `put` resolves, so a caller may
 * drop its own copy (the SQLite blob) only after `put` succeeded.
 */
export class FsMediaStore implements MediaStore {
  readonly kind = 'fs';
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  pathOf(sha256: string): string {
    if (!SHA256_HEX.test(sha256)) throw new Error(`Invalid media key "${sha256}".`);
    return join(this.root, sha256.slice(0, 2), sha256.slice(2, 4), sha256);
  }

  async put(sha256: string, data: Buffer): Promise<void> {
    if (sha256Of(data) !== sha256) throw new Error('Media bytes do not match their hash.');
    const path = this.pathOf(sha256);
    if (await this.intact(path, sha256)) return;
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(tmp, data, { flush: true });
      await rename(tmp, path);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
    if (!(await this.intact(path, sha256))) {
      throw new Error(`Media file ${sha256} failed verification after write.`);
    }
  }

  async size(sha256: string): Promise<number | null> {
    try {
      return (await stat(this.pathOf(sha256))).size;
    } catch {
      return null;
    }
  }

  read(sha256: string): Promise<Buffer> {
    return readFile(this.pathOf(sha256));
  }

  openRead(sha256: string, range?: ByteRange): Readable {
    return createReadStream(this.pathOf(sha256), range ? { start: range.start, end: range.end } : undefined);
  }

  async delete(sha256: string): Promise<void> {
    await unlink(this.pathOf(sha256)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }

  async *list(): AsyncIterable<{ sha256: string; modifiedAt: Date }> {
    const dirs = async (path: string): Promise<string[]> =>
      (await readdir(path, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory()).map((d) => d.name);
    for (const a of await dirs(this.root)) {
      for (const b of await dirs(join(this.root, a))) {
        const folder = join(this.root, a, b);
        for (const name of await readdir(folder).catch(() => [] as string[])) {
          if (!SHA256_HEX.test(name)) continue;
          const info = await stat(join(folder, name)).catch(() => null);
          if (info?.isFile()) yield { sha256: name, modifiedAt: info.mtime };
        }
      }
    }
  }

  private async intact(path: string, sha256: string): Promise<boolean> {
    try {
      return sha256Of(await readFile(path)) === sha256;
    } catch {
      return false;
    }
  }
}
