/**
 * Pure text operations behind the code editor's VS Code-style shortcuts: line
 * duplicate / move, smart Home, Ctrl+D next-occurrence, and multi-cursor edits.
 * Everything works on a string plus selections (character offsets) and returns the
 * new string and selections; the caller writes them back to the textarea.
 */

/** One cursor: `anchor` stays put while extending, `head` is where the caret is. */
export interface CodeSel {
   anchor: number;
   head: number;
}

export interface CodeEditResult {
   value: string;
   sels: CodeSel[];
}

export const selMin = (s: CodeSel): number => Math.min(s.anchor, s.head);
export const selMax = (s: CodeSel): number => Math.max(s.anchor, s.head);
export const caret = (at: number): CodeSel => ({ anchor: at, head: at });

export function lineStart(value: string, at: number): number {
   return value.lastIndexOf('\n', at - 1) + 1;
}

export function lineEnd(value: string, at: number): number {
   const nl = value.indexOf('\n', at);
   return nl < 0 ? value.length : nl;
}

/** Sort by position and merge cursors that touch or overlap (the primary, last, survives). */
export function normalizeSels(sels: readonly CodeSel[]): CodeSel[] {
   if (sels.length < 2) {
      return [...sels];
   }
   const primary = sels[sels.length - 1];
   const sorted = [...sels].sort((a, b) => selMin(a) - selMin(b) || selMax(a) - selMax(b));
   const out: { sel: CodeSel; primary: boolean }[] = [];
   for (const s of sorted) {
      const prev = out[out.length - 1];
      const same = prev && selMin(s) === selMin(prev.sel) && selMax(s) === selMax(prev.sel);
      if (prev && (same || selMin(s) < selMax(prev.sel))) {
         const from = selMin(prev.sel);
         const to = Math.max(selMax(prev.sel), selMax(s));
         const backward = prev.sel.head < prev.sel.anchor;
         prev.sel = backward ? { anchor: to, head: from } : { anchor: from, head: to };
         prev.primary ||= s === primary;
         continue;
      }
      out.push({ sel: { anchor: s.anchor, head: s.head }, primary: s === primary });
   }
   // Keep the primary last so it stays the textarea's native selection.
   const pi = out.findIndex((o) => o.primary);
   const clean = out.map((o) => o.sel);
   if (pi >= 0) {
      clean.push(clean.splice(pi, 1)[0]);
   }
   return clean;
}

/** One replacement per cursor: [from, to) becomes `insert`, then the cursor is set relative to `from`. */
interface Change {
   from: number;
   to: number;
   insert: string;
   anchor: number;
   head: number;
}

/** Apply per-cursor changes together (offsets refer to the original value). */
function applyChanges(value: string, sels: readonly CodeSel[], make: (s: CodeSel) => Change): CodeEditResult {
   const order = sels.map((s, i) => ({ c: make(s), i })).sort((a, b) => a.c.from - b.c.from);
   let out = '';
   let pos = 0;
   let delta = 0;
   const next: CodeSel[] = new Array(sels.length);
   for (const { c, i } of order) {
      const from = Math.max(c.from, pos);
      const to = Math.max(c.to, from);
      out += value.slice(pos, from) + c.insert;
      const base = from + delta;
      next[i] = { anchor: base + c.anchor, head: base + c.head };
      delta += c.insert.length - (to - from);
      pos = to;
   }
   out += value.slice(pos);
   return { value: out, sels: normalizeSels(next) };
}

/** Type (or paste) `text` at every cursor; `perCursor` gives each its own text (multi-line paste). */
export function insertAt(value: string, sels: readonly CodeSel[], text: string | string[]): CodeEditResult {
   const order = [...sels].sort((a, b) => selMin(a) - selMin(b));
   return applyChanges(value, sels, (s) => {
      const t = Array.isArray(text) ? text[order.indexOf(s)] ?? '' : text;
      return { from: selMin(s), to: selMax(s), insert: t, anchor: t.length, head: t.length };
   });
}

