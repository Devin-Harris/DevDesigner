import { type TextRun } from '@devdesigner/shared';
import { fitTextElement } from '../../../helpers/text-metrics';
import { type RunPatch, isPlainRuns, patchRuns, plainOf, runsOrPlain } from '../../../helpers/rich-text.helper';
import {
   type ListKind,
   type ListResult,
   listAutoformat,
   listBackspace,
   listEnter,
   normalizeLists,
   parseLines,
   focusAcrossMarker,
   outsideMarker,
   shiftListIndent,
   stripListMarkers,
   toggleList,
} from '../helpers/rich-list.helper';
import { PAIRS, type PairEdit, autoPairKey, inEmptyPair } from '../helpers/auto-pair.helper';
import type { TextEditingService } from './text-editing.service';

/** Rich text input, keys, lists and editor setup for the text editor. */
export class RichTextInput {
   constructor(private readonly host: TextEditingService) {}

   /** Show a list edit's runs in the editor, keeping the (remapped) selection. */
   commitListResult(root: HTMLElement, res: ListResult): void {
      const { start, end } = this.host.richSel;
      const total = plainOf(res.runs).length;
      this.host.renderRichRuns(root, res.runs);
      root.focus();
      this.host.setRichSelection(root, Math.min(res.map(start), total), Math.min(res.map(end), total));
      this.host.captureRichSelection(root);
      this.syncRichModel(res.runs);
      this.host.publishRichSelection(res.runs);
   }

   /** Toolbar / shortcut: toggle a bulleted or numbered list on the selected lines. */
   toggleRichList(kind: ListKind): void {
      const root = this.host.host.richEditorRef()?.nativeElement;
      if (!root) {
         return;
      }
      this.host.captureRichSelection(root);
      const { start, end } = this.host.richSel;
      this.commitListResult(root, toggleList(this.host.readRichRuns(root), start, end, kind));
   }

   /** Push the editor's runs into the store (live) with the refit box. */
   syncRichModel(runs: TextRun[]): void {
      const id = this.host.editingTextId$();
      const el = id ? this.host.store.elements().find((e) => e.id === id) : null;
      if (!id || !el) {
         return;
      }
      const text = plainOf(runs);
      const stored = isPlainRuns(runs) ? undefined : runs;
      if (el.type !== 'text') {
         // A shape label: the shape keeps its size.
         this.host.store.patchElementLocal(id, { text, runs: stored });
         return;
      }
      const size = fitTextElement(el, { text, runs: stored ?? null });
      this.host.store.patchElementLocal(id, { text, runs: stored, width: size.width, height: size.height });
   }

   onRichInput(event?: Event): void {
      const root = this.host.host.richEditorRef()?.nativeElement;
      if (!root) {
         return;
      }
      const runs = this.host.readRichRuns(root);
      this.host.captureRichSelection(root);
      // Keep list numbering/bullets right after deletes and pastes (not mid-composition).
      const fixed = (event as InputEvent | undefined)?.isComposing ? null : normalizeLists(runs);
      if (fixed) {
         this.commitListResult(root, fixed);
         return;
      }
      if (
         !this.host.richHoldLayout &&
         !(event as InputEvent | undefined)?.isComposing &&
         this.host.richListLayoutStale(root, runs)
      ) {
         this.commitListResult(root, { runs, map: (p) => p });
         return;
      }
      this.syncRichModel(runs);
      this.host.captureRichSelection(root);
      this.host.publishRichSelection(runs);
   }

   /**
    * Run native edits that add a line break, then rebuild the list blocks once with
    * the caret `inserted` characters past the old selection start (the DOM caret
    * right after a <br> is unreliable to read back).
    */
   richLineBreak(root: HTMLElement, edit: () => void, inserted: number): void {
      this.host.captureRichSelection(root);
      const caret = Math.min(this.host.richSel.start, this.host.richSel.end) + inserted;
      this.host.richHoldLayout = true;
      try {
         edit();
      } finally {
         this.host.richHoldLayout = false;
      }
      const runs = this.host.readRichRuns(root);
      if (this.host.richListLayoutStale(root, runs)) {
         this.host.richSel = { start: caret, end: caret };
         this.commitListResult(root, { runs, map: (p) => p });
      }
   }

