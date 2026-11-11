import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseProjectExport } from './parser';
import { remapProjectIds } from './remap';

/**
 * The home showcase and the guide sandboxes load the seed files under
 * client/src/app/**\/seeds/*.json through this parser and planner, in the browser.
 * Every validation added to the parser must keep accepting them. (The server's
 * seed spec also runs its stricter theme checks and the PUT /themes DTO.)
 */
const CLIENT_APP = join(__dirname, '..', '..', '..', 'client', 'src', 'app');

function seedFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return seedFiles(full);
    return name.endsWith('.json') && /[\\/]seeds$/.test(dir) ? [full] : [];
  });
}

describe('client seed files', () => {
  const files = seedFiles(CLIENT_APP);

  it('finds the home and guide seeds', () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it.each(files.map((f) => [relative(CLIENT_APP, f), f]))('%s parses and remaps', (_name, file) => {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const parsed = parseProjectExport(raw);
    // The sandbox re-points image elements at the file's embedded images; none may drop.
    const embedded = new Set(parsed.images.map((i) => i.id));
    const out = remapProjectIds(parsed.schema, { fileOf: (old) => (old && embedded.has(old) ? old : undefined) });
    expect(out.tables).toHaveLength(parsed.schema.tables.length);
    expect(out.elements).toHaveLength(parsed.schema.elements.length);
  });
});
