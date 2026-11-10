import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { parseProjectExport } from './project-import.parser';
import { UpdateThemesDto } from './dto/update-themes.dto';

/**
 * The home showcase and the guide sandboxes import the seed files under
 * client/src/app/**\/seeds/*.json. Every server-side validation added to the import
 * parser (colors, theme designs, ...) must keep accepting them, and their theme
 * libraries must also pass the PUT /themes DTO the editor saves them with.
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

  it.each(files.map((f) => [relative(CLIENT_APP, f), f]))('%s passes the import parser', (_name, file) => {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
    expect(() => parseProjectExport(raw)).not.toThrow();
  });

  it.each(files.map((f) => [relative(CLIENT_APP, f), f]))('%s themes pass the themes DTO', (_name, file) => {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { schema?: { themes?: unknown[] } };
    const themes = raw.schema?.themes ?? [];
    const errors = validateSync(plainToInstance(UpdateThemesDto, { themes }), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toEqual([]);
  });
});
