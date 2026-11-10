import {
  base64ToBytes,
  bytesMatchMediaType,
  bytesToBase64,
  fitWithin,
  imageSize,
  sniffMediaType,
  svgSize,
  textToBase64,
} from './index';

// 1x1 transparent PNG / GIF, as produced by common tools.
const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const GIF_1x1 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

describe('base64', () => {
  it('round-trips arbitrary bytes and text', () => {
    for (const len of [0, 1, 2, 3, 4, 17]) {
      const bytes = Uint8Array.from({ length: len }, (_v, i) => (i * 37 + 11) & 0xff);
      expect(Array.from(base64ToBytes(bytesToBase64(bytes)) ?? [])).toEqual(
        len === 0 ? [] : Array.from(bytes),
      );
    }
    expect(textToBase64('héllo ✓')).toBe(Buffer.from('héllo ✓', 'utf8').toString('base64'));
  });

  it('rejects non-base64 text', () => {
    expect(base64ToBytes('not base64!!')).toBeNull();
  });
});

describe('imageSize', () => {
  it('reads PNG and GIF headers', () => {
    expect(imageSize('image/png', base64ToBytes(PNG_1x1)!)).toEqual({ width: 1, height: 1 });
    expect(imageSize('image/gif', base64ToBytes(GIF_1x1)!)).toEqual({ width: 1, height: 1 });
  });

  it('reads a JPEG start-of-frame', () => {
    const jpeg = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x2c,
      0x02, 0x58, 0x01, 0x01, 0x11, 0x00,
    ]);
    expect(imageSize('image/jpeg', jpeg)).toEqual({ width: 600, height: 300 });
  });

  it('reads SVG viewBox and width/height', () => {
    expect(svgSize('<svg xmlns="x" viewBox="0 0 24 12"></svg>')).toEqual({ width: 24, height: 12 });
    expect(svgSize('<svg width="100px" height="50"></svg>')).toEqual({ width: 100, height: 50 });
    expect(svgSize('<svg width="200" viewBox="0 0 10 5"></svg>')).toEqual({ width: 200, height: 100 });
    expect(svgSize('<svg width="100%"></svg>')).toBeNull();
    expect(imageSize('image/svg+xml', Uint8Array.from(Buffer.from('<svg viewBox="0 0 8 4"/>')))).toEqual({
      width: 8,
      height: 4,
    });
  });
});

describe('fitWithin', () => {
  it('scales down keeping aspect, never up', () => {
    expect(fitWithin({ width: 2000, height: 1000 }, 1000, 1000)).toEqual({ width: 1000, height: 500 });
    expect(fitWithin({ width: 100, height: 50 }, 1000, 1000)).toEqual({ width: 100, height: 50 });
  });
});

describe('sniffMediaType / bytesMatchMediaType', () => {
  const bytes = (...parts: Array<string | number[]>): Uint8Array =>
    Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? Array.from(Buffer.from(p, 'latin1')) : p)));

  it('identifies each accepted format by its magic bytes', () => {
    expect(sniffMediaType(base64ToBytes(PNG_1x1)!)).toBe('image/png');
    expect(sniffMediaType(base64ToBytes(GIF_1x1)!)).toBe('image/gif');
    expect(sniffMediaType(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMediaType(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '))).toBe('image/webp');
    expect(sniffMediaType(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f]))).toBe('video/webm');
    expect(sniffMediaType(bytes('OggS', [0, 2]))).toBe('video/ogg');
    expect(sniffMediaType(bytes([0, 0, 0, 0x18], 'ftypisom'))).toBe('video/mp4');
    expect(sniffMediaType(bytes([0xef, 0xbb, 0xbf], '<?xml version="1.0"?>\n<!-- c -->\n<svg xmlns="x"/>'))).toBe('image/svg+xml');
  });

  it('rejects text and other files', () => {
    expect(sniffMediaType(bytes('-----BEGIN OPENSSH PRIVATE KEY-----\n'))).toBeNull();
    expect(sniffMediaType(bytes('hello <svg> later'))).toBeNull();
    expect(sniffMediaType(bytes([0x50, 0x4b, 0x03, 0x04]))).toBeNull();
    expect(sniffMediaType(new Uint8Array())).toBeNull();
  });

  it('checks bytes against the declared type', () => {
    const png = base64ToBytes(PNG_1x1)!;
    expect(bytesMatchMediaType('image/png', png)).toBe(true);
    expect(bytesMatchMediaType('image/jpeg', png)).toBe(false);
    expect(bytesMatchMediaType('image/png', bytes('ssh-ed25519 AAAA'))).toBe(false);
    expect(bytesMatchMediaType('video/quicktime', bytes([0, 0, 0, 0x14], 'ftypqt  '))).toBe(true);
    expect(bytesMatchMediaType('video/mp4', bytes([0x1a, 0x45, 0xdf, 0xa3]))).toBe(false);
  });
});
