import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

/** Fixed loopback port tried first, so an MCP config pointing at it stays valid across launches. */
export const PREFERRED_PORT = 47823;

export interface DesktopPaths {
  /** Repo root in dev, the packaged app folder in production. */
  appRoot: string;
  serverEntry: string;
  clientDir: string;
  dataDir: string;
  logDir: string;
  databasePath: string;
}

export function resolvePaths(appRoot: string, userData: string): DesktopPaths {
  const dataDir = join(userData, 'data');
  return {
    appRoot,
    serverEntry: join(appRoot, 'server', 'dist', 'src', 'main.js'),
    clientDir: join(appRoot, 'client', 'dist', 'client', 'browser'),
    dataDir,
    logDir: join(userData, 'logs'),
    databasePath: join(dataDir, 'devdesigner.sqlite'),
  };
}

/** Resolves when `port` can be bound on 127.0.0.1. */
function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

/** PREFERRED_PORT when free, otherwise any free loopback port. */
export async function pickPort(preferred = PREFERRED_PORT): Promise<number> {
  if (await canListen(preferred)) return preferred;
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Per-install session-signing secret, created on first launch. Kept so sign-in
 * cookies survive restarts; never leaves the machine.
 */
export function loadOrCreateSecret(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, 'jwt-secret');
  if (existsSync(file)) {
    const existing = readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  }
  const secret = randomBytes(48).toString('base64url');
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

/**
 * The hosted DevDesigner server offered as the built-in sync remote. A build setting:
 * `DEVDESIGNER_HOSTED_URL` at package time is written into the app's package.json
 * (`devdesigner.hostedUrl`, see scripts/stage.mjs); in dev the env var is read directly.
 * Empty = no built-in remote.
 */
export function hostedServerUrl(
  appPackage: { devdesigner?: { hostedUrl?: unknown } } | null,
  env = process.env,
): string {
  const fromEnv = env.DEVDESIGNER_HOSTED_URL?.trim();
  if (fromEnv) return fromEnv;
  const baked = appPackage?.devdesigner?.hostedUrl;
  return typeof baked === 'string' ? baked.trim() : '';
}

/** Environment for the embedded server process. */
export function serverEnv(
  paths: DesktopPaths,
  port: number,
  jwtSecret: string,
  hostedUrl = '',
): Record<string, string> {
  const origin = `http://127.0.0.1:${port}`;
  return {
    SYNC_DEFAULT_REMOTE_URL: hostedUrl,
    NODE_ENV: 'production',
    DESKTOP: 'true',
    PORT: String(port),
    DATABASE_PATH: paths.databasePath,
    CLIENT_DIR: paths.clientDir,
    JWT_SECRET: jwtSecret,
    CORS_ORIGIN: origin,
    PUBLIC_APP_URL: origin,
    TRUST_PROXY_HOPS: '0',
    LOG_LEVEL: 'info',
  };
}

/** True when `url` is a page of the local app (everything else opens in the system browser). */
export function isAppUrl(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/** What a launch argument (or macOS open-file/open-url) asks for. */
export type LaunchRequest = { kind: 'file'; path: string } | { kind: 'project'; projectId: string };

const PROJECT_ID = /^[A-Za-z0-9-]{1,64}$/;
export const PROTOCOL = 'devdesigner';

/**
 * `devdesigner://open?project=<id>` / `devdesigner://open/<id>` links and
 * `.devdesigner` / `.devdesigner.json` file paths. Anything else is ignored.
 */
export function parseLaunchArg(arg: string): LaunchRequest | null {
  if (arg.toLowerCase().startsWith(`${PROTOCOL}://`)) {
    try {
      const url = new URL(arg);
      if (url.hostname !== 'open') return null;
      const id = url.searchParams.get('project') ?? url.pathname.replace(/^\/+|\/+$/g, '');
      return id && PROJECT_ID.test(id) ? { kind: 'project', projectId: id } : null;
    } catch {
      return null;
    }
  }
  if (/\.devdesigner(\.json)?$/i.test(arg) && !arg.startsWith('-'))
    return { kind: 'file', path: arg };
  return null;
}
