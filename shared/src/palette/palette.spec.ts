import {
  HEADER_COLOR_CYCLE,
  PALETTE,
  isLightFill,
  paletteNames,
  readableTextOn,
  resolveColor,
} from './index';

describe('resolveColor', () => {
  it('resolves names case/space-insensitively and passes hex through', () => {
    expect(resolveColor('Blue').hex).toBe('#2f6bff');
    expect(resolveColor('amber-soft').hex).toBe('#fef3c7');
    expect(resolveColor('light blue').hex).toBe('#dbeafe');
    expect(resolveColor('grey').hex).toBe('#94a3b8');
    expect(resolveColor('#ABC').hex).toBe('#aabbcc');
    expect(resolveColor('transparent').hex).toBe('transparent');
  });

  it('reports unknown colors as null', () => {
    expect(resolveColor('chartreuse-ish').hex).toBeNull();
    expect(resolveColor('').hex).toBeNull();
  });
});

describe('readable text', () => {
  it('uses white on strong headers that are dark enough and dark on pale/amber fills', () => {
    expect(readableTextOn('#2f6bff')).toBe('#ffffff');
    expect(readableTextOn('#7c5cff')).toBe('#ffffff');
    expect(readableTextOn('#f5a623')).toBe('#0f172a');
    expect(isLightFill('#dbeafe')).toBe(true);
    expect(isLightFill('#1e293b')).toBe(false);
    expect(isLightFill('')).toBe(false);
  });

  it('every soft tint takes dark text', () => {
    for (const c of PALETTE.filter((p) => p.tone === 'soft')) {
      expect(readableTextOn(c.hex)).toBe('#0f172a');
    }
  });
});

describe('palette lists', () => {
  it('has unique names and a header cycle of strong colors', () => {
    const names = PALETTE.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    const strong = new Set(PALETTE.filter((c) => c.tone === 'strong').map((c) => c.hex));
    expect(HEADER_COLOR_CYCLE.every((h) => strong.has(h))).toBe(true);
    expect(paletteNames()).toContain('blue-soft');
  });
});
