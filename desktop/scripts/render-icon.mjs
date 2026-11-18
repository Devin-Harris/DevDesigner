// Renders build/icon.svg to build/icon.png (1024 px; electron-builder derives .ico/.icns from it).
//   node desktop/scripts/render-icon.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const build = join(dirname(fileURLToPath(import.meta.url)), '..', 'build');
// resvg is already a dependency of the MCP workspace.
const { Resvg } = createRequire(join(build, '..', '..', 'mcp', 'package.json'))('@resvg/resvg-js');
const png = new Resvg(readFileSync(join(build, 'icon.svg'), 'utf8'), {
  fitTo: { mode: 'width', value: 1024 },
})
  .render()
  .asPng();
writeFileSync(join(build, 'icon.png'), png);
console.log(`wrote ${join(build, 'icon.png')} (${png.length} bytes)`);
