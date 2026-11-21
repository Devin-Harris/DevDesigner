import { DIFF_SPACER, diffEditValue, paddedToReal, realToPadded, stripDiffSpacers } from './code-diff-edit.helper';

describe('split diff edit padding', () => {
   const original = 'a\nb\nc';
   const changed = 'a\nx\ny\nz\nc';

   it('pads the shorter side so both keep the split view rows', () => {
      const left = diffEditValue(original, changed, 'original', true).split('\n');
      const right = diffEditValue(original, changed, 'modified', true).split('\n');
      expect(left.length).toBe(right.length);
      expect(left.filter((l) => l === DIFF_SPACER).length).toBe(2);
      expect(stripDiffSpacers(left.join('\n'))).toBe(original);
      expect(stripDiffSpacers(right.join('\n'))).toBe(changed);
   });

   it('maps carets between padded and real text', () => {
      const padded = `a\nb\n${DIFF_SPACER}\n${DIFF_SPACER}\nc`;
      const real = stripDiffSpacers(padded);
      expect(real).toBe('a\nb\nc');
      const cAt = padded.lastIndexOf('c');
      expect(paddedToReal(padded, cAt)).toBe(real.indexOf('c'));
      expect(realToPadded(padded, real.indexOf('c'))).toBe(cAt);
      // Text typed onto a spacer line becomes a real line.
      expect(stripDiffSpacers(`a\n${DIFF_SPACER}q\nc`)).toBe('a\nq\nc');
   });
});
