import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeApiUrl } from './api';
import { colorArg, describePalette, tableColorArg } from './colors';
import { isPrivateAddress, loadImage } from './images';
import { UserError } from './model';

describe('colorArg', () => {
  it('keeps theme tokens on slide content but refuses them on database tables', () => {
    expect(colorArg('$accent1', 'x')).toBe('$accent1');
    expect(() => colorArg('$nope', 'x')).toThrow(UserError);
    expect(() => tableColorArg('$accent1', 'x')).toThrow(UserError);
  });

  it('resolves names and hex, keeps undefined and clears with an empty string', () => {
    expect(colorArg('blue', 'x')).toBe('#2f6bff');
    expect(colorArg('Amber-Soft', 'x')).toBe('#fef3c7');
    expect(colorArg('#ABC', 'x')).toBe('#aabbcc');
    expect(colorArg(undefined, 'x')).toBeUndefined();
    expect(colorArg('', 'x')).toBe('');
  });

  it('rejects unknown colors with the valid names', () => {
    expect(() => colorArg('chartreuse', 'the header')).toThrow(UserError);
    expect(() => colorArg('chartreuse', 'the header')).toThrow(/blue-soft/);
  });

  it('describes the palette with roles', () => {
    const d = describePalette() as { strong: unknown[]; roles: Array<{ role: string }> };
    expect(d.strong.length).toBeGreaterThan(5);
    expect(d.roles.map((r) => r.role)).toContain('table header');
  });
});

describe('loadImage', () => {
  const svg = '<svg viewBox="0 0 40 20"><rect width="40" height="20"/></svg>';
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  it('loads inline SVG, adds the namespace and reads its size', async () => {
    const img = await loadImage({ svg });
    expect(img.mimeType).toBe('image/svg+xml');
    expect(Buffer.from(img.data, 'base64').toString()).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(img.size).toEqual({ width: 40, height: 20 });
  });

  it('loads base64 with a mime type or a data URL, and a file by extension', async () => {
    expect((await loadImage({ data: png, mimeType: 'image/png' })).size).toEqual({ width: 1, height: 1 });
    expect((await loadImage({ data: 'data:image/png;base64,' + png })).mimeType).toBe('image/png');
    const dir = mkdtempSync(join(tmpdir(), 'dd-img-'));
    const file = join(dir, 'a.svg');
    writeFileSync(file, svg);
    expect((await loadImage({ filePath: file })).mimeType).toBe('image/svg+xml');
  });

  it('requires exactly one source and a supported type', async () => {
    await expect(loadImage({})).rejects.toThrow(/exactly one/);
    await expect(loadImage({ svg, url: 'https://example.com/a.png' })).rejects.toThrow(/exactly one/);
    await expect(loadImage({ data: 'QUJD', mimeType: 'text/html' })).rejects.toThrow(/Unsupported/);
    await expect(loadImage({ svg: 'hello' })).rejects.toThrow(/SVG markup/);
    await expect(loadImage({ url: 'file:///etc/passwd' })).rejects.toThrow(/http/);
  });
});

describe('normalizeApiUrl', () => {
  it('adds /api to a bare host and keeps explicit paths', () => {
    expect(normalizeApiUrl('https://x.up.railway.app')).toBe('https://x.up.railway.app/api');
    expect(normalizeApiUrl('https://x.up.railway.app/')).toBe('https://x.up.railway.app/api');
    expect(normalizeApiUrl('https://x.up.railway.app/api/')).toBe('https://x.up.railway.app/api');
    expect(normalizeApiUrl('http://localhost:3000/api')).toBe('http://localhost:3000/api');
  });
});

describe('isPrivateAddress', () => {
  it('flags loopback, private and link-local addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.16.0.1', '169.254.169.254', '::ffff:127.0.0.1', '::1', '0.0.0.0']) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
  });

  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1111']) expect(isPrivateAddress(ip)).toBe(false);
  });
});
