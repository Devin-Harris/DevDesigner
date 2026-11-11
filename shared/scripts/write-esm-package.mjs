// Marks dist/esm as ES modules so bundlers (and Node) read the .js files there as ESM;
// the package itself stays "type": "commonjs" for the server and the MCP.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../dist/esm/', import.meta.url));
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}package.json`, JSON.stringify({ type: 'module', sideEffects: false }, null, 2) + '\n');
