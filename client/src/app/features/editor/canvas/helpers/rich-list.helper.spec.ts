import type { TextRun } from '@devdesigner/shared';
import {
   listAutoformat,
   listBackspace,
   listEnter,
   listKindOver,
   normalizeLists,
   parseLines,
   shiftListIndent,
   toggleList,
   type ListResult,
} from './rich-list.helper';
import { plainOf } from './rich-text.helper';

const runs = (text: string): TextRun[] => [{ text }];
const textOf = (result: ListResult | null): string | null => (result ? plainOf(result.runs) : null);

describe('parseLines', () => {
   it.each([
      ['• item', { kind: 'bullet', indent: 0, number: 0, markerEnd: 2 }],
      ['    ◦ nested', { kind: 'bullet', indent: 4, number: 0, markerEnd: 6 }],
      ['12. twelfth', { kind: 'number', indent: 0, number: 12, markerEnd: 4 }],
      ['  plain', { kind: null, indent: 2, number: 0, markerEnd: 2 }],
      ['1.no space', { kind: null, indent: 0, number: 0, markerEnd: 0 }],
   ])('parses %j', (text, expected) => {
      expect(parseLines(text)[0]).toMatchObject(expected);
   });

   it('reports offsets of every line, including a trailing empty one', () => {
      expect(parseLines('ab\ncd\n').map((l) => [l.start, l.end])).toEqual([
         [0, 2],
         [3, 5],
         [6, 6],
      ]);
   });
});

describe('toggleList', () => {
   it('adds bullets to every selected line', () => {
      expect(textOf(toggleList(runs('one\ntwo'), 0, 7, 'bullet'))).toBe('• one\n• two');
   });

   it('numbers the selected lines sequentially', () => {
      expect(textOf(toggleList(runs('one\ntwo\nthree'), 0, 13, 'number'))).toBe('1. one\n2. two\n3. three');
   });

   it('removes the markers when every line already has that kind', () => {
      expect(textOf(toggleList(runs('• one\n• two'), 0, 11, 'bullet'))).toBe('one\ntwo');
   });

   it('converts a bullet list to a numbered one', () => {
      expect(textOf(toggleList(runs('• one\n• two'), 0, 11, 'number'))).toBe('1. one\n2. two');
   });

   it('skips blank lines inside a multi-line selection', () => {
      expect(textOf(toggleList(runs('one\n\ntwo'), 0, 8, 'bullet'))).toBe('• one\n\n• two');
   });

   it('excludes a line the selection only touches at its start', () => {
      expect(textOf(toggleList(runs('one\ntwo'), 0, 4, 'bullet'))).toBe('• one\ntwo');
   });

   it('maps old caret offsets past the inserted marker', () => {
      const result = toggleList(runs('one\ntwo'), 0, 7, 'bullet');
      expect(result.map(0)).toBe(2);
      expect(result.map(4)).toBe(8);
   });

   it('keeps run styles and gives the marker the style of the text it precedes, minus morph tags', () => {
      const result = toggleList([{ text: 'hello', bold: true, morph: 'greeting' }], 0, 0, 'bullet');
      expect(result.runs).toEqual([
         { text: '• ', bold: true },
         { text: 'hello', bold: true, morph: 'greeting' },
      ]);
   });
});

describe('listKindOver', () => {
   it.each([
      ['• a\n• b', 'bullet'],
      ['1. a\n2. b', 'number'],
      ['• a\n1. b', null],
      ['a\n• b', null],
   ])('%j -> %s', (text, kind) => {
      expect(listKindOver(text, 0, text.length)).toBe(kind);
   });

   it('accepts a reversed selection', () => {
      expect(listKindOver('• a\n• b', 7, 0)).toBe('bullet');
   });
});