/** Enter at every cursor, keeping the line's indent (+1 level after an opening bracket). */
export function newlineAt(value: string, sels: readonly CodeSel[], indent: string): CodeEditResult {
   return applyChanges(value, sels, (s) => {
      const from = selMin(s);
      const ls = lineStart(value, from);
      const lead = /^[ \t]*/.exec(value.slice(ls, from))?.[0] ?? '';
      const opens = /[{[(]$/.test(value.slice(ls, from).trimEnd());
      const t = `\n${lead}${opens ? indent : ''}`;
      return { from, to: selMax(s), insert: t, anchor: t.length, head: t.length };
   });
}

/** Backspace (`dir` -1) or Delete (+1) at every cursor; Ctrl deletes a word. */
export function deleteAt(value: string, sels: readonly CodeSel[], dir: -1 | 1, word = false): CodeEditResult {
   return applyChanges(value, sels, (s) => {
      let from = selMin(s);
      let to = selMax(s);
      if (from === to) {
         if (dir < 0) from = word ? wordBoundary(value, from, -1) : Math.max(0, from - 1);
         else to = word ? wordBoundary(value, to, 1) : Math.min(value.length, to + 1);
      }
      return { from, to, insert: '', anchor: 0, head: 0 };
   });
}

/** Where Ctrl+Left / Ctrl+Right lands from `at`. */
export function wordBoundary(value: string, at: number, dir: -1 | 1): number {
   let i = at;
   const isWord = (ch: string | undefined): boolean => !!ch && /\w/.test(ch);
   if (dir < 0) {
      while (i > 0 && /[ \t]/.test(value[i - 1])) i--;
      if (i > 0 && value[i - 1] === '\n') return i - 1;
      const w = isWord(value[i - 1]);
      while (i > 0 && value[i - 1] !== '\n' && !/[ \t]/.test(value[i - 1]) && isWord(value[i - 1]) === w) i--;
      return i;
   }
   while (i < value.length && /[ \t]/.test(value[i])) i++;
   if (i < value.length && value[i] === '\n') return i + 1;
   const w = isWord(value[i]);
   while (i < value.length && value[i] !== '\n' && !/[ \t]/.test(value[i]) && isWord(value[i]) === w) i++;
   return i;
}

/** Smart Home: the first non-blank of the line, or the line start when already there. */
export function smartHome(value: string, at: number): number {
   const ls = lineStart(value, at);
   const first = ls + (/^[ \t]*/.exec(value.slice(ls, lineEnd(value, ls)))?.[0].length ?? 0);
   return at === first ? ls : first;
}

export type CaretMove = 'left' | 'right' | 'up' | 'down' | 'home' | 'end' | 'wordLeft' | 'wordRight' | 'docStart' | 'docEnd';

/** Move (or with `extend`, extend) every cursor. `goal` keeps up/down columns across short lines. */
export function moveCarets(value: string, sels: readonly CodeSel[], move: CaretMove, extend: boolean): CodeSel[] {
   return normalizeSels(
      sels.map((s) => {
         const empty = s.anchor === s.head;
         let h = s.head;
         switch (move) {
            case 'left':
               h = !extend && !empty ? selMin(s) : Math.max(0, h - 1);
               break;
            case 'right':
               h = !extend && !empty ? selMax(s) : Math.min(value.length, h + 1);
               break;
            case 'up':
            case 'down': {
               const ls = lineStart(value, h);
               const col = h - ls;
               if (move === 'up') {
                  if (ls === 0) h = 0;
                  else {
                     const pls = lineStart(value, ls - 1);
                     h = Math.min(pls + col, ls - 1);
                  }
               } else {
                  const le = lineEnd(value, h);
                  if (le >= value.length) h = value.length;
                  else h = Math.min(le + 1 + col, lineEnd(value, le + 1));
               }
               break;
            }
            case 'home':
               h = smartHome(value, h);
               break;
            case 'end':
               h = lineEnd(value, h);
               break;
            case 'wordLeft':
               h = wordBoundary(value, h, -1);
               break;
            case 'wordRight':
               h = wordBoundary(value, h, 1);
               break;
            case 'docStart':
               h = 0;
               break;
            case 'docEnd':
               h = value.length;
               break;
         }
         return extend ? { anchor: s.anchor, head: h } : caret(h);
      }),
   );
}

/** Line blocks (start of first line .. end of last line) the cursors touch, merged. */
function lineBlocks(value: string, sels: readonly CodeSel[]): { from: number; to: number }[] {
   const blocks = sels
      .map((s) => {
         const a = selMin(s);
         let b = selMax(s);
         // A selection ending at a line's very start does not include that line.
         if (b > a && value[b - 1] === '\n') b--;
         return { from: lineStart(value, a), to: lineEnd(value, b) };
      })
      .sort((x, y) => x.from - y.from);
   const out: { from: number; to: number }[] = [];
   for (const b of blocks) {
      const prev = out[out.length - 1];
      if (prev && b.from <= prev.to + 1) prev.to = Math.max(prev.to, b.to);
      else out.push({ ...b });
   }
   return out;
}

/** Alt+Up/Down: copy the touched lines above (`up`) or below, cursors ending on the copy below/above. */
export function duplicateLines(value: string, sels: readonly CodeSel[], up: boolean): CodeEditResult {
   const blocks = lineBlocks(value, sels);
   let out = value;
   const shifted = sels.map((s) => ({ ...s }));
   // Back to front so earlier offsets stay valid.
   for (let bi = blocks.length - 1; bi >= 0; bi--) {
      const { from, to } = blocks[bi];
      const text = value.slice(from, to);
      out = out.slice(0, to) + '\n' + text + out.slice(to);
      const add = text.length + 1;
      for (const s of shifted) {
         const inBlock = selMin(s) >= from && selMax(s) <= to + 1;
         // Down: cursors move with the copy below. Up: cursors stay on the original (now the top copy).
         if (selMin(s) > to || (!up && inBlock)) {
            s.anchor += add;
            s.head += add;
         }
      }
   }
   return { value: out, sels: normalizeSels(shifted) };
}

/** Shift+Up/Down: swap the touched lines with the line above / below. */
export function moveLines(value: string, sels: readonly CodeSel[], up: boolean): CodeEditResult | null {
   const blocks = lineBlocks(value, sels);
   if (up ? blocks[0].from === 0 : blocks[blocks.length - 1].to >= value.length) {
      return null;
   }
   let out = value;
   const shifted = sels.map((s) => ({ ...s }));
   const ordered = up ? blocks : [...blocks].reverse();
   for (const { from, to } of ordered) {
      // Offsets in `out` match `value` for these blocks: earlier moves only swap within their own span.
      const text = out.slice(from, to);
      if (up) {
         const pls = lineStart(out, from - 1);
         const prev = out.slice(pls, from - 1);
         out = out.slice(0, pls) + text + '\n' + prev + out.slice(to);
         const d = from - pls;
         for (const s of shifted) {
            if (selMin(s) >= from && selMax(s) <= to + 1) {
               s.anchor -= d;
               s.head -= d;
            }
         }
      } else {
         const nle = lineEnd(out, to + 1);
         const nextLine = out.slice(to + 1, nle);
         out = out.slice(0, from) + nextLine + '\n' + text + out.slice(nle);
         const d = nextLine.length + 1;
         for (const s of shifted) {
            if (selMin(s) >= from && selMax(s) <= to + 1) {
               s.anchor += d;
               s.head += d;
            }
         }
      }
   }
   return { value: out, sels: normalizeSels(shifted) };
}

/** The word around `at` (for Ctrl+D on an empty cursor). */
export function wordAt(value: string, at: number): { from: number; to: number } | null {
   let from = at;
   let to = at;
   while (from > 0 && /\w/.test(value[from - 1])) from--;
   while (to < value.length && /\w/.test(value[to])) to++;
   return from === to ? null : { from, to };
}

/**
 * Ctrl+D: an empty primary cursor selects its word; otherwise the next occurrence of
 * the primary's text (after the last cursor, wrapping) becomes a new cursor.
 */
export function selectNextOccurrence(value: string, sels: readonly CodeSel[], wholeWord = false): CodeSel[] {
   const primary = sels[sels.length - 1];
   if (primary.anchor === primary.head) {
      const w = wordAt(value, primary.head);
      if (!w) return [...sels];
      return normalizeSels([...sels.slice(0, -1), { anchor: w.from, head: w.to }]);
   }
   const needle = value.slice(selMin(primary), selMax(primary));
   const taken = new Set(sels.map((s) => selMin(s)));
   const ok = (at: number): boolean =>
      !taken.has(at) && (!wholeWord || (!/\w/.test(value[at - 1] ?? '') && !/\w/.test(value[at + needle.length] ?? '')));
   const find = (from: number, until = value.length): number => {
      for (let at = value.indexOf(needle, from); at >= 0 && at < until; at = value.indexOf(needle, at + 1)) {
         if (ok(at)) return at;
      }
      return -1;
   };
   const after = Math.max(...sels.map(selMax));
   let i = find(after);
   if (i < 0) i = find(0, after);
   if (i < 0) return [...sels];
   return normalizeSels([...sels, { anchor: i, head: i + needle.length }]);
}

/** Offset of (line, col) clamped to the text; `col` in characters. */
export function offsetAt(value: string, line: number, col: number): number {
   let ls = 0;
   for (let l = 0; l < line; l++) {
      const nl = value.indexOf('\n', ls);
      if (nl < 0) return value.length;
      ls = nl + 1;
   }
   return Math.min(ls + Math.max(0, col), lineEnd(value, ls));
}

/** Alt+Shift or Ctrl+Shift drag: one selection per line between the two points (same columns). */
export function columnSelection(
   value: string,
   a: { line: number; col: number },
   b: { line: number; col: number },
): CodeSel[] {
   const sels: CodeSel[] = [];
   const step = b.line >= a.line ? 1 : -1;
   for (let l = a.line; ; l += step) {
      sels.push({ anchor: offsetAt(value, l, a.col), head: offsetAt(value, l, b.col) });
      if (l === b.line) break;
   }
   return normalizeSels(sels);
}
