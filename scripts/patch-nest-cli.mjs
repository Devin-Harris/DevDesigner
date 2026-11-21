// Nest CLI (watch mode, Windows) kills the old server with `taskkill` on every rebuild.
// If that process already exited, taskkill fails ("process not found") and the uncaught
// error takes down the whole watcher. Swallow that one failure. Idempotent; runs on install.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const file = 'node_modules/@nestjs/cli/lib/utils/tree-kill.js';
const before = "(0, child_process_1.execSync)('taskkill /pid ' + pid + ' /T /F');";
const after = "try { (0, child_process_1.execSync)('taskkill /pid ' + pid + ' /T /F', { stdio: 'ignore' }); } catch { /* already exited */ }";

if (existsSync(file)) {
   const src = readFileSync(file, 'utf8');
   if (src.includes(before)) {
      writeFileSync(file, src.replace(before, after));
      console.log('patched @nestjs/cli tree-kill (Windows taskkill race)');
   }
}
