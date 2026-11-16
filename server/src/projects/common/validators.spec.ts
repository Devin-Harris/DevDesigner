import { BadRequestException } from '@nestjs/common';
import { validated, validationError } from './validators';
import { UpdateElementDto } from '../canvas/elements/dto/update-element.dto';
import { UpdateTableDto } from '../schema/tables/dto/update-table.dto';
import { UpdateLifelineDto } from '../canvas/sequence/dto/update-lifeline.dto';
import { UpdateThemesDto } from '../projects/dto/update-themes.dto';
import { parseProjectExport } from '../project-file/project-import.parser';

const theme = (extra: Record<string, unknown> = {}) => ({
  name: 'T',
  colors: {
    background: '#ffffff',
    surface: '#f8fafc',
    heading: '#0f172a',
    text: '#334155',
    muted: '#64748b',
    accent1: '#2f6bff',
    accent2: 'amber',
    accent3: '#10b981',
    accent4: '#ec4899',
  },
  fonts: { heading: 'inter', body: 'inter' },
  ...extra,
});

describe('@IsColor (security H-1 / S1.2)', () => {
  it('accepts hex, palette names, tokens and clears', () => {
    expect(validationError(UpdateElementDto, { strokeColor: '#1e1e1e', backgroundColor: '$accent1' })).toBeNull();
    expect(validationError(UpdateTableDto, { color: 'blue' })).toBeNull();
    expect(validationError(UpdateLifelineDto, { color: '', textColor: 'theme' })).toBeNull();
  });

  it('refuses markup in any color field with 400', () => {
    const payload = '"/><script>alert(1)</script>';
    expect(() => validated(UpdateElementDto, 'elements[e1]', { strokeColor: payload })).toThrow(BadRequestException);
    expect(validationError(UpdateTableDto, { color: 'red;x' })).toMatch(/color/);
    expect(validationError(UpdateElementDto, { runs: [{ start: 0, end: 1, color: 'url(x)' }] })).not.toBeNull();
    expect(validationError(UpdateThemesDto, { themes: [theme({ colors: { ...theme().colors, text: 'x"y' } })] })).not.toBeNull();
  });

  it('applies to the import parser too', () => {
    const file = {
      format: 'devdesigner-project',
      version: 1,
      project: { name: 'P', description: null, type: 'ERD' },
      schema: {
        tables: [{ id: 't1', name: 't', x: 0, y: 0, color: 'red" onload="x', columns: [] }],
        relationships: [],
        elements: [],
      },
    };
    expect(() => parseProjectExport(file)).toThrow(/schema\.tables\[0\]\.color must be a color/);
  });
});

describe('theme designs (security M-4 / S2.2)', () => {
  const master = (item: Record<string, unknown>) => ({ themes: [theme({ master: [item] })] });

  it('accepts real layout items', () => {
    expect(
      validationError(UpdateThemesDto, {
        themes: [
          theme({
            layouts: { title: [{ kind: 'bar', x: 0, y: 0, w: 1, h: 4, color: '$accent1' }] },
            master: [
              { kind: 'text', role: 'title', prompt: 'Title', x: 0, y: 0, w: 1, size: 40, font: 'heading', color: '$heading' },
              { kind: 'element', x: 0, y: 0, w: 0.5, h: 0.5, el: { type: 'rectangle', strokeColor: '#000', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', opacity: 100 } },
            ],
            extraLayouts: [{ name: 'Mine', items: [] }],
          }),
        ],
      }),
    ).toBeNull();
  });

  it('refuses unknown kinds, bad colors, foreign keys and bad element props', () => {
    expect(validationError(UpdateThemesDto, master({ kind: 'script', x: 0, y: 0, w: 1 }))).toMatch(/kind/);
    expect(validationError(UpdateThemesDto, master({ kind: 'bar', x: 0, y: 0, w: 1, h: 1, color: '<x>' }))).toMatch(/color/);
    expect(validationError(UpdateThemesDto, master({ kind: 'bar', x: 0, y: 0, w: 1, h: 1, color: '#000', onload: 'x' }))).toMatch(/onload/);
    expect(
      validationError(UpdateThemesDto, master({ kind: 'element', x: 0, y: 0, w: 1, h: 1, el: { type: 'rectangle', strokeColor: 'x"' } })),
    ).not.toBeNull();
    expect(
      validationError(UpdateThemesDto, { themes: [theme({ layouts: { nope: [] } })] }),
    ).toMatch(/layout kind/);
  });

  it('caps the serialized size', () => {
    const big = Array.from({ length: 400 }, () => ({
      kind: 'text', role: 'body', prompt: 'x'.repeat(200), x: 0, y: 0, w: 1, size: 10, font: 'body', color: '#000',
    }));
    const extraLayouts = Array.from({ length: 5 }, (_, i) => ({ name: `L${i}`, items: big }));
    expect(validationError(UpdateThemesDto, { themes: [theme({ extraLayouts })] })).toMatch(/too large/);
  });
});
