// Renders the shared logo (client/src/assets/brand/logo.svg) to every raster icon:
//   desktop/build/icon.png           1024 px app icon (electron-builder derives .ico/.icns)
//   client/src/assets/brand/logo.png 256 px (favicon fallback, desktop window/taskbar icon)
// Run after swapping the logo: node desktop/scripts/render-icon.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const brand = join(root, 'client', 'src', 'assets', 'brand');
// resvg is already a dependency of the MCP workspace.
const { Resvg } = createRequire(join(root, 'mcp', 'package.json'))('@resvg/resvg-js');

const logo = readFileSync(join(brand, 'logo.svg'), 'utf8');
const inner = logo.replace(/<\?xml[^>]*>/, '').trim();
/** The logo inset with a margin, as OS app icons expect (1/16 per side). */
const padded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${inner.replace(
  /^<svg\b/,
  '<svg x="64" y="64" width="896" height="896"',
)}</svg>`;

function write(svg, size, file) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(file, png);
  console.log(`wrote ${file} (${png.length} bytes)`);
}
write(padded, 1024, join(root, 'desktop', 'build', 'icon.png'));
write(padded, 256, join(brand, 'logo.png'));
