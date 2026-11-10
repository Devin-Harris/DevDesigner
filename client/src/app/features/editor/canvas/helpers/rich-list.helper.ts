import type { TextRun } from '@devdesigner/shared';
import { normalizeRuns, plainOf } from './rich-text.helper';

/**
 * Bulleted / numbered lists in text elements.
 *
 * A list item is an ordinary line that starts with a marker ("• " or "1. "),
 * optionally indented by spaces. Keeping the markers in the text means lists
 * render, export, morph and sync everywhere text already does, with no extra
 * storage; the editor just keeps them tidy (auto-continue on Enter, renumbering,
 * Tab to indent, Backspace to remove).
 */

export type ListKind = 'bullet' | 'number';

/** Spaces per nesting level. */
export const LIST_INDENT = 4;
const BULLETS = ['•', '◦', '▪'];

/** A splice of the plain text: replace `remove` characters at `at` with `insert`. */
export interface TextEdit {
   at: number;
   remove: number;
   insert: string;
}

/** New runs plus a function mapping an old character offset to its new offset. */
export interface ListResult {
   runs: TextRun[];
   map: (offset: number) => number;
}

export interface ListLine {
   /** Offset of the first character of the line. */
   start: number;
   /** Offset just past the last character (before the newline). */
   end: number;
   /** Leading spaces. */
   indent: number;
   kind: ListKind | null;
   /** For a numbered item, its current number. */
   number: number;
   /** Offset just past the marker and its space (== start + indent for plain lines). */
   markerEnd: number;
}

const MARKER = /^( *)(?:([•◦▪])|(\d+)\.) /;

export function parseLines(text: string): ListLine[] {
   const lines: ListLine[] = [];
   let start = 0;
   for (;;) {
      const nl = text.indexOf('\n', start);
      const end = nl === -1 ? text.length : nl;
      const raw = text.slice(start, end);
      const m = MARKER.exec(raw);
      if (m) {
         lines.push({
            start,
            end,
            indent: m[1].length,
            kind: m[2] ? 'bullet' : 'number',
            number: m[3] ? Number.parseInt(m[3], 10) : 0,
            markerEnd: start + m[0].length,
         });
      } else {
         const indent = /^ */.exec(raw)?.[0].length ?? 0;
         lines.push({ start, end, indent, kind: null, number: 0, markerEnd: start + indent });
      }
      if (nl === -1) {
         return lines;
      }
      start = nl + 1;
   }
}

const levelOf = (indent: number): number => Math.floor(indent / LIST_INDENT);

function markerText(kind: ListKind, indent: number, n: number): string {
   return kind === 'bullet' ? `${BULLETS[levelOf(indent) % BULLETS.length]} ` : `${n}. `;
}

function lineAt(lines: readonly ListLine[], offset: number): ListLine {
   return lines.find((l) => offset >= l.start && offset <= l.end) ?? lines[lines.length - 1];
}

/** The lines a selection touches (a selection ending at a line start excludes that line). */
function selectedLines(lines: readonly ListLine[], start: number, end: number): ListLine[] {
   if (start === end) {
      return [lineAt(lines, start)];
   }
   const picked = lines.filter((l) => l.start <= end && l.end >= start && !(l.start === end));
   return picked.length ? picked : [lineAt(lines, start)];
}

const isBlank = (text: string, l: ListLine): boolean => l.kind === null && text.slice(l.start, l.end).trim() === '';

/** Lines a list command applies to: blank lines are skipped when several are selected. */
function targetLines(text: string, start: number, end: number): ListLine[] {
   const sel = selectedLines(parseLines(text), start, end);
   const filled = sel.filter((l) => !isBlank(text, l));
   return sel.length > 1 && filled.length ? filled : sel;
}

