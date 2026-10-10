import {
  effectiveTransition,
  matchMorphItems,
  nextCopyName,
  presentableSlides,
  presentationNames,
  presentationSlides,
  slideSequence,
  textSimilarity,
  type MorphItem,
} from './index';

const frame = (id: string, order: number | undefined, x = 0, y = 0, hidden = false) => ({
  id,
  x,
  y,
  slide: order === undefined ? undefined : { order, hidden },
});

const item = (
  key: string,
  type: string,
  text: string,
  cx: number,
  cy: number,
  w = 100,
  h = 50,
): MorphItem => ({ key, kind: 'element', type, text, cx, cy, w, h });

describe('slide sequence', () => {
  it('orders only frames with a slide config, ties by reading order', () => {
    const seq = slideSequence([
      frame('c', 2),
      frame('loose', undefined),
      frame('a', 1, 500, 0),
      frame('b', 1, 100, 0),
    ]);
    expect(seq.map((f) => f.id)).toEqual(['b', 'a', 'c']);
  });

  it('skips hidden slides when presenting', () => {
    const slides = presentableSlides([frame('a', 1), frame('b', 2, 0, 0, true), frame('c', 3)]);
    expect(slides.map((f) => f.id)).toEqual(['a', 'c']);
  });

  it('defaults the transition to none', () => {
    expect(effectiveTransition(undefined).type).toBe('none');
    const own = effectiveTransition({
      order: 1,
      transition: { type: 'fade', duration: 200, easing: 'linear' },
    });
    expect(own.duration).toBe(200);
  });
});

describe('morph matching', () => {
  it('pairs by shared lineage key first, even when far apart', () => {
    const pairs = matchMorphItems(
      [item('k', 'rectangle', '', 0, 0)],
      [item('k', 'rectangle', '', 900, 900)],
    );
    expect(pairs).toEqual([[0, 0]]);
  });

  it('pairs same-type items with identical text, nearest first', () => {
    const from = [item('a', 'text', 'Hello', 0, 0), item('b', 'text', 'Hello', 500, 0)];
    const to = [item('c', 'text', 'Hello', 480, 10)];
    expect(matchMorphItems(from, to)).toEqual([[1, 0]]);
  });

  it('pairs similar text but not unrelated text', () => {
    expect(textSimilarity('Users table', 'Users tables')).toBeGreaterThan(0.6);
    const pairs = matchMorphItems(
      [item('a', 'text', 'Users table', 0, 0)],
      [item('b', 'text', 'Billing', 0, 0)],
    );
    expect(pairs).toEqual([]);
  });

  it('treats grown or trimmed text as the same text', () => {
    const pairs = matchMorphItems(
      [item('a', 'text', 'Hello DB', 0, 0)],
      [item('b', 'text', 'Hello DB, in detail', 300, 0)],
    );
    expect(pairs).toEqual([[0, 0]]);
  });

  it('pairs textless same-type shapes, nearest first, however far or different in size', () => {
    const near = matchMorphItems(
      [item('a', 'rectangle', '', 0, 0)],
      [item('b', 'rectangle', '', 50, 40)],
    );
    expect(near).toEqual([[0, 0]]);
    const far = matchMorphItems(
      [item('a', 'rectangle', '', 0, 0)],
      [item('b', 'rectangle', '', 5000, 0, 40, 20)],
    );
    expect(far).toEqual([[0, 0]]);
    const two = matchMorphItems(
      [item('a', 'rectangle', '', 0, 0), item('b', 'rectangle', '', 600, 0)],
      [item('c', 'rectangle', '', 590, 300)],
    );
    expect(two).toEqual([[1, 0]]);
  });

  it('does not pair different shape types, or unrelated free-form content', () => {
    expect(
      matchMorphItems([item('a', 'rectangle', '', 0, 0)], [item('b', 'ellipse', '', 0, 0)]),
    ).toEqual([]);
    expect(
      matchMorphItems([item('a', 'text', 'Users', 0, 0)], [item('b', 'text', 'Billing', 0, 0)]),
    ).toEqual([]);
  });

  it('never pairs an element with a table or reuses an item', () => {
    const from = [item('a', 'rectangle', '', 0, 0)];
    const to: MorphItem[] = [
      { ...item('a', 'table', 'a', 0, 0), kind: 'table' },
      item('a', 'rectangle', '', 5, 5),
    ];
    expect(matchMorphItems(from, to)).toEqual([[0, 1]]);
  });
});

describe('nextCopyName', () => {
  it('counts a trailing number up past taken names', () => {
    expect(nextCopyName('Slide 2', ['Slide 1', 'Slide 2'])).toBe('Slide 3');
    expect(nextCopyName('Slide 2', ['Slide 2', 'Slide 3', 'slide 4'])).toBe('Slide 5');
  });
  it('appends 2 when there is no number', () => {
    expect(nextCopyName('Intro', ['Intro'])).toBe('Intro 2');
    expect(nextCopyName('Intro', ['Intro', 'Intro 2'])).toBe('Intro 3');
  });
});

describe('presentations', () => {
  const inPres = (id: string, order: number, presentation?: string) => ({
    id,
    x: 0,
    y: 0,
    slide: { order, presentation },
  });
  const frames = [inPres('a', 0), inPres('b', 1, 'Demo'), inPres('c', 2), inPres('d', 3, 'Demo')];

  it('groups slides by presentation, unnamed ones in the default', () => {
    expect(presentationNames(frames)).toEqual(['Presentation 1', 'Demo']);
    expect(presentationSlides(frames, 'Demo').map((f) => f.id)).toEqual(['b', 'd']);
    expect(presentationSlides(frames, 'Presentation 1').map((f) => f.id)).toEqual(['a', 'c']);
  });
});
