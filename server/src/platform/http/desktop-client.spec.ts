import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { desktopClientMiddleware } from './desktop-client';

describe('desktopClientMiddleware', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dd-client-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('serves index.html from a hidden folder (Linux AppImage mounts at /tmp/.mount_*)', async () => {
    const clientDir = join(root, '.mount_DevDes', 'browser');
    mkdirSync(clientDir, { recursive: true });
    writeFileSync(join(clientDir, 'index.html'), '<html>ok</html>');

    const app = express();
    app.use(desktopClientMiddleware(clientDir));
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    try {
      const { port } = server.address() as AddressInfo;
      for (const path of ['/', '/project/abc']) {
        const res = await fetch(`http://127.0.0.1:${port}${path}`);
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('ok');
      }
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
