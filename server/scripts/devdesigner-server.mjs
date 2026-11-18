#!/usr/bin/env node
// Runs a self-hosted DevDesigner server (web app + API) without Docker.
//
//   npm run build:selfhost                      (once, from the repo root)
//   npx devdesigner-server --data ./data --port 3000
//
// Everything is kept in the data folder: the database, uploaded media and a session
// secret made on first start. Desktop apps sync with it (Settings > Sync servers).
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
if (args.includes('--help') || args.includes('-h')) {
  console.log(
    'Usage: devdesigner-server [--data <folder>] [--port <port>] [--url <public url>]\n' +
      '  --data  where the database and media live (default ./devdesigner-data)\n' +
      '  --port  port to listen on (default 3000)\n' +
      '  --url   public address people open, e.g. https://devdesigner.example.com',
  );
  process.exit(0);
}

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(serverDir, 'dist', 'src', 'main.js');
const clientDir = resolve(serverDir, '..', 'client', 'dist', 'client', 'browser');
for (const [what, path] of [
  ['server', entry],
  ['web app', join(clientDir, 'index.html')],
]) {
  if (!existsSync(path)) {
    console.error(`The ${what} is not built (${path}). Run "npm run build:selfhost" in the repo first.`);
    process.exit(1);
  }
}

const dataDir = resolve(opt('data', process.env.DEVDESIGNER_DATA ?? 'devdesigner-data'));
const port = opt('port', process.env.PORT ?? '3000');
const url = opt('url', process.env.PUBLIC_APP_URL ?? `http://localhost:${port}`);
mkdirSync(dataDir, { recursive: true });

const secretFile = join(dataDir, 'jwt-secret');
if (!process.env.JWT_SECRET) {
  if (!existsSync(secretFile)) {
    writeFileSync(secretFile, randomBytes(48).toString('base64url'), { mode: 0o600 });
  }
  process.env.JWT_SECRET = readFileSync(secretFile, 'utf8').trim();
}

Object.assign(process.env, {
  NODE_ENV: 'production',
  SELF_HOSTED: process.env.SELF_HOSTED ?? 'true',
  PORT: String(port),
  DATABASE_PATH: join(dataDir, 'devdesigner.sqlite'),
  CLIENT_DIR: clientDir,
  PUBLIC_APP_URL: url,
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? url,
  TRUST_PROXY_HOPS: process.env.TRUST_PROXY_HOPS ?? '0',
});
console.log(`DevDesigner server: data in ${dataDir}, open ${url}`);
process.chdir(serverDir);
await import(pathToFileURL(entry).href);
