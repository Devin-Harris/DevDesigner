import {
  SEQ_ARROW_MIN_VISIBLE,
  SEQ_LABEL_CHAR_W,
  SEQ_LABEL_PAD_X,
  messageLabelLines,
  messageLabelMaxChars,
  wrapLabelLines,
} from './index';

describe('wrapLabelLines', () => {
  it('leaves short labels alone and keeps explicit breaks', () => {
    expect(wrapLabelLines('hello', 20)).toEqual(['hello']);
    expect(wrapLabelLines('a\nb', 20)).toEqual(['a', 'b']);
    expect(wrapLabelLines('', 20)).toEqual(['']);
  });

  it('wraps on word boundaries', () => {
    expect(wrapLabelLines('verify the password hash', 12)).toEqual(['verify the', 'password', 'hash']);
  });

  it('breaks words longer than a line', () => {
    expect(wrapLabelLines('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapLabelLines('x abcdefghij', 4)).toEqual(['x', 'abcd', 'efgh', 'ij']);
  });

  it('never exceeds the limit', () => {
    const lines = wrapLabelLines('The quick brown fox jumps over the lazy dog repeatedly forever', 15);
    expect(lines.every((l) => l.length <= 15)).toBe(true);
  });
});

describe('messageLabelLines', () => {
  it('always leaves arrow visible on both sides of the label', () => {
    for (const span of [120, 160, 240, 400]) {
      const lines = messageLabelLines('a fairly long message label that needs wrapping', span);
      const pill = Math.max(...lines.map((l) => l.length)) * SEQ_LABEL_CHAR_W + SEQ_LABEL_PAD_X;
      expect(span - pill).toBeGreaterThanOrEqual(2 * SEQ_ARROW_MIN_VISIBLE - 1);
    }
  });

  it('keeps only explicit line breaks when wrap is off', () => {
    const label = 'a fairly long message label that needs wrapping\nsecond line';
    expect(messageLabelLines(label, 120, false, false)).toEqual([
      'a fairly long message label that needs wrapping',
      'second line',
    ]);
    expect(messageLabelLines(label, 120).length).toBeGreaterThan(2);
  });

  it('has a sane minimum on very short spans', () => {
    expect(messageLabelMaxChars(10)).toBeGreaterThanOrEqual(8);
  });
});
