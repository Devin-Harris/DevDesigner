import {
  BUILT_IN_THEMES,
  DEFAULT_THEME,
  presentationThemes,
  resolveThemeColor,
  resolveThemeElement,
  resolveThemedElements,
  resolveThemeFont,
  parseThemeFile,
  themeFile,
  themeTokensOnly,
} from './themes';

const midnight = BUILT_IN_THEMES.find((t) => t.id === 'midnight')!;

describe('themes', () => {
  it('leaves literals alone and resolves tokens', () => {
    expect(resolveThemeColor('#123456', midnight)).toBe('#123456');
    expect(resolveThemeColor('$accent1', midnight)).toBe(midnight.colors.accent1);
    expect(resolveThemeColor('$nope', midnight)).toBe('$nope');
    expect(resolveThemeFont('$heading', midnight)).toBe(midnight.fonts.heading);
    expect(resolveThemeFont('serif', midnight)).toBe('serif');
  });

  it('returns the same element when it has no tokens', () => {
    const e = { strokeColor: '#000', backgroundColor: undefined, fontFamily: 'inter', runs: undefined };
    expect(resolveThemeElement(e)).toBe(e);
  });

  it('resolves run colors', () => {
    const e = { strokeColor: '$text', runs: [{ text: 'a', color: '$accent2' }, { text: 'b' }] };
    const r = resolveThemeElement(e, midnight);
    expect(r.strokeColor).toBe(midnight.colors.text);
    expect(r.runs![0].color).toBe(midnight.colors.accent2);
    expect(r.runs![1]).toBe(e.runs[1]);
  });

  it('resolves each element against its presentation theme', () => {
    const els = [
      { id: 'f1', type: 'frame', slide: { order: 0, presentation: 'A', theme: midnight }, strokeColor: '#000' },
      { id: 'f2', type: 'frame', slide: { order: 0, presentation: 'B' }, strokeColor: '#000' },
      { id: 't1', type: 'text', slideId: 'f1', strokeColor: '$heading' },
      { id: 't2', type: 'text', slideId: 'f2', strokeColor: '$heading' },
      { id: 't3', type: 'text', strokeColor: '$heading' },
    ];
    expect(presentationThemes(els).get('A')).toBe(midnight);
    const out = resolveThemedElements(els);
    expect(out[2].strokeColor).toBe(midnight.colors.heading);
    expect(out[3].strokeColor).toBe(DEFAULT_THEME.colors.heading);
    expect(out[4].strokeColor).toBe(DEFAULT_THEME.colors.heading);
  });
});

describe('theme files', () => {
  const bold = BUILT_IN_THEMES.find((t) => t.id === 'bold')!;

  it('round-trips a theme with its layout designs', () => {
    const parsed = parseThemeFile(JSON.parse(JSON.stringify(themeFile(bold))));
    expect(parsed).toEqual(bold);
  });

  it('explains what is wrong with a bad file', () => {
    expect(parseThemeFile({ format: 'other' })).toMatch(/not a DBDesigner theme/);
    expect(parseThemeFile({ format: 'dbdesigner-theme', version: 99, theme: bold })).toMatch(/newer version/);
    const noAccent = { ...bold, colors: { ...bold.colors, accent1: undefined } };
    expect(parseThemeFile({ format: 'dbdesigner-theme', version: 1, theme: noAccent })).toMatch(/accent1/);
  });

  it('strips designs for slide frames', () => {
    const t = themeTokensOnly(bold);
    expect(t.layouts).toBeUndefined();
    expect(t.colors).toBe(bold.colors);
  });
});
