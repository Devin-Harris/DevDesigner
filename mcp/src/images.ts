// Loading an image for a tool: an inline SVG, base64 data, a local file or a URL,
// checked against the same type/size limits the backend enforces.

import { lookup } from 'node:dns/promises';
import { readFile, realpath, stat } from 'node:fs/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { extname, isAbsolute, relative } from 'node:path';
import ipaddr from 'ipaddr.js';
import {
  IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  base64ToBytes,
  bytesToBase64,
  imageSize,
  sniffMediaType,
  textToBase64,
  type ImageSize,
} from '@devdesigner/shared';
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
const MAX_REDIRECTS = 3;

/** True when running as a shared remote endpoint (see http.ts). */
const isRemote = (): boolean => process.env.DEVDESIGNER_MCP_REMOTE === '1';

/**
 * Anything but a plain public unicast address: loopback, private, link-local, CGNAT,
 * reserved, multicast, and IPv6 forms that reach those (v4-mapped, NAT64, 6to4, ULA...).
 * Unparseable input counts as private.
 */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.replace(/^\[|\]$/g, '').split('%')[0];
  if (!ipaddr.isValid(v)) return true;
  return ipaddr.process(v).range() !== 'unicast';
}

interface Vetted {
  address: string;
  family: 4 | 6;
}

const privateHost = (): UserError =>
  new UserError('That URL points at a private or local address, which is not allowed here.');

/** Remote mode: resolve `host` once and refuse it unless every address is public unicast. */
export async function vetHost(host: string): Promise<Vetted> {
  const name = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.internal') || name.endsWith('.local')) {
    throw privateHost();
  }
  let addrs: Array<{ address: string; family: number }>;
  if (isIP(name)) {
    addrs = [{ address: name, family: isIP(name) }];
  } else {
    try {
      addrs = await lookup(name, { all: true, verbatim: true });
    } catch {
      throw new UserError(`Cannot resolve ${name}.`);
    }
  }
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw privateHost();
  }
  return { address: addrs[0].address, family: addrs[0].family === 6 ? 6 : 4 };
}

const sameAddress = (a: string, b: string): boolean =>
  ipaddr.isValid(a) && ipaddr.isValid(b) && ipaddr.process(a).toString() === ipaddr.process(b).toString();

/** One GET; with `pinned`, the socket connects to that vetted IP (no second DNS lookup). */
function get(url: URL, pinned: Vetted | null, signal: AbortSignal): Promise<http.IncomingMessage> {
  const pin: LookupFunction | undefined = pinned
    ? (_host, options, callback) => {
        if (options.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
        else callback(null, pinned.address, pinned.family);
      }
    : undefined;
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.get(url, { signal, lookup: pin, agent: false, headers: { accept: 'image/*' } }, (res) => {
      const peer = res.socket.remoteAddress;
      if (pinned && (!peer || !sameAddress(peer, pinned.address))) {
        res.destroy();
        reject(privateHost());
        return;
      }
      resolve(res);
    });
    req.on('error', reject);
  });
}

/** Read a response body, aborting as soon as it passes `limit` bytes. */
async function readCapped(res: http.IncomingMessage, limit: number, href: string): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > limit) {
      res.destroy();
      throw new UserError(`The image at ${href} is larger than ${limit / 1024 / 1024} MB.`);
    }
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/** Download `url`, following up to MAX_REDIRECTS redirects (each hop re-vetted remotely). */
async function download(url: URL, signal: AbortSignal): Promise<{ bytes: Uint8Array; contentType: string | null; final: URL }> {
  let current = url;
  for (let hop = 0; ; hop += 1) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') {
      throw new UserError('Only http(s) URLs can be downloaded.');
    }
    const pinned = isRemote() ? await vetHost(current.hostname) : null;
    const res = await get(current, pinned, signal);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      if (hop >= MAX_REDIRECTS) throw new UserError(`Downloading ${url.href} failed: too many redirects.`);
      current = new URL(res.headers.location, current);
      continue;
    }
    if (status < 200 || status >= 300) {
      res.resume();
      throw new UserError(`Downloading ${url.href} failed: HTTP ${status}.`);
    }
    if (Number(res.headers['content-length'] ?? 0) > MAX_IMAGE_BYTES) {
      res.destroy();
      throw new UserError(`The image at ${url.href} is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
    }
    const bytes = await readCapped(res, MAX_IMAGE_BYTES, url.href);
    return { bytes, contentType: res.headers['content-type'] ?? null, final: current };
  }
}

/**
 * Validate type and size. The bytes must really be one of the accepted image formats
 * (magic bytes); that sniffed type is what gets uploaded.
 */
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
  const sniffed = sniffMediaType(bytes);
  if (!sniffed || !IMAGE_MIME_TYPES.includes(sniffed)) {
    throw new UserError('The contents are not a PNG, JPEG, GIF, WebP or SVG image.');
  }
  return { mimeType: sniffed, data: bytesToBase64(bytes), size: imageSize(sniffed, bytes) };
}

/** Local file source: image extensions only, optionally confined to DEVDESIGNER_IMAGE_ROOT. */
async function readImageFile(path: string): Promise<{ mime: string; bytes: Uint8Array }> {
  const mime = BY_EXTENSION[extname(path).toLowerCase()];
  if (!mime) {
    throw new UserError(`"${path}" is not an image file; use a .png/.jpg/.jpeg/.gif/.webp/.svg file.`);
  }
  let real: string;
  try {
    real = await realpath(path);
  } catch (err) {
    throw new UserError(`Cannot read "${path}": ${(err as Error).message}`);
  }
  const root = process.env.DEVDESIGNER_IMAGE_ROOT?.trim();
  if (root) {
    const realRoot = await realpath(root).catch(() => root);
    const rel = relative(realRoot, real);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new UserError(`"${path}" is outside DEVDESIGNER_IMAGE_ROOT (${root}).`);
    }
  }
  const info = await stat(real);
  if (!info.isFile()) throw new UserError(`"${path}" is not a file.`);
  if (info.size > MAX_IMAGE_BYTES) {
    throw new UserError(
      `The image is ${(info.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
    );
  }
  try {
    return { mime, bytes: await readFile(real) };
  } catch (err) {
    throw new UserError(`Cannot read "${path}": ${(err as Error).message}`);
  }
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
    const { mime, bytes } = await readImageFile(input.filePath!.trim());
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
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const { bytes, contentType, final } = await download(url, ctl.signal);
    const mime =
      input.mimeType ??
      contentType ??
      BY_EXTENSION[extname(final.pathname).toLowerCase()] ??
      '';
    return check(mime, bytes);
  } catch (err) {
    if (err instanceof UserError) throw err;
    throw new UserError(`Downloading ${url.href} failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
