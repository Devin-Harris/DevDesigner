/**
 * VS Code-style bracket and quote pairing for the text and code editors.
 *
 * Typing an opener inserts its closer too (or wraps the selection), typing a closer
 * right before the same auto-inserted closer steps over it, and Backspace between an
 * empty pair removes both halves.
 */

export const PAIRS: Readonly<Record<string, string>> = {
   '(': ')',
   '[': ']',
   '{': '}',
   '"': '"',
   "'": "'",
   '`': '`',
};

const CLOSERS = new Set(Object.values(PAIRS));
const QUOTES = new Set(['"', "'", '`']);
const WORD = /[\p{L}\p{N}_]/u;

/** A splice of `value`: replace [from, to) with `insert`, then select [selStart, selEnd). */
export interface PairEdit {
   from: number;
   to: number;
   insert: string;
   selStart: number;
   selEnd: number;
}

/** The edit for typing `key` over [start, end) of `value`, or null to let the key type normally. */
export function autoPairKey(value: string, start: number, end: number, key: string): PairEdit | null {
   const next = value[end];
   const prev = value[start - 1];
   if (start !== end && PAIRS[key]) {
      // Wrap the selection, keeping it selected.
      const inner = value.slice(start, end);
      return { from: start, to: end, insert: key + inner + PAIRS[key], selStart: start + 1, selEnd: end + 1 };
   }
   if (start !== end) return null;
   if (CLOSERS.has(key) && next === key && (!QUOTES.has(key) || prev !== '\\')) {
      // Step over a closer that is already there.
      return { from: start, to: start, insert: '', selStart: start + 1, selEnd: start + 1 };
   }
   const close = PAIRS[key];
   if (!close) return null;
   // Only pair before whitespace, a closer, punctuation or the end (as VS Code does).
   if (next !== undefined && (WORD.test(next) || (QUOTES.has(next) && QUOTES.has(key)))) return null;
   // Quotes: not straight after a word character (an apostrophe in "don't").
   if (QUOTES.has(key) && prev !== undefined && (WORD.test(prev) || prev === '\\')) return null;
   return { from: start, to: start, insert: key + close, selStart: start + 1, selEnd: start + 1 };
}

/** True when the caret sits between an empty pair, e.g. `(|)`, so Backspace should remove both. */
export function inEmptyPair(value: string, caret: number): boolean {
   const open = value[caret - 1];
   return !!open && PAIRS[open] !== undefined && value[caret] === PAIRS[open];
}

/**
 * Enter in a code block: keep the line's indent, and between a bracket pair
 * (`{|}`) open an indented line with the closer on its own line below.
 * Indents one level only when the text before the caret ends with an opener.
 */
export function codeEnter(value: string, start: number, end: number, indent: string): PairEdit {
   const lineStart = value.lastIndexOf('\n', start - 1) + 1;
   const before = value.slice(lineStart, start);
   const lead = /^[ \t]*/.exec(before)?.[0] ?? '';
   const trimmed = before.trimEnd();
   const last = trimmed[trimmed.length - 1];
   const opens = !!last && last in PAIRS && !QUOTES.has(last);
   // Whitespace after the caret would otherwise be carried to the new line.
   let to = end;
   while (value[to] === ' ' || value[to] === '\t') to += 1;
   // Trailing spaces left behind on the current line are dropped too.
   const from = lineStart + trimmed.length < start && trimmed.length > 0 ? lineStart + trimmed.length : start;
   if (opens && value[to] === PAIRS[last]) {
      const inner = `\n${lead}${indent}`;
      return { from, to, insert: `${inner}\n${lead}`, selStart: from + inner.length, selEnd: from + inner.length };
   }
   const insert = `\n${lead}${opens ? indent : ''}`;
   return { from, to, insert, selStart: from + insert.length, selEnd: from + insert.length };
}

/**
 * Enter, Backspace and bracket/quote keys in a code block's textarea; calls
 * preventDefault when it handles the key. `insert` types text over the selection
 * (keeping native undo).
 */
export function codeEditKey(
   event: KeyboardEvent,
   area: HTMLTextAreaElement,
   indent: string,
   insert: (text: string) => void
): void {
   const apply = (edit: PairEdit): void => {
      event.preventDefault();
      if (edit.insert || edit.from !== edit.to) {
         area.setSelectionRange(edit.from, edit.to);
         insert(edit.insert);
      }
      area.setSelectionRange(edit.selStart, edit.selEnd);
   };
   if (event.ctrlKey || event.metaKey || event.altKey) return;
   const { value, selectionStart: start, selectionEnd: end } = area;
   if (event.key === 'Enter' && !event.shiftKey) {
      apply(codeEnter(value, start, end, indent));
   } else if (event.key === 'Backspace') {
      if (start === end && inEmptyPair(value, start)) {
         apply({ from: start - 1, to: start + 1, insert: '', selStart: start - 1, selEnd: start - 1 });
      }
   } else if (event.key.length === 1) {
      const edit = autoPairKey(value, start, end, event.key);
      if (edit) apply(edit);
   }
}
