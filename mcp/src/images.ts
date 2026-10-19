// Loading an image for a tool: an inline SVG, base64 data, a local file or a URL,
// checked against the same type/size limits the backend enforces.

import { lookup } from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { extname } from 'node:path';
import {
  IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  base64ToBytes,
  bytesToBase64,
  imageSize,
  textToBase64,
  type ImageSize,
} from '@dbdesigner/shared';
import { UserError } from './model';

export interface ImageInput {
  /** Inline SVG markup. */
  svg?: string;
  /** Base64 file contents (or a data: URL). */
  data?: string;
  mimeType?: string;
  /** Path of a file on the machine running the MCP server. */
  filePath?: string;
  /** http(s) URL to download. */
  url?: string;
}

export interface LoadedImage {
  mimeType: string;
  /** Base64 file contents. */
  data: string;
  /** Natural pixel size when it could be read. */
  size: ImageSize | null;
}

const BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

const FETCH_TIMEOUT_MS = 15_000;

/** True when running as a shared remote endpoint (see http.ts). */
const isRemote = (): boolean => process.env.DBDESIGNER_MCP_REMOTE === '1';

/** Loopback, link-local and private-network addresses (IPv4 and the common IPv6 forms). */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === '::1' || v === '::' || v.startsWith('fe80:') || v.startsWith('fc') || v.startsWith('fd')) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  const four = mapped ? mapped[1] : v;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(four);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
  );
}

/** Remote mode: refuse hosts that resolve to this server's own or private network. */
async function assertPublicHost(host: string): Promise<void> {
  const name = host.replace(/^\[|\]$/g, '');
  const addrs = isIP(name) ? [name] : (await lookup(name, { all: true })).map((a) => a.address);
  if (name === 'localhost' || name.endsWith('.internal') || name.endsWith('.local') || addrs.some(isPrivateAddress)) {
    throw new UserError('That URL points at a private or local address, which is not allowed here.');
  }
}

function check(mimeType: string, bytes: Uint8Array): LoadedImage {
  const mime = mimeType.toLowerCase().split(';')[0].trim();
  if (!IMAGE_MIME_TYPES.includes(mime)) {
    throw new UserError(
      `Unsupported image type "${mimeType}". Allowed: ${IMAGE_MIME_TYPES.join(', ')}.`,
    );
  }
  if (bytes.length === 0) throw new UserError('The image is empty.');
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new UserError(
      `The image is ${(bytes.length / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
    );
  }
  return { mimeType: mime, data: bytesToBase64(bytes), size: imageSize(mime, bytes) };
}

/** Load exactly one image source. Never touches the network unless `url` is given. */
export async function loadImage(input: ImageInput): Promise<LoadedImage> {
  const given = (['svg', 'data', 'filePath', 'url'] as const).filter((k) => !!input[k]?.trim());
  if (given.length !== 1) {
    throw new UserError(
      `Give exactly one image source: svg (inline markup), data (base64), filePath or url. Got: ${given.join(', ') || 'none'}.`,
    );
  }
  const source = given[0];

  if (source === 'svg') {
    const markup = input.svg!.trim();
    if (!/<svg[\s>]/i.test(markup)) {
      throw new UserError('`svg` must be SVG markup starting with <svg ...>.');
    }
    const withNs = /<svg[^>]*\sxmlns\s*=/i.test(markup)
      ? markup
      : markup.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    return check('image/svg+xml', base64ToBytes(textToBase64(withNs))!);
  }

  if (source === 'data') {
    const raw = input.data!.trim();
    const fromUrl = /^data:([^;,]+)[;,]/i.exec(raw)?.[1];
    const bytes = base64ToBytes(raw);
    if (!bytes) throw new UserError('`data` is not valid base64.');
    const mime = input.mimeType ?? fromUrl;
    if (!mime) throw new UserError('Give `mimeType` (e.g. image/png) with base64 `data`.');
    return check(mime, bytes);
  }

  if (source === 'filePath') {
    if (isRemote()) {
      throw new UserError('`filePath` is not available on the remote endpoint; use svg, data (base64) or url.');
    }
    const path = input.filePath!.trim();
    const mime = input.mimeType ?? BY_EXTENSION[extname(path).toLowerCase()];
    if (!mime) {
      throw new UserError(`Cannot tell the image type of "${path}"; use .png/.jpg/.gif/.webp/.svg or pass mimeType.`);
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch (err) {
      throw new UserError(`Cannot read "${path}": ${(err as Error).message}`);
    }
    return check(mime, bytes);
  }

  // url
  let url: URL;
  try {
    url = new URL(input.url!.trim());
  } catch {
    throw new UserError(`"${input.url}" is not a valid URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UserError('Only http(s) URLs can be downloaded.');
  }
  if (isRemote()) {
    try {
      await assertPublicHost(url.hostname);
    } catch (err) {
      throw err instanceof UserError ? err : new UserError(`Cannot resolve ${url.hostname}.`);
    }
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    // Redirects are refused remotely: a public URL could bounce to an internal one.
    const res = await fetch(url, { signal: ctl.signal, redirect: isRemote() ? 'error' : 'follow' });
    if (!res.ok) throw new UserError(`Downloading ${url.href} failed: HTTP ${res.status}.`);
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_IMAGE_BYTES) {
      throw new UserError(`The image at ${url.href} is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const mime =
      input.mimeType ??
      res.headers.get('content-type') ??
      BY_EXTENSION[extname(url.pathname).toLowerCase()] ??
      '';
    return check(mime, bytes);
  } catch (err) {
    if (err instanceof UserError) throw err;
    throw new UserError(`Downloading ${url.href} failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
