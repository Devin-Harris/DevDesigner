// Small, dependency-free helpers for image files: base64 conversion and reading
// the pixel size out of a PNG / JPEG / GIF / WebP / SVG so an image element can be
// created at the right aspect ratio without decoding the picture. Pure (no DOM,
// no Buffer) so the MCP server, the server and tests all share it.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encode bytes as base64 (no line breaks, padded). */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[c & 63] : '=';
  }
  return out;
}

/** Decode base64 (whitespace and a `data:...;base64,` prefix tolerated). Null when invalid. */
export function base64ToBytes(input: string): Uint8Array | null {
  const clean = input.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (clean.length === 0 || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(clean)) return null;
  const std = clean.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((std.length * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (const ch of std) {
    acc = (acc << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/** UTF-8 encode text (a tiny TextEncoder stand-in that works in every runtime). */
export function utf8Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    } else {
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
  }
  return Uint8Array.from(out);
}

/** Base64 of a string's UTF-8 bytes (how SVG markup becomes an upload). */
export function textToBase64(text: string): string {
  return bytesToBase64(utf8Bytes(text));
}

export interface ImageSize {
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, i: number): number => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number): number => b[i] | (b[i + 1] << 8);
const u32be = (b: Uint8Array, i: number): number =>
  ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

/** Pixel size of a raster image from its header bytes; null when unrecognised. */
export function rasterSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
  }
  if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: u16le(bytes, 6), height: u16le(bytes, 8) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = bytes[i + 1];
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      const len = u16be(bytes, i + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return { width: u16be(bytes, i + 7), height: u16be(bytes, i + 5) };
      }
      i += 2 + len;
    }
    return null;
  }
  if (
    bytes.length >= 30 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    const kind = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (kind === 'VP8 ') {
      return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
    }
    if (kind === 'VP8L') {
      const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8X') {
      return {
        width: (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1,
        height: (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1,
      };
    }
  }
  return null;
}

/** Size of an SVG document from its viewBox, else its width/height (px or unitless). */
export function svgSize(markup: string): ImageSize | null {
  const root = /<svg\b[^>]*>/i.exec(markup)?.[0];
  if (!root) return null;
  const attr = (name: string): string | undefined =>
    new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(root)?.[1];
  const length = (v: string | undefined): number | null => {
    const m = /^\s*([0-9]*\.?[0-9]+)\s*(px|pt|em)?\s*$/i.exec(v ?? '');
    return m ? Number(m[1]) : null;
  };
  const vb = attr('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const w = length(attr('width'));
  const h = length(attr('height'));
  if (w && h) return { width: w, height: h };
  if (vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    if (w) return { width: w, height: (w * vb[3]) / vb[2] };
    if (h) return { width: (h * vb[2]) / vb[3], height: h };
    return { width: vb[2], height: vb[3] };
  }
  return null;
}

/** Natural size of an image file (any accepted mime type); null when it cannot be read. */
export function imageSize(mimeType: string, bytes: Uint8Array): ImageSize | null {
  if (mimeType === 'image/svg+xml') {
    return svgSize(new TextDecoderLite().decode(bytes.subarray(0, 4096)));
  }
  return rasterSize(bytes);
}

/** Minimal UTF-8 decoder for the SVG prologue (ASCII-safe; invalid bytes become U+FFFD). */
class TextDecoderLite {
  decode(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; ) {
      const b = bytes[i];
      let cp = 0xfffd;
      let n = 1;
      if (b < 0x80) {
        cp = b;
      } else if (b >= 0xc0 && b < 0xe0 && i + 1 < bytes.length) {
        cp = ((b & 31) << 6) | (bytes[i + 1] & 63);
        n = 2;
      } else if (b >= 0xe0 && b < 0xf0 && i + 2 < bytes.length) {
        cp = ((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63);
        n = 3;
      } else if (b >= 0xf0 && i + 3 < bytes.length) {
        cp = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63);
        n = 4;
      }
      out += String.fromCodePoint(cp);
      i += n;
    }
    return out;
  }
}

/** Scale `size` down (never up) to fit inside `maxW` x `maxH`, keeping the aspect ratio. */
export function fitWithin(size: ImageSize, maxW: number, maxH: number): ImageSize {
  const scale = Math.min(1, maxW / size.width, maxH / size.height);
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
}
