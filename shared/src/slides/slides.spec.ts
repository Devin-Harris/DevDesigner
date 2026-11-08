import {
  effectiveTransition,
  matchMorphItems,
  morphIdForTag,
  morphTagOf,
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
  it('chains split tags: a -> (in a, out b) -> b', () => {
    const x = item('tag:a', 'rectangle', '', 0, 0);
    const y = { ...item('tag:a', 'rectangle', '', 300, 0), keyIn: 'tag:a', keyOut: 'tag:b' };
    const z = item('tag:b', 'ellipse', '', 600, 400);
    expect(matchMorphItems([x], [y])).toEqual([[0, 0]]);
    expect(matchMorphItems([y], [z])).toEqual([[0, 0]]);
    expect(matchMorphItems([z], [y], undefined, true)).toEqual([[0, 0]]);
  });

  it('uses split in / out tags only on their own side of a transition', () => {
    // Slide A's arrow morphs OUT into slide B's box, whose in-tag matches; B's box keeps
    // its own out key for the next transition.
    const a = { ...item('a1', 'arrow', '', 0, 0), keyOut: 'tag:pair-1' };
    const aBox = item('a2', 'rectangle', '', 10, 10);
    const b = { ...item('b1', 'rectangle', '', 400, 400), keyIn: 'tag:pair-1', keyOut: 'tag:next' };
    expect(matchMorphItems([aBox, a], [b])).toEqual([[1, 0]]);
    // Played backwards (from = later slide) the same pair holds.
    expect(matchMorphItems([b], [aBox, a], undefined, true)).toEqual([[0, 1]]);
    // A solo in-tag keeps an item from pairing at all.
    const solo = { ...item('b2', 'rectangle', '', 10, 10), keyIn: 'tag:solo-in-x' };
    expect(matchMorphItems([aBox], [solo])).toEqual([]);
  });

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

  describe('morph tags', () => {
    it('round-trips a tag through the morphId', () => {
      expect(morphIdForTag('  hero ')).toBe('tag:hero');
      expect(morphIdForTag('   ')).toBeNull();
      expect(morphTagOf('tag:hero')).toBe('hero');
      expect(morphTagOf('some-uuid')).toBeNull();
      expect(morphTagOf(null)).toBeNull();
    });

    it('pairs same-tagged items even when a nearer look-alike exists', () => {
      const from = [item('tag:hero', 'rectangle', '', 0, 0)];
      const to = [item('x', 'rectangle', '', 5, 5), item('tag:hero', 'rectangle', '', 900, 900)];
      expect(matchMorphItems(from, to)).toEqual([[0, 1]]);
    });

    it('does not pair a tagged item with an untagged look-alike or another tag', () => {
      expect(
        matchMorphItems(
          [item('tag:hero', 'rectangle', '', 0, 0)],
          [item('x', 'rectangle', '', 5, 5)],
        ),
      ).toEqual([]);
      expect(
        matchMorphItems(
          [item('tag:a', 'rectangle', '', 0, 0)],
          [item('tag:b', 'rectangle', '', 5, 5)],
        ),
      ).toEqual([]);
      // ...and an untagged item does not grab a tagged one that the old slide also tags...
      expect(
        matchMorphItems(
          [item('x', 'rectangle', '', 0, 0), item('tag:hero', 'rectangle', '', 300, 300)],
          [item('tag:hero', 'rectangle', '', 5, 5)],
        ),
      ).toEqual([[1, 0]]);
      // ...but takes one whose tag nothing on the old slide carries (unless it is a solo tag).
      expect(
        matchMorphItems(
          [item('x', 'rectangle', '', 0, 0)],
          [item('tag:hero', 'rectangle', '', 5, 5)],
        ),
      ).toEqual([[0, 0]]);
      expect(
        matchMorphItems(
          [item('x', 'rectangle', '', 0, 0)],
          [item('tag:solo-ab12', 'rectangle', '', 5, 5)],
        ),
      ).toEqual([]);
    });
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

describe('matchMorphItems: word-level tags', () => {
  const text = (key: string, t: string, runTags: string[], cx = 100, cy = 100): MorphItem => ({
    key,
    kind: 'element',
    type: 'text',
    text: t,
    runTags,
    cx,
    cy,
    w: 200,
    h: 30,
  });

  it('pairs two otherwise unrelated text objects that share a tagged word', () => {
    const a = [text('tag:solo-a', 'Revenue: $4M', ['total'])];
    const b = [text('tag:solo-b', 'This quarter we made $5M in sales', ['total'], 600, 300)];
    expect(matchMorphItems(a, b)).toEqual([[0, 0]]);
  });

  it('does not pair solo-tagged look-alikes without a shared word tag', () => {
    const a = [text('tag:solo-a', 'Same text', [])];
    const b = [text('tag:solo-b', 'Same text', [])];
    expect(matchMorphItems(a, b)).toEqual([]);
  });
});

describe('matchMorphItems: tags', () => {
  const item = (key: string, x: number, extra: Partial<Parameters<typeof matchMorphItems>[0][number]> = {}) =>
    ({ key, kind: 'element', type: 'rectangle', text: '', x, y: 0, w: 100, h: 60, ...extra }) as Parameters<typeof matchMorphItems>[0][number];

  it('lets an untagged item morph into a tagged one nobody on the old slide claims', () => {
    expect(matchMorphItems([item('a', 0)], [item('tag:hero', 10)])).toEqual([[0, 0]]);
  });

  it('keeps a tagged item reserved when the old slide carries its tag', () => {
    const pairs = matchMorphItems([item('a', 0), item('tag:hero', 400)], [item('tag:hero', 10), item('c', 420)]);
    expect(pairs).toContainEqual([1, 0]);
    expect(pairs).toContainEqual([0, 1]);
  });

  it('never lets two old items morph into the same new item', () => {
    const pairs = matchMorphItems([item('a', 0), item('b', 20)], [item('tag:x', 10)]);
    expect(pairs).toHaveLength(1);
  });
});

describe('matchMorphItems: reversed (going back)', () => {
  const item = (key: string, x: number) =>
    ({ key, kind: 'element', type: 'rectangle', text: '', x, y: 0, w: 100, h: 60 }) as Parameters<typeof matchMorphItems>[0][number];

  it('unanimates an untagged -> tagged morph, and still blocks tagged -> untagged forward', () => {
    const later = [item('tag:hero', 10)];
    const earlier = [item('a', 0)];
    expect(matchMorphItems(earlier, later)).toEqual([[0, 0]]);
    expect(matchMorphItems(later, earlier, undefined, true)).toEqual([[0, 0]]);
    expect(matchMorphItems(later, earlier)).toEqual([]);
  });

  it('keeps a tag reserved when the other slide carries it', () => {
    const later = [item('tag:hero', 400), item('b', 0)];
    const earlier = [item('a', 0), item('tag:hero', 420)];
    const pairs = matchMorphItems(later, earlier, undefined, true);
    expect(pairs).toContainEqual([0, 1]);
    expect(pairs).toContainEqual([1, 0]);
  });
});