   /** Style the selected characters, or the whole block when nothing is selected. */
   applyRichPatch(patch: RunPatch): void {
      const root = this.host.host.richEditorRef()?.nativeElement;
      if (!root) {
         return;
      }
      const runs = this.host.readRichRuns(root);
      const total = plainOf(runs).length;
      const { start, end } = this.host.richSel;
      const from = start === end ? 0 : Math.min(start, end);
      const to = start === end ? total : Math.max(start, end);
      const next = patchRuns(runs, from, to, patch);
      this.host.renderRichRuns(root, next);
      root.focus();
      this.host.setRichSelection(root, Math.min(start, total), Math.min(end, total));
      this.syncRichModel(next);
      this.host.publishRichSelection(next);
   }

   /** Type text at the remembered caret (a field token from the toolbar), as if typed. */
   insertRichText(text: string): void {
      const root = this.host.host.richEditorRef()?.nativeElement;
      if (!root) {
         return;
      }
      root.focus();
      const { start, end } = this.host.richSel;
      this.host.setRichSelection(root, Math.min(start, end), Math.max(start, end));
      // execCommand fires the editor's own input handling (and keeps native undo).
      document.execCommand('insertText', false, text);
   }

   initRichEditor(root: HTMLDivElement): void {
      const id = this.host.editingTextId$();
      const el = id ? this.host.store.elements().find((e) => e.id === id) : null;
      if (
         !id ||
         !el ||
         (el.type !== 'text' && el.type !== 'rectangle' && el.type !== 'ellipse' && el.type !== 'diamond' && el.type !== 'triangle')
      ) {
         return;
      }
      const text = el.text ?? '';
      this.host.renderRichRuns(root, runsOrPlain(text, el.runs));
      root.focus();
      this.host.setRichSelection(root, text.length, text.length);
      this.host.richSel = { start: text.length, end: text.length };
      // Opened by a double-click: select the word under it (typing replaces it), or put the caret there.
      const at = this.host.editClickPoint;
      this.host.editClickPoint = null;
      if (at && text) {
         const word = this.wordAtPoint(root, text, at.x, at.y);
         if (word) {
            this.host.setRichSelection(root, word.start, word.end);
            this.host.richSel = word;
         }
      }
      this.host.richSession.open(
         id,
         (patch) => this.applyRichPatch(patch),
         (kind) => this.toggleRichList(kind),
         (text) => this.insertRichText(text)
      );
      this.host.publishRichSelection();

      const onSelection = (): void => {
         if (document.activeElement === root) {
            this.host.clampRichCaret(root);
            this.host.clampRichRange(root);
            this.host.captureRichSelection(root);
            this.host.publishRichSelection();
         }
      };
      // Toolbar buttons and their menus must not steal focus (and so the selection)
      // from the editor; sliders and text fields still need it.
      const onMouseDown = (e: MouseEvent): void => {
         const t = e.target as Element | null;
         if (
            t?.closest('dd-element-floating-toolbar, .cdk-overlay-pane, .dd-overlay-backdrop') &&
            !t.closest('input[type=range], input[type=text], input[type=number], textarea')
         ) {
            e.preventDefault();
         }
      };
      document.addEventListener('selectionchange', onSelection);
      document.addEventListener('mousedown', onMouseDown, true);
      this.host.richCleanup = () => {
         document.removeEventListener('selectionchange', onSelection);
         document.removeEventListener('mousedown', onMouseDown, true);
      };
   }