/** The list kind shared by every target line, or null when plain or mixed. */
export function listKindOver(text: string, start: number, end: number): ListKind | null {
   const lines = targetLines(text, Math.min(start, end), Math.max(start, end));
   const first = lines[0]?.kind ?? null;
   return first && lines.every((l) => l.kind === first) ? first : null;
}

/** Apply splices to runs. Inserted characters take the style of the character they precede. */
function applyEdits(runs: readonly TextRun[], edits: readonly TextEdit[]): ListResult {
   const sorted = [...edits].sort((a, b) => a.at - b.at);
   type Char = { ch: string; style: Omit<TextRun, 'text'> };
   const chars: Char[] = [];
   for (const run of runs) {
      const { text, ...style } = run;
      for (let i = 0; i < text.length; i++) {
         chars.push({ ch: text[i], style });
      }
   }
   const out: Char[] = [];
   let pos = 0;
   for (const e of sorted) {
      for (; pos < e.at && pos < chars.length; pos++) {
         out.push(chars[pos]);
      }
      const src = chars[e.at] ?? chars[e.at - 1];
      // A marker is not a tagged word.
      const { morph: _morph, ...style } = src?.style ?? {};
      for (let i = 0; i < e.insert.length; i++) {
         out.push({ ch: e.insert[i], style });
      }
      pos = Math.max(pos, e.at + e.remove);
   }
   for (; pos < chars.length; pos++) {
      out.push(chars[pos]);
   }
   const map = (p: number): number => {
      let delta = 0;
      for (const e of sorted) {
         if (p < e.at) {
            break;
         }
         if (p < e.at + e.remove) {
            return e.at + delta + e.insert.length;
         }
         delta += e.insert.length - e.remove;
      }
      return p + delta;
   };
   return { runs: normalizeRuns(out.map((c) => ({ text: c.ch, ...c.style }))), map };
}

/** Edits that make every list line's marker correct: sequential numbers, level-matched bullets. */
function normalizeEdits(text: string): TextEdit[] {
   const edits: TextEdit[] = [];
   const counters = new Map<number, number>();
   for (const l of parseLines(text)) {
      if (!l.kind) {
         counters.clear();
         continue;
      }
      for (const k of [...counters.keys()]) {
         if (k > l.indent) {
            counters.delete(k);
         }
      }
      const markerStart = l.start + l.indent;
      const current = text.slice(markerStart, l.markerEnd - 1);
      let want: string;
      if (l.kind === 'bullet') {
         counters.delete(l.indent);
         want = BULLETS[levelOf(l.indent) % BULLETS.length];
      } else {
         const n = (counters.get(l.indent) ?? 0) + 1;
         counters.set(l.indent, n);
         want = `${n}.`;
      }
      if (current !== want) {
         edits.push({ at: markerStart, remove: current.length, insert: want });
      }
   }
   return edits;
}

function compose(a: ListResult, b: ListResult): ListResult {
   return { runs: b.runs, map: (p) => b.map(a.map(p)) };
}

/** Apply edits, then tidy numbering/bullets. */
function applyAndNormalize(runs: readonly TextRun[], edits: readonly TextEdit[]): ListResult {
   const first = applyEdits(runs, edits);
   const fix = normalizeEdits(plainOf(first.runs));
   return fix.length ? compose(first, applyEdits(first.runs, fix)) : first;
}

/**
 * Runs with list numbering/bullets corrected (e.g. after a line was deleted or
 * pasted), or null when they are already right.
 */
export function normalizeLists(runs: readonly TextRun[]): ListResult | null {
   const text = plainOf(runs);
   if (!/[•◦▪]|\d\./.test(text)) {
      return null;
   }
   const fix = normalizeEdits(text);
   return fix.length ? applyEdits(runs, fix) : null;
}

