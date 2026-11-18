// Builds DevDesigner from the current code and installs it on this computer (Windows).
// Project data in %APPDATA%\DevDesigner is never touched.
//
//   npm run install:desktop                     update the installed copy (fast)
//   npm run install:desktop -- --installer      build and run the full NSIS installer
//   npm run install:desktop -- --skip-build     reuse the last build (no compiling)
//
// Fast path (DevDesigner already installed): build the unpacked app only and mirror it
// into the install folder. No installer, no compression: about a minute instead of several.
// The full installer runs for a first install, or with --installer.
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  console.error('install:desktop is Windows-only. On macOS/Linux run "npm run dist:desktop" and open the dmg/AppImage.');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const desktop = join(root, 'desktop');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const installDir = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DevDesigner');
const installedExe = join(installDir, 'DevDesigner.exe');
const args = new Set(process.argv.slice(2));
const fullInstaller = args.has('--installer') || !existsSync(installedExe);
const started = Date.now();
const elapsed = () => `${Math.round((Date.now() - started) / 1000)}s`;

const running = spawnSync('tasklist', ['/FI', 'IMAGENAME eq DevDesigner.exe', '/NH'], { encoding: 'utf8' }).stdout;
if (/DevDesigner\.exe/i.test(running)) {
  console.error('DevDesigner is running. Quit it (File > Exit) and run this again.');
  process.exit(1);
}

const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: 'inherit' });

if (!args.has('--skip-build')) {
  console.log(`\n[${elapsed()}] Compiling DevDesigner ${version} …`);
  run('npm run build:desktop');
}
console.log(`\n[${elapsed()}] Staging …`);
run('node scripts/stage.mjs', desktop);

if (fullInstaller) {
  console.log(`\n[${elapsed()}] Building the installer (first install) …`);
  run('npx electron-builder --win --publish never', desktop);
  const installer = join(desktop, 'release', `DevDesigner-Setup-${version}.exe`);
  console.log(`\n[${elapsed()}] Installing ${installer} …`);
  // /S = silent; per-user install, so no admin prompt.
  const result = spawnSync(installer, ['/S'], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`The installer exited with code ${result.status}.`);
    process.exit(result.status ?? 1);
  }
} else {
  console.log(`\n[${elapsed()}] Packaging the app (no installer) …`);
  run('npx electron-builder --win --dir --publish never', desktop);
  const unpacked = join(desktop, 'release', 'win-unpacked');
  console.log(`\n[${elapsed()}] Updating ${installDir} …`);
  // /MIR makes the folder match the new build; the uninstaller written by the first
  // install is kept. robocopy exit codes below 8 mean success.
  const copy = spawnSync(
    'robocopy',
    [unpacked, installDir, '/MIR', '/XF', 'Uninstall DevDesigner.exe', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:2', '/W:1'],
    // Quiet: the result is judged by the exit code.
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  if (copy.status === null || copy.status >= 8) {
    console.error(`Copying the new build failed (robocopy exit ${copy.status}).`);
    process.exit(1);
  }
}
console.log(`\n[${elapsed()}] Installed DevDesigner ${version}: ${installedExe}`);
