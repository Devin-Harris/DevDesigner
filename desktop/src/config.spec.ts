import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isAppUrl, loadOrCreateSecret, loadOrCreateTokenKey, pickPort, resolvePaths, serverEnv } from './config';

describe('desktop config', () => {
  it('keeps app links in the window and sends everything else out', () => {
    const origin = 'http://127.0.0.1:47823';
    expect(isAppUrl('http://127.0.0.1:47823/projects/1', origin)).toBe(true);
    expect(isAppUrl('http://127.0.0.1:3000/', origin)).toBe(false);
    expect(isAppUrl('https://example.com', origin)).toBe(false);
    expect(isAppUrl('not a url', origin)).toBe(false);
  });

  it('runs the server in desktop mode against the per-user data folder', () => {
    const paths = resolvePaths('/app', '/user');
    const env = serverEnv(paths, 47823, 's'.repeat(40));
    expect(env.DESKTOP).toBe('true');
    expect(env.DATABASE_PATH).toBe(join('/user', 'data', 'devdesigner.sqlite'));
    expect(env.CLIENT_DIR).toBe(join('/app', 'client', 'dist', 'client', 'browser'));
    expect(env.CORS_ORIGIN).toBe('http://127.0.0.1:47823');
  });

  it('creates the session secret once and reuses it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dd-desktop-'));
    const first = loadOrCreateSecret(dir);
    expect(first.length).toBeGreaterThanOrEqual(32);
    expect(loadOrCreateSecret(dir)).toBe(first);
    expect(readFileSync(join(dir, 'jwt-secret'), 'utf8')).toBe(first);
  });

  it('falls back to a free port when the preferred one is taken', async () => {
    const blocker = createServer();
    const taken = await new Promise<number>((resolve) =>
      blocker.listen(0, '127.0.0.1', () => resolve((blocker.address() as { port: number }).port)),
    );
    try {
      const port = await pickPort(taken);
      expect(port).not.toBe(taken);
      expect(port).toBeGreaterThan(0);
    } finally {
      blocker.close();
    }
  });
});

describe('parseLaunchArg', () => {
  const { parseLaunchArg } = jest.requireActual('./config') as typeof import('./config');
  it.each([
    ['devdesigner://open?project=abc-123', { kind: 'project', projectId: 'abc-123' }],
    ['devdesigner://open/abc-123/', { kind: 'project', projectId: 'abc-123' }],
    ['DEVDESIGNER://open/x1', { kind: 'project', projectId: 'x1' }],
    ['C:\\Users\\me\\Shop.devdesigner', { kind: 'file', path: 'C:\\Users\\me\\Shop.devdesigner' }],
    ['/home/me/shop.devdesigner.json', { kind: 'file', path: '/home/me/shop.devdesigner.json' }],
  ])('%s', (arg, expected) => {
    expect(parseLaunchArg(arg)).toEqual(expected);
  });

  it.each([
    'devdesigner://delete?project=x',
    'devdesigner://open?project=../../etc',
    'devdesigner://open',
    '--remote-debugging-port=9222',
    'C:\\notes.json',
    '.',
  ])('ignores %s', (arg) => {
    expect(parseLaunchArg(arg)).toBeNull();
  });
});

describe('hostedServerUrl', () => {
  const { hostedServerUrl } = jest.requireActual('./config') as typeof import('./config');
  it('prefers the environment, then the value baked into the build', () => {
    expect(
      hostedServerUrl(
        { devdesigner: { hostedUrl: 'https://baked' } },
        { DEVDESIGNER_HOSTED_URL: ' https://env ' },
      ),
    ).toBe('https://env');
    expect(hostedServerUrl({ devdesigner: { hostedUrl: 'https://baked' } }, {})).toBe(
      'https://baked',
    );
    expect(hostedServerUrl({}, {})).toBe('');
    expect(hostedServerUrl(null, {})).toBe('');
  });

  it('keeps the token key encrypted by the keychain and stable across launches', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dd-key-'));
    const box = {
      isEncryptionAvailable: () => true,
      encryptString: (p: string) => Buffer.from(`X${p}`),
      decryptString: (b: Buffer) => b.toString().slice(1),
    };
    const key = loadOrCreateTokenKey(dir, box);
    expect(key.length).toBeGreaterThanOrEqual(32);
    expect(readFileSync(join(dir, 'token-key.enc'), 'utf8')).toBe(`X${key}`);
    expect(loadOrCreateTokenKey(dir, box)).toBe(key);
  });
});
