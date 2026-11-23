import { autoPairKey, codeEnter, inEmptyPair } from './auto-pair.helper';

describe('autoPairKey', () => {
   it('pairs an opener at the end', () => {
      expect(autoPairKey('a ', 2, 2, '(')).toEqual({ from: 2, to: 2, insert: '()', selStart: 3, selEnd: 3 });
   });
   it('does not pair before a word', () => {
      expect(autoPairKey('foo', 0, 0, '(')).toBeNull();
   });
   it('does not pair an apostrophe after a word', () => {
      expect(autoPairKey('don', 3, 3, "'")).toBeNull();
   });
   it('wraps a selection', () => {
      expect(autoPairKey('abc', 0, 3, '[')).toEqual({ from: 0, to: 3, insert: '[abc]', selStart: 1, selEnd: 4 });
   });
   it('steps over an existing closer', () => {
      expect(autoPairKey('()', 1, 1, ')')).toEqual({ from: 1, to: 1, insert: '', selStart: 2, selEnd: 2 });
   });
   it('detects an empty pair', () => {
      expect(inEmptyPair('{}', 1)).toBe(true);
      expect(inEmptyPair('{a}', 1)).toBe(false);
   });
});

describe('codeEnter', () => {
   it('keeps the indent of a plain line', () => {
      const e = codeEnter('  foo', 5, 5, '  ');
      expect(e.insert).toBe('\n  ');
   });
   it('indents after an opener', () => {
      expect(codeEnter('if (x) {', 8, 8, '  ').insert).toBe('\n  ');
   });
   it('splits a bracket pair onto three lines', () => {
      const e = codeEnter('f() {}', 5, 5, '  ');
      expect(e.insert).toBe('\n  \n');
      expect(e.selStart).toBe(8);
   });
   it('does not carry spaces after the caret onto the new line', () => {
      const e = codeEnter('a   b', 1, 1, '  ');
      expect(e).toEqual({ from: 1, to: 4, insert: '\n', selStart: 2, selEnd: 2 });
   });
   it('does not indent after a quote', () => {
      expect(codeEnter('x = "', 5, 5, '  ').insert).toBe('\n');
   });
});
