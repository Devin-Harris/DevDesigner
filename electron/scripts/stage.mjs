// Assembles electron/stage/ for packaging: the compiled server with its production
// dependencies, the built client, and the shared package. electron-builder copies
// stage/ into the installer as resources/ (outside the asar, so Nest's file globbing
// and static serving work unchanged). Run after `npm run electron:build` at the root.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const electronDir = resolve(here, '..');
const root = resolve(electronDir, '..');
const stage = join(electronDir, 'stage');

for (const required of [
  join(root, 'server', 'dist', 'src', 'bootstrap.js'),
  join(root, 'client', 'dist', 'client', 'browser', 'index.html'),
  join(root, 'shared', 'dist', 'index.js'),
]) {
  if (!existsSync(required)) throw new Error(`Missing ${required}. Run "npm run electron:build" first.`);
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, 'server'), { recursive: true });

// Server: compiled output plus production deps. better-sqlite3 comes from the Electron
// package (built for Electron's ABI) and shared is copied in below, so both are omitted.
const serverPkg = JSON.parse(readFileSync(join(root, 'server', 'package.json'), 'utf8'));
const dependencies = { ...serverPkg.dependencies };
delete dependencies['@dbdesigner/shared'];
delete dependencies['better-sqlite3'];
writeFileSync(
  join(stage, 'server', 'package.json'),
  JSON.stringify({ name: 'dbdesigner-server', version: '0.0.0', private: true, dependencies }, null, 2),
);
cpSync(join(root, 'server', 'dist'), join(stage, 'server', 'dist'), { recursive: true });
execSync('npm install --omit=dev --no-package-lock --no-audit --no-fund', {
  cwd: join(stage, 'server'),
  stdio: 'inherit',
});

const sharedTarget = join(stage, 'server', 'node_modules', '@dbdesigner', 'shared');
mkdirSync(sharedTarget, { recursive: true });
cpSync(join(root, 'shared', 'dist'), join(sharedTarget, 'dist'), { recursive: true });
cpSync(join(root, 'shared', 'package.json'), join(sharedTarget, 'package.json'));

cpSync(join(root, 'client', 'dist', 'client', 'browser'), join(stage, 'client'), { recursive: true });
console.log('Staged to', stage);
