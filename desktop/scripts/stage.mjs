// Assembles desktop/stage: the self-contained app folder electron-builder packages.
//
//   stage/
//     package.json          name/version (root version), main, runtime deps
//     desktop/dist/          Electron main + preload
//     server/dist/           NestJS server (incl. compiled migrations)
//     client/dist/client/browser/   Angular build
//     node_modules/          server + updater production deps (installed here, so
//                            electron-builder can rebuild native modules for Electron
//                            without touching the workspace's Node-built copies)
//
// Run after `npm run build:desktop`. Usage: node desktop/scripts/stage.mjs
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(desktopDir, '..');
const stage = join(desktopDir, 'stage');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const DEPS_STAMP = '.deps-stamp';

const required = [
  'desktop/dist/main.js',
  'server/dist/src/main.js',
  'client/dist/client/browser/index.html',
  'shared/dist/index.js',
  'mcp/dist/index.js',
];
for (const file of required) {
  if (!existsSync(join(root, file))) {
    console.error(`Missing ${file}: run "npm run build:desktop" first.`);
    process.exit(1);
  }
}

// Everything is rebuilt except node_modules, which is reused while the dependencies are
// unchanged (installing them is most of the staging time).
mkdirSync(stage, { recursive: true });
for (const entry of readdirSync(stage)) {
  if (entry !== 'node_modules' && entry !== DEPS_STAMP)
    rmSync(join(stage, entry), { recursive: true, force: true });
}

const copy = (from, to = from) => cpSync(join(root, from), join(stage, to), { recursive: true });
copy('desktop/dist');
copy('server/dist');
copy('client/dist/client/browser');
// Bundled MCP server (tests left out).
cpSync(join(root, 'mcp', 'dist'), join(stage, 'mcp', 'dist'), {
  recursive: true,
  filter: (src) => !/\.spec\.js(\.map)?$/.test(src),
});
// The shared workspace package, as a local file dependency.
copy('shared/dist', 'packages/shared/dist');
copy('shared/package.json', 'packages/shared/package.json');

const rootPkg = readJson(join(root, 'package.json'));
const desktopPkg = readJson(join(desktopDir, 'package.json'));
const serverPkg = readJson(join(root, 'server', 'package.json'));
const mcpPkg = readJson(join(root, 'mcp', 'package.json'));

const dependencies = {
  ...serverPkg.dependencies,
  ...mcpPkg.dependencies,
  ...desktopPkg.dependencies,
};
dependencies['@devdesigner/shared'] = 'file:./packages/shared';

writeFileSync(
  join(stage, 'package.json'),
  JSON.stringify(
    {
      name: 'devdesigner',
      productName: 'DevDesigner',
      // Desktop and web share one version: the root package.json's.
      version: rootPkg.version,
      // Shown as the exe's file description (Task Manager, Start menu).
      description: 'DevDesigner',
      author: 'DevDesigner',
      main: 'desktop/dist/main.js',
      // Built-in sync remote (Sync > DevDesigner Cloud); empty when the build doesn't set it.
      devdesigner: { hostedUrl: process.env.DEVDESIGNER_HOSTED_URL?.trim() ?? '' },
      dependencies,
    },
    null,
    2,
  ),
);

// Native modules: install scripts run with Electron as the target runtime, so
// prebuild-install fetches Electron binaries (better-sqlite3 ships them). This stays
// inside stage/; electron-builder's own rebuild is off because it also rebuilds the
// workspace's Node copies (it walks up to the monorepo root).
const electronVersion = createRequire(join(desktopDir, 'package.json'))(
  'electron/package.json',
).version;
const stamp = createHash('sha256')
  .update(JSON.stringify(dependencies))
  .update(electronVersion)
  .update(readFileSync(join(root, 'package-lock.json')))
  .update(readFileSync(join(root, 'shared', 'package.json')))
  .digest('hex');
const stampFile = join(stage, DEPS_STAMP);
const cached =
  !process.argv.includes('--clean') &&
  existsSync(join(stage, 'node_modules')) &&
  existsSync(stampFile) &&
  readFileSync(stampFile, 'utf8') === stamp;

if (cached) {
  // Same dependencies: only the workspace's own shared package needs refreshing.
  const shared = join(stage, 'node_modules', '@devdesigner', 'shared');
  rmSync(join(shared, 'dist'), { recursive: true, force: true });
  cpSync(join(root, 'shared', 'dist'), join(shared, 'dist'), { recursive: true });
  console.log('Dependencies unchanged: reusing stage/node_modules (pass --clean to reinstall).');
} else {
  rmSync(join(stage, 'node_modules'), { recursive: true, force: true });
  rmSync(stampFile, { force: true });
  console.log(`Installing production dependencies into stage/ for Electron ${electronVersion} ...`);
  execSync('npm install --omit=dev --no-audit --no-fund --install-links --workspaces=false', {
    cwd: stage,
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_runtime: 'electron',
      npm_config_target: electronVersion,
      npm_config_disturl: 'https://electronjs.org/headers',
      npm_config_build_from_source: 'false',
    },
  });
  writeFileSync(stampFile, stamp);
}
console.log(`Staged DevDesigner ${rootPkg.version} in ${stage}`);
