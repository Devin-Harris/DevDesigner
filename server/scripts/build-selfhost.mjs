// Builds everything `devdesigner-server` runs: shared, the server, and the web app
// set to call the API on its own origin (the server serves it). Cross-platform.
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const run = (cmd, env = {}) =>
  execSync(cmd, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });

run('npm run build:shared');
run('npm run build -w server');
run('npm run build -w client', { API_URL: 'same-origin' });
console.log('\nBuilt. Start it with: npx devdesigner-server --data ./devdesigner-data --port 3000');