describe('normalizeLists', () => {
   it('returns null for text without list markers', () => {
      expect(normalizeLists(runs('plain text'))).toBeNull();
   });

   it('returns null when the numbering is already right', () => {
      expect(normalizeLists(runs('1. a\n2. b'))).toBeNull();
   });

   it('renumbers after a line was removed', () => {
      expect(textOf(normalizeLists(runs('1. a\n3. c\n4. d')))).toBe('1. a\n2. c\n3. d');
   });

   it('restarts numbering after a plain line', () => {
      expect(textOf(normalizeLists(runs('1. a\nbreak\n5. b')))).toBe('1. a\nbreak\n1. b');
   });

   it('numbers each nesting level separately and resumes the outer count', () => {
      expect(textOf(normalizeLists(runs('1. a\n    7. x\n    9. y\n5. b')))).toBe('1. a\n    1. x\n    2. y\n2. b');
   });

   it('uses the bullet glyph of the nesting level', () => {
      expect(textOf(normalizeLists(runs('• a\n    • b\n        • c')))).toBe('• a\n    ◦ b\n        ▪ c');
   });
});

describe('shiftListIndent', () => {
   it('returns null when no selected line is a list item', () => {
      expect(shiftListIndent(runs('plain'), 0, 0, 1)).toBeNull();
   });

   it('indents one level and switches to the nested bullet', () => {
      expect(textOf(shiftListIndent(runs('• a\n• b'), 5, 5, 1))).toBe('• a\n    ◦ b');
   });

   it('outdents and renumbers', () => {
      expect(textOf(shiftListIndent(runs('1. a\n    1. b'), 8, 8, -1))).toBe('1. a\n2. b');
   });

   it('returns null when outdenting a top-level item', () => {
      expect(shiftListIndent(runs('• a'), 2, 2, -1)).toBeNull();
   });
});

describe('listEnter', () => {
   it('continues a bullet list', () => {
      expect(listEnter(runs('• a'), 3)).toEqual({ insert: '\n• ' });
   });

   it('continues numbering from the current item', () => {
      expect(listEnter(runs('1. a\n2. b'), 9)).toEqual({ insert: '\n3. ' });
   });

   it('keeps the indentation of a nested item', () => {
      expect(listEnter(runs('    ◦ a'), 7)).toEqual({ insert: '\n    ◦ ' });
   });

   it('returns null outside a list item or inside its marker', () => {
      expect(listEnter(runs('plain'), 5)).toBeNull();
      expect(listEnter(runs('1. a'), 1)).toBeNull();
   });

   it('drops the marker of an empty top-level item (exits the list)', () => {
      const result = listEnter(runs('• a\n• '), 6);
      expect(result && 'exit' in result ? plainOf(result.exit.runs) : null).toBe('• a\n');
   });

   it('outdents an empty nested item before exiting', () => {
      const result = listEnter(runs('• a\n    ◦ '), 10);
      expect(result && 'exit' in result ? plainOf(result.exit.runs) : null).toBe('• a\n• ');
   });
});

describe('listBackspace', () => {
   it('only acts with the caret right after the marker', () => {
      expect(listBackspace(runs('• abc'), 3)).toBeNull();
      expect(listBackspace(runs('plain'), 0)).toBeNull();
   });

   it('removes a top-level marker', () => {
      expect(textOf(listBackspace(runs('• abc'), 2))).toBe('abc');
   });

   it('outdents a nested item first', () => {
      expect(textOf(listBackspace(runs('• a\n    ◦ b'), 10))).toBe('• a\n• b');
   });
});

describe('listAutoformat', () => {
   it.each([
      ['-', '• '],
      ['*', '• '],
      ['1.', '1. '],
   ])('turns %j at a line start into a list marker', (typed, marker) => {
      expect(textOf(listAutoformat(runs(typed), typed.length))).toBe(marker);
   });

   it('renumbers an autoformatted item to follow the list above', () => {
      expect(textOf(listAutoformat(runs('1. a\n5.'), 7))).toBe('1. a\n2. ');
   });

   it('ignores markers that are not at the line start', () => {
      expect(listAutoformat(runs('a -'), 3)).toBeNull();
   });

   it('ignores lines that are already list items', () => {
      expect(listAutoformat(runs('• -'), 3)).toBeNull();
   });
});
