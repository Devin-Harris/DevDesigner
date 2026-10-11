import { base64ToBytes, bytesToBase64, fitWithin, imageSize, svgSize, textToBase64 } from './index';

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
