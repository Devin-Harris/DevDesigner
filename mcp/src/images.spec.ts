import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_IMAGE_BYTES } from '@devdesigner/shared';
import { isPrivateAddress, loadImage, vetHost } from './images';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

function withEnv(name: string, value: string | undefined, run: () => Promise<void>): Promise<void> {
  const before = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  return run().finally(() => {
    if (before === undefined) delete process.env[name];
    else process.env[name] = before;
  });
}

describe('isPrivateAddress (ipaddr.js classification)', () => {
  it('flags IPv6 forms that reach internal IPv4 addresses', () => {
    for (const ip of [
      '::ffff:7f00:1', // [::ffff:127.0.0.1] as WHATWG URL normalizes it
      '[::ffff:a9fe:a9fe]', // 169.254.169.254
      '64:ff9b::7f00:1', // NAT64
      '2002:7f00:1::', // 6to4
      'fd00::1',
      'fe80::1%eth0',
      '100.64.0.1',
      '224.0.0.1',
      '255.255.255.255',
      'not-an-ip',
    ]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
  });

  it('allows public unicast', () => {
    for (const ip of ['1.1.1.1', '[2606:4700::1111]']) expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe('vetHost', () => {
  it('rejects local names and private literals', async () => {
    for (const host of ['localhost', 'a.localhost', 'metadata.google.internal', '[::ffff:7f00:1]', '127.0.0.1', '10.0.0.1']) {
      await expect(vetHost(host)).rejects.toThrow(/private or local/);
    }
  });

  it('returns the vetted public literal', async () => {
    await expect(vetHost('1.1.1.1')).resolves.toEqual({ address: '1.1.1.1', family: 4 });
  });
});

describe('loadImage url', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/a.png') {
        res.writeHead(200, { 'content-type': 'image/png' }).end(PNG);
      } else if (req.url?.startsWith('/hop')) {
        const n = Number(req.url.slice(4) || 0);
        res.writeHead(302, { location: n > 0 ? `/hop${n - 1}` : '/a.png' }).end();
      } else if (req.url === '/big.png') {
        // No content-length: chunked, larger than the cap.
        res.writeHead(200, { 'content-type': 'image/png' });
        res.write(PNG);
        res.end(Buffer.alloc(MAX_IMAGE_BYTES + 1));
      } else if (req.url === '/key.png') {
        res.writeHead(200, { 'content-type': 'image/png' }).end('-----BEGIN OPENSSH PRIVATE KEY-----');
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('downloads locally and follows a few redirects', async () => {
    expect((await loadImage({ url: `${base}/a.png` })).mimeType).toBe('image/png');
    expect((await loadImage({ url: `${base}/hop2` })).size).toEqual({ width: 1, height: 1 });
  });

  it('stops after too many redirects', async () => {
    await expect(loadImage({ url: `${base}/hop5` })).rejects.toThrow(/too many redirects/);
  });

  it('aborts a body past the size cap', async () => {
    await expect(loadImage({ url: `${base}/big.png` })).rejects.toThrow(/larger than/);
  });

  it('rejects bytes that are not an image', async () => {
    await expect(loadImage({ url: `${base}/key.png` })).rejects.toThrow(/not a PNG/);
  });

  it('refuses loopback (incl. IPv4-mapped IPv6) on the remote endpoint', () =>
    withEnv('DEVDESIGNER_MCP_REMOTE', '1', async () => {
      await expect(loadImage({ url: `${base}/a.png` })).rejects.toThrow(/private or local/);
      const port = new URL(base).port;
      await expect(loadImage({ url: `http://[::ffff:127.0.0.1]:${port}/a.png` })).rejects.toThrow(/private or local/);
      await expect(loadImage({ url: `http://localhost:${port}/a.png` })).rejects.toThrow(/private or local/);
    }));
});

describe('loadImage filePath', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dd-img-path-'));
  const png = join(dir, 'ok.png');
  const fake = join(dir, 'id_ed25519.png');
  const text = join(dir, 'notes.txt');
  writeFileSync(png, PNG);
  writeFileSync(fake, '-----BEGIN OPENSSH PRIVATE KEY-----\n');
  writeFileSync(text, 'hello');

  it('loads a real image file', async () => {
    expect((await loadImage({ filePath: png })).mimeType).toBe('image/png');
  });

  it('refuses non-image extensions even with a forced mimeType', async () => {
    await expect(loadImage({ filePath: text, mimeType: 'image/png' })).rejects.toThrow(/not an image file/);
  });

  it('refuses an image extension whose bytes are not an image', async () => {
    await expect(loadImage({ filePath: fake, mimeType: 'image/png' })).rejects.toThrow(/not a PNG/);
  });

  it('confines reads to DEVDESIGNER_IMAGE_ROOT when set', async () => {
    const root = join(dir, 'allowed');
    mkdirSync(root, { recursive: true });
    const inside = join(root, 'in.png');
    writeFileSync(inside, PNG);
    await withEnv('DEVDESIGNER_IMAGE_ROOT', root, async () => {
      expect((await loadImage({ filePath: inside })).mimeType).toBe('image/png');
      await expect(loadImage({ filePath: png })).rejects.toThrow(/outside DEVDESIGNER_IMAGE_ROOT/);
    });
  });
});
