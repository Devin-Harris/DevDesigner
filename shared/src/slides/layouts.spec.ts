import {
  isEmptyPlaceholder,
  layoutNameOf,
  layoutOf,
  matchPlaceholders,
  placeholderPrompt,
  presentableSlides,
  presentationLayouts,
  presentationSlides,
} from '.';

const f = (id: string, slide: Record<string, unknown>) => ({ id, x: 0, y: 0, slide: { order: 0, ...slide } });

describe('slide layouts', () => {
  const layout = f('L', { layout: true, presentation: 'A' });
  const other = f('M', { layout: true, presentation: 'B', layoutName: 'Body' });
  const s1 = f('s1', { order: 1, presentation: 'A', layoutId: 'L' });
  const s2 = f('s2', { order: 2, presentation: 'A', layoutId: 'M' });
  const frames = [layout, other, s1, s2];

  it('keeps layouts out of the sequence', () => {
    expect(presentationSlides(frames, 'A').map((x) => x.id)).toEqual(['s1', 's2']);
    expect(presentableSlides(frames).map((x) => x.id)).toEqual(['s1', 's2']);
    expect(presentationLayouts(frames, 'A').map((x) => x.id)).toEqual(['L']);
  });

  it('resolves a slide layout only within its presentation', () => {
    expect(layoutOf(s1, frames)?.id).toBe('L');
    expect(layoutOf(s2, frames)).toBeUndefined();
    expect(layoutOf(layout, frames)).toBeUndefined();
  });

  it('names layouts', () => {
    expect(layoutNameOf(layout, frames)).toBe('Layout 1');
    expect(layoutNameOf(other, frames)).toBe('Body');
  });
});

describe('placeholders', () => {
  const ph = (id: string, role: 'title' | 'body', y: number) => ({ id, x: 0, y, placeholder: { role } });
  it('pairs copies with new layout slots by role and reading order', () => {
    const copies = [ph('t', 'title', 0), ph('b1', 'body', 100), ph('b2', 'body', 200)];
    const slots = [ph('T', 'title', 10), ph('B', 'body', 90)];
    expect([...matchPlaceholders(copies, slots)]).toEqual([
      ['t', 'T'],
      ['b1', 'B'],
    ]);
  });
  it('knows empty copies and default prompts', () => {
    expect(isEmptyPlaceholder({ placeholder: { role: 'title' }, text: ' ' })).toBe(true);
    expect(isEmptyPlaceholder({ text: '' })).toBe(false);
    expect(placeholderPrompt({ role: 'title' })).toBe('Click to add title');
  });
});

describe('untyped placeholders', () => {
  it('pair with untyped slots only', () => {
    const plain = (id: string, y: number) => ({ id, x: 0, y, placeholder: {} });
    const titled = { id: 'T', x: 0, y: 0, placeholder: { role: 'title' as const } };
    expect([...matchPlaceholders([plain('a', 0)], [titled, plain('A', 50)])]).toEqual([['a', 'A']]);
    expect(placeholderPrompt({})).toBe('Click to add text');
  });
});

describe('placeholder identity', () => {
  it('sends a copy back to the slot it came from before matching by type', () => {
    const slots = [
      { id: 'T1', x: 0, y: 0, placeholder: { role: 'title' as const } },
      { id: 'T2', x: 0, y: 50, placeholder: { role: 'title' as const } },
    ];
    const copies = [
      { id: 'a', x: 0, y: 0, placeholder: { role: 'title' as const, of: 'X' } },
      { id: 'b', x: 0, y: 90, placeholder: { role: 'title' as const, of: 'T1' } },
    ];
    expect([...matchPlaceholders(copies, slots)]).toEqual([
      ['b', 'T1'],
      ['a', 'T2'],
    ]);
  });
});
