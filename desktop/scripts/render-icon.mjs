// Renders the shared logo (client/src/assets/brand/logo.svg) to every raster icon:
//   desktop/build/icon.png           1024 px app icon (macOS .icns / Linux are derived from it)
//   desktop/build/icon.ico           Windows exe, installer, shortcut and taskbar icon (16-256 px)
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

function render(svg, size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
}
function write(svg, size, file) {
  const png = render(svg, size);
  writeFileSync(file, png);
  console.log(`wrote ${file} (${png.length} bytes)`);
}
/** A multi-size .ico holding PNG images (supported since Windows Vista). */
function writeIco(svg, sizes, file) {
  const pngs = sizes.map((s) => render(svg, s));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(s >= 256 ? 0 : s, e);
    header.writeUInt8(s >= 256 ? 0 : s, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(pngs[i].length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += pngs[i].length;
  });
  const ico = Buffer.concat([header, ...pngs]);
  writeFileSync(file, ico);
  console.log(`wrote ${file} (${ico.length} bytes)`);
}
write(padded, 1024, join(root, 'desktop', 'build', 'icon.png'));
write(padded, 256, join(brand, 'logo.png'));
writeIco(padded, [16, 24, 32, 48, 64, 128, 256], join(root, 'desktop', 'build', 'icon.ico'));