   /** The word (plain-text offsets) under a screen point in the rich editor, or a caret there when it is not on a word. */
   wordAtPoint(root: HTMLElement, text: string, x: number, y: number): { start: number; end: number } | null {
      const doc = document as Document & {
         caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      };
      let node: Node | null = null;
      let offset = 0;
      const pos = doc.caretPositionFromPoint?.(x, y);
      if (pos) {
         node = pos.offsetNode;
         offset = pos.offset;
      } else {
         const r = document.caretRangeFromPoint?.(x, y);
         if (r) {
            node = r.startContainer;
            offset = r.startOffset;
         }
      }
      if (!node || !root.contains(node)) return null;
      const i = this.host.richOffset(root, node, offset);
      const isWord = (c: string | undefined): boolean => !!c && /[\p{L}\p{N}_'’-]/u.test(c);
      // The caret may sit just after the word (clicked on its right half of the last letter).
      let start = isWord(text[i]) ? i : isWord(text[i - 1]) ? i - 1 : -1;
      // Not on a word (spaces, past a line's end): put the caret where the click landed.
      if (start < 0) return { start: i, end: i };
      let end = start;
      while (start > 0 && isWord(text[start - 1])) start -= 1;
      while (end < text.length && isWord(text[end])) end += 1;
      return { start, end };
   }

   teardownRichEditor(): void {
      this.host.richCleanup?.();
      this.host.richCleanup = null;
      this.host.richInitFor = null;
      this.host.richSession.close();
   }

   onRichKeydown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
         event.preventDefault();
         (event.target as HTMLElement).blur();
         return;
      }
      const root = this.host.host.richEditorRef()?.nativeElement;
      if (root && !event.isComposing) this.host.clampRichCaret(root);
      if (root && !event.isComposing && this.onRichHome(event, root)) {
         return;
      }
      if (root && !event.isComposing && this.onRichArrowAcrossMarker(event, root)) {
         return;
      }
      if (root && !event.isComposing && this.onRichShiftArrowAcrossMarker(event, root)) {
         return;
      }
      // The caret moves after this event; the selectionchange that follows reads the flag.
      this.host.arrowLeftHeld = event.key === 'ArrowLeft' && !event.shiftKey;
      if (this.host.arrowLeftHeld) setTimeout(() => (this.host.arrowLeftHeld = false), 50);
      if (root && !event.isComposing && this.onRichPairKey(event, root)) {
         return;
      }
      if (root && !event.isComposing && this.onRichListKey(event, root)) {
         return;
      }
      if (event.key === 'Enter' && !event.isComposing) {
         // A plain line break keeps the content flat (no nested block elements).
         event.preventDefault();
         if (root) {
            this.richLineBreak(root, () => document.execCommand('insertLineBreak'), 1);
         } else {
            document.execCommand('insertLineBreak');
         }
         return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
         const key = event.key.toLowerCase();
         const flag = key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'u' ? 'underline' : null;
         if (flag) {
            event.preventDefault();
            const current = this.host.richSession.selection();
            this.applyRichPatch({ [flag]: !(current?.[flag] ?? false) });
         }
      }
   }

   /**
    * ArrowLeft/Right across a bullet: jump straight between an item's first character
    * and the previous line's end (and back), so the caret never paints inside the
    * marker first. True when handled.
    */
   onRichArrowAcrossMarker(event: KeyboardEvent, root: HTMLElement): boolean {
      if (
         (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') ||
         event.shiftKey ||
         event.altKey
      ) {
         return false;
      }
      if (event.ctrlKey || event.metaKey) return this.onRichWordArrow(event, root);
      this.host.captureRichSelection(root);
      const { start, end } = this.host.richSel;
      if (start !== end) return false;
      const lines = parseLines(plainOf(this.host.readRichRuns(root)));
      const i = lines.findIndex((l) => start >= l.start && start <= l.end);
      if (i < 0) return false;
      let target: number | null = null;
      if (event.key === 'ArrowLeft' && lines[i].kind && start === lines[i].markerEnd) {
         target = i > 0 ? lines[i - 1].end : start;
      } else if (event.key === 'ArrowRight' && start === lines[i].end && lines[i + 1]?.kind) {
         target = lines[i + 1].markerEnd;
      }
      if (target === null) return false;
      event.preventDefault();
      this.host.setRichSelection(root, target, target);
      this.host.richSel = { start: target, end: target };
      this.host.lastCaret = (() => {
         const s = window.getSelection();
         return s?.anchorNode ? { node: s.anchorNode, offset: s.anchorOffset } : null;
      })();
      return true;
   }

   /** Bracket/quote auto-pairing (and Backspace in an empty pair). True when handled. */
   onRichPairKey(event: KeyboardEvent, root: HTMLElement): boolean {
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      const isBackspace = event.key === 'Backspace';
      if (!isBackspace && event.key.length !== 1) return false;
      this.host.captureRichSelection(root);
      const start = Math.min(this.host.richSel.start, this.host.richSel.end);
      const end = Math.max(this.host.richSel.start, this.host.richSel.end);
      const text = plainOf(this.host.readRichRuns(root));
      const edit: PairEdit | null = isBackspace
         ? start === end && inEmptyPair(text, start)
            ? { from: start - 1, to: start + 1, insert: '', selStart: start - 1, selEnd: start - 1 }
            : null
         : autoPairKey(text, start, end, event.key);
      if (!edit) return false;
      event.preventDefault();
      const type = (from: number, to: number, value: string): void => {
         this.host.setRichSelection(root, from, to);
         document.execCommand(value ? 'insertText' : 'delete', false, value);
      };
      if (start !== end && !isBackspace) {
         // Wrap: closer first, then opener, so the selected text keeps its styling.
         type(end, end, PAIRS[event.key]);
         type(start, start, event.key);
      } else if (edit.insert || edit.from !== edit.to) {
         type(edit.from, edit.to, edit.insert);
      }
      this.host.setRichSelection(root, edit.selStart, edit.selEnd);
      this.host.captureRichSelection(root);
      this.host.publishRichSelection();
      return true;
   }

   /**
    * Shift+Arrow/Home/End: extend the selection ourselves (Selection.modify) and keep
    * its ends out of list markers before the browser paints, so the selection never
    * flashes inside a bullet. True when handled.
    */
   onRichShiftArrowAcrossMarker(event: KeyboardEvent, root: HTMLElement): boolean {
      if (!event.shiftKey || event.altKey) return false;
      const mod = event.ctrlKey || event.metaKey;
      const moves: Record<string, [-1 | 1, string]> = {
         ArrowLeft: [-1, mod ? 'word' : 'character'],
         ArrowRight: [1, mod ? 'word' : 'character'],
         ArrowUp: [-1, 'line'],
         ArrowDown: [1, 'line'],
         Home: [-1, mod ? 'documentboundary' : 'lineboundary'],
         End: [1, mod ? 'documentboundary' : 'lineboundary'],
      };
      const move = moves[event.key];
      const sel = window.getSelection() as (Selection & { modify?: (a: string, d: string, g: string) => void }) | null;
      if (!move || !sel?.modify) return false;
      const at = this.host.richAnchorFocus(root);
      if (!at) return false;
      const [dir, unit] = move;
      const text = plainOf(this.host.readRichRuns(root));
      event.preventDefault();
      let focus = unit === 'character' ? focusAcrossMarker(text, at.focus, dir) : null;
      if (focus === null) {
         sel.modify('extend', dir < 0 ? 'backward' : 'forward', unit);
         focus = this.host.richAnchorFocus(root)?.focus ?? at.focus;
      }
      this.host.setRichSelection(root, outsideMarker(text, at.anchor), outsideMarker(text, focus));
      this.host.captureRichSelection(root);
      this.host.publishRichSelection();
      return true;
   }

   /**
    * Ctrl+ArrowLeft/Right: move by word ourselves and keep the caret out of list markers
    * before the browser paints (from an item's start, Ctrl+Left goes to the line above).
    */
   onRichWordArrow(event: KeyboardEvent, root: HTMLElement): boolean {
      const sel = window.getSelection() as (Selection & { modify?: (a: string, d: string, g: string) => void }) | null;
      const at = this.host.richAnchorFocus(root);
      if (!sel?.modify || !at) return false;
      const dir = event.key === 'ArrowLeft' ? -1 : 1;
      const text = plainOf(this.host.readRichRuns(root));
      event.preventDefault();
      let target = sel.isCollapsed ? focusAcrossMarker(text, at.focus, dir) : null;
      if (target === null) {
         sel.modify('move', dir < 0 ? 'backward' : 'forward', 'word');
         const moved = this.host.richAnchorFocus(root)?.focus ?? at.focus;
         const clamped = outsideMarker(text, moved);
         // Landing in a marker going left means the item's start was passed: stop there.
         target = clamped;
      }
      this.host.setRichSelection(root, target, target);
      this.host.richSel = { start: target, end: target };
      const s = window.getSelection();
      this.host.lastCaret = s?.anchorNode ? { node: s.anchorNode, offset: s.anchorOffset } : null;
      this.host.publishRichSelection();
      return true;
   }

   /** Home on a list item: straight to the item's first character, never past the bullet. */
   onRichHome(event: KeyboardEvent, root: HTMLElement): boolean {
      if (event.key !== 'Home' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
      const at = this.host.richAnchorFocus(root);
      if (!at) return false;
      const lines = parseLines(plainOf(this.host.readRichRuns(root)));
      const line = lines.find((l) => at.focus >= l.start && at.focus <= l.end);
      if (!line?.kind) return false;
      event.preventDefault();
      const target = line.markerEnd;
      this.host.setRichSelection(root, target, target);
      this.host.richSel = { start: target, end: target };
      const s = window.getSelection();
      this.host.lastCaret = s?.anchorNode ? { node: s.anchorNode, offset: s.anchorOffset } : null;
      this.host.publishRichSelection();
      return true;
   }

   /** List behaviour of the rich editor's keys; true when the key was handled. */
   onRichListKey(event: KeyboardEvent, root: HTMLElement): boolean {
      const mod = event.ctrlKey || event.metaKey;
      // Ctrl+Shift+7 / +8 toggle numbered / bulleted lists (as in Google Docs).
      if (mod && event.shiftKey && !event.altKey && (event.code === 'Digit7' || event.code === 'Digit8')) {
         event.preventDefault();
         this.toggleRichList(event.code === 'Digit7' ? 'number' : 'bullet');
         return true;
      }
      if (mod || event.altKey) {
         return false;
      }
      const key = event.key;
      if (key !== 'Enter' && key !== 'Backspace' && key !== 'Tab' && key !== ' ') {
         return false;
      }
      this.host.captureRichSelection(root);
      const { start, end } = this.host.richSel;
      const runs = this.host.readRichRuns(root);
      const collapsed = start === end;
      if (key === 'Tab') {
         event.preventDefault();
         const shifted = shiftListIndent(runs, start, end, event.shiftKey ? -1 : 1);
         if (shifted) {
            this.commitListResult(root, shifted);
         } else if (!event.shiftKey) {
            document.execCommand('insertText', false, ' '.repeat(4));
         }
         return true;
      }
      if (!collapsed || event.shiftKey) {
         return false;
      }
      if (key === 'Enter') {
         const result = listEnter(runs, start);
         if (!result) {
            return false;
         }
         event.preventDefault();
         if ('exit' in result) {
            this.commitListResult(root, result.exit);
         } else {
            // Native edits keep the browser's undo stack.
            this.richLineBreak(
               root,
               () => {
                  document.execCommand('insertLineBreak');
                  document.execCommand('insertText', false, result.insert.slice(1));
               },
               result.insert.length
            );
         }
         return true;
      }
      const result = key === 'Backspace' ? listBackspace(runs, start) : listAutoformat(runs, start);
      if (!result) {
         return false;
      }
      event.preventDefault();
      this.commitListResult(root, result);
      return true;
   }

   onRichPaste(event: ClipboardEvent): void {
      // Plain text only: pasted markup would drag foreign styles into the block.
      event.preventDefault();
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (text) {
         document.execCommand('insertText', false, text);
      }
   }

   /** Copy/cut the selection as plain text without list markers (they belong to the line, not the content). */
   onRichCopy(event: ClipboardEvent, cut: boolean): void {
      const root = this.host.host.richEditorRef()?.nativeElement;
      const sel = window.getSelection();
      if (!root || !sel?.rangeCount || sel.isCollapsed || !event.clipboardData) return;
      this.host.captureRichSelection(root);
      const { start, end } = this.host.richSel;
      const text = plainOf(this.host.readRichRuns(root)).slice(Math.min(start, end), Math.max(start, end));
      event.preventDefault();
      event.clipboardData.setData('text/plain', stripListMarkers(text));
      if (cut) document.execCommand('delete');
   }

   onRichBlur(): void {
      // Switching windows or opening a native picker blurs the editor without leaving it.
      if (!document.hasFocus()) {
         return;
      }
      this.host.commitTextEdit();
   }
}