/** Toggle a list kind on the selected lines (off when they all already have it). */
export function toggleList(runs: readonly TextRun[], start: number, end: number, kind: ListKind): ListResult {
   const text = plainOf(runs);
   const lines = targetLines(text, Math.min(start, end), Math.max(start, end));
   const allOn = lines.every((l) => l.kind === kind);
   const edits: TextEdit[] = [];
   for (const l of lines) {
      const markerStart = l.start + l.indent;
      if (allOn) {
         edits.push({ at: l.start, remove: l.markerEnd - l.start, insert: '' });
      } else if (l.kind) {
         edits.push({
            at: markerStart,
            remove: l.markerEnd - markerStart,
            insert: markerText(kind, l.indent, 1),
         });
      } else {
         edits.push({ at: markerStart, remove: 0, insert: markerText(kind, l.indent, 1) });
      }
   }
   return applyAndNormalize(runs, edits);
}

/** Indent (+1) or outdent (-1) the list lines in the selection; null when none is a list line. */
export function shiftListIndent(runs: readonly TextRun[], start: number, end: number, dir: 1 | -1): ListResult | null {
   const text = plainOf(runs);
   const lines = selectedLines(parseLines(text), Math.min(start, end), Math.max(start, end)).filter((l) => l.kind);
   if (!lines.length) {
      return null;
   }
   const edits: TextEdit[] = [];
   for (const l of lines) {
      if (dir > 0) {
         edits.push({ at: l.start, remove: 0, insert: ' '.repeat(LIST_INDENT) });
      } else if (l.indent > 0) {
         edits.push({ at: l.start, remove: Math.min(l.indent, LIST_INDENT), insert: '' });
      }
   }
   return edits.length ? applyAndNormalize(runs, edits) : null;
}

/**
 * Enter at `caret`. `insert` is the text to add at the caret to start the next
 * item; `exit` ends the list (an empty item outdents, then loses its marker).
 * Null when the caret is not in a list item's content (default Enter applies).
 */
export function listEnter(runs: readonly TextRun[], caret: number): { insert: string } | { exit: ListResult } | null {
   const text = plainOf(runs);
   const line = lineAt(parseLines(text), caret);
   if (!line.kind || caret < line.markerEnd) {
      return null;
   }
   if (text.slice(line.markerEnd, line.end).trim() === '') {
      const edit: TextEdit =
         line.indent > 0
            ? { at: line.start, remove: Math.min(line.indent, LIST_INDENT), insert: '' }
            : { at: line.start, remove: line.markerEnd - line.start, insert: '' };
      return { exit: applyAndNormalize(runs, [edit]) };
   }
   const prefix = ' '.repeat(line.indent) + markerText(line.kind, line.indent, line.number + 1);
   return { insert: `\n${prefix}` };
}

/** Backspace right after a marker: outdent, or drop the marker at the top level. */
export function listBackspace(runs: readonly TextRun[], caret: number): ListResult | null {
   const text = plainOf(runs);
   const line = lineAt(parseLines(text), caret);
   if (!line.kind || caret !== line.markerEnd) {
      return null;
   }
   const edit: TextEdit =
      line.indent > 0
         ? { at: line.start, remove: Math.min(line.indent, LIST_INDENT), insert: '' }
         : { at: line.start, remove: line.markerEnd - line.start, insert: '' };
   return applyAndNormalize(runs, [edit]);
}

/** Typing a space after "-", "*" or "1." at a line start turns the line into a list item. */
export function listAutoformat(runs: readonly TextRun[], caret: number): ListResult | null {
   const text = plainOf(runs);
   const line = lineAt(parseLines(text), caret);
   if (line.kind) {
      return null;
   }
   const m = /^( *)(-|\*|\d+\.)$/.exec(text.slice(line.start, caret));
   if (!m) {
      return null;
   }
   const kind: ListKind = /\d/.test(m[2]) ? 'number' : 'bullet';
   const edit: TextEdit = {
      at: line.start + m[1].length,
      remove: m[2].length,
      insert: markerText(kind, m[1].length, Number.parseInt(m[2], 10) || 1),
   };
   return applyAndNormalize(runs, [edit]);
}
