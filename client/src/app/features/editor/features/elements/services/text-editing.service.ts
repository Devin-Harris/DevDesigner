import { DEFAULT_FONT_SIZE } from '../../../helpers/render/text-layout';
import { type ElementRef, computed, inject, signal, Injectable, type Signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { CanvasElementModel, CodeLanguage, TextRun } from '@devdesigner/shared';
import {
   themeColorCss,
   resolveThemeElement,
   resolveThemeColor,
   themeSwatchCss,
   type SlideTheme,
} from '@devdesigner/shared';
import { ProjectStore } from '../../../state/project/project.store';
import { CodeActionsService } from '../../../services/code-actions.service';
import { elementBox, FRAME_TITLE_H, FRAME_TITLE_W } from '../../../helpers/element-geometry.helper';
import {
   CODE_FONT_SIZE,
   CODE_PADDING,
   codeContentSize,
   codeDiffActive,
   codeElementContentSize,
   codeDiffEditLayout,
   codeHeaderHeight,
   codeTitle,
   codeLayoutMetrics,
   codeLineCount,
   codePrintWidth,
   fontStack,
   fontWeightFor,
} from '../../../helpers/render';
import { DEFAULT_LINE_HEIGHT, fitTextElement } from '../../../helpers/text-metrics';
import {
   isPlainRuns,
   normalizeRuns,
   patchRuns,
   plainOf,
   runLines,
   runsOrPlain,
   styleOver,
   usableRuns,
   type RunBase,
   type RunPatch,
} from '../../../helpers/rich-text.helper';
import {
   listAutoformat,
   listBackspace,
   listEnter,
   listKindOver,
   normalizeLists,
   shiftListIndent,
   toggleList,
   type ListKind,
   type ListResult,
} from '../helpers/rich-list.helper';
import { RichTextSessionService } from './rich-text-session.service';
import { TAB_SIZE } from '../../../helpers/code-highlight.helper';
import { formatCode } from '../../../helpers/code-format.helper';
import type { Box } from '../../../models/geometry.model';
import { LIST_LINE } from '../helpers/rich-list.helper';
import { LIST_LINE_PREFIX } from '../helpers/rich-list.helper';
/** What inline text editing reads from the editor entry; the entry wires it with `connect`. */
export interface TextEditingHost {
   /** The contenteditable of the rich text editor, while one is open. */
   readonly richEditorRef: Signal<ElementRef<HTMLDivElement> | undefined>;
   viewportFor(id: string): { x: number; y: number; zoom: number };
   deckThemeOf(el: Pick<CanvasElementModel, 'id' | 'type' | 'slideId'>): SlideTheme;
}

/**
 * Inline editing of text, code and diff panes on the canvas: the editor overlay's geometry, the
 * rich text (contenteditable) session with per-run styling and lists, and committing the edit.
 */
@Injectable()
export class TextEditingService {
   private readonly store = inject(ProjectStore);
   private readonly codeActions = inject(CodeActionsService);
   private readonly snackBar = inject(MatSnackBar);
   private host!: TextEditingHost;

   connect(host: TextEditingHost): void {
      this.host = host;
   }

   /** Id of the text element being edited inline (a DOM textarea overlays it). */
   readonly editingTextId = signal<string | null>(null);

   /** The right (changed) pane's editor of a diff code block being edited; null otherwise. */
   readonly diffPaneEditor = computed(() => {
      const id = this.editingTextId();
      const el = id ? this.store.elements().find((e) => e.id === id) : null;
      if (!id || el?.type !== 'code' || !codeDiffActive(el)) {
         return null;
      }
      const v = this.host.viewportFor(id);
      const z = v.zoom;
      const fontSize = el.fontSize ?? CODE_FONT_SIZE;
      const d = codeDiffEditLayout(el);
      const header = codeHeaderHeight(fontSize);
      return {
         // The edit highlight spans the whole card, not just one pane.
         frame: {
            left: el.x * z + v.x,
            top: (el.y + header) * z + v.y,
            width: el.width * z,
            height: (el.height - header) * z,
         },
         left: (el.x + d.left) * z + v.x,
         top: (el.y + header) * z + v.y,
         width: (el.width - d.left) * z,
         height: (el.height - header) * z,
         fontSize: fontSize * z,
         fontFamily: fontStack('code'),
         padding: CODE_PADDING * z,
         padLeft: d.textOffset * z,
         lineHeight: d.lineHeight * z,
         value: el.diffText ?? '',
      };
   });

   readonly textEditor = computed(() => {
      const id = this.editingTextId();
      if (!id) {
         return null;
      }
      const raw = this.store.elements().find((e) => e.id === id);
      // The editor overlay draws in the element's concrete (theme-resolved) colors and font.
      const el = raw && resolveThemeElement(raw, this.host.deckThemeOf(raw));
      const editable =
         el &&
         (el.type === 'text' ||
            el.type === 'code' ||
            el.type === 'frame' ||
            el.type === 'rectangle' ||
            el.type === 'ellipse' ||
            el.type === 'diamond' ||
            el.type === 'arrow' ||
            el.type === 'line');
      if (!el || !editable) {
         return null;
      }
      const v = this.host.viewportFor(id);
      const z = v.zoom;
      if (el.type === 'frame') {
         // The frame's name is edited in place on the strip above its top-left corner.
         return {
            id,
            left: el.x * z + v.x,
            top: (el.y - FRAME_TITLE_H) * z + v.y,
            width: FRAME_TITLE_W * z,
            height: FRAME_TITLE_H * z,
            fontSize: 14 * z,
            fontFamily: fontStack('normal'),
            fontWeight: 600,
            italic: false,
            value: el.text ?? '',
            color: themeColorCss(el.strokeColor) ?? el.strokeColor,
            align: 'left' as const,
            wrap: false,
            center: false,
            padding: 0,
            code: false,
            rich: false,
            lineHeight: null as number | null,
            padLeft: null as number | null,
            ink: null,
         };
      }
      if (el.type === 'code') {
         // The textarea sits exactly over the card with transparent glyphs, so the
         // live-highlighted SVG beneath shows through while the caret and selection stay native.
         const fontSize = el.fontSize ?? CODE_FONT_SIZE;
         const code = el.text ?? '';
         const diff = codeDiffActive(el) ? codeDiffEditLayout(el) : null;
         const m = diff ?? codeLayoutMetrics(fontSize, codeLineCount(code));
         // The file-name title bar (if any) sits above the editable code area.
         const header = codeHeaderHeight(fontSize);
         return {
            id,
            left: el.x * z + v.x,
            top: (el.y + header) * z + v.y,
            // A diff card edits its original in the left pane (the changed side is diffPaneEditor).
            width: (diff ? diff.left : el.width) * z,
            height: (el.height - header) * z,
            fontSize: fontSize * z,
            fontFamily: fontStack('code'),
            fontWeight: 400,
            italic: false,
            value: code,
            color: 'transparent',
            align: 'left' as const,
            wrap: false,
            center: false,
            padding: CODE_PADDING * z,
            code: true,
            rich: false,
            lineHeight: m.lineHeight * z,
            padLeft: m.textOffset * z,
            ink: null,
         };
      }
      const isLabel = el.type !== 'text';
      const fontSize = el.fontSize ?? (isLabel ? 16 : DEFAULT_FONT_SIZE);
      const text = el.text ?? '';
      // Height of the text content itself (so a label's editor can be centered in
      // its shape); a text element's own box is already fit to its content.
      const lh = el.lineHeight ?? DEFAULT_LINE_HEIGHT;
      const contentHeight = Math.max(1, text.split('\n').length) * fontSize * lh;
      // The editor overlays the text exactly, sized and styled to match the
      // rendered glyphs so it reads as true WYSIWYG — no overlay surface and no
      // second copy of the text behind it. A shape label centers over its shape; a
      // text element sits at its own top-left (auto-sized, or fixed-width + wrap).
      return {
         id,
         left: (isLabel ? el.x + el.width / 2 : el.x) * z + v.x,
         top: (isLabel ? el.y + el.height / 2 : el.y) * z + v.y,
         // A free text box gets a comfortable typing area (about 8 characters wide and one
         // full line tall) even while it is empty or short; it still grows with the text.
         width: Math.max(el.width, isLabel || el.wrap ? 8 : fontSize * 8) * z,
         height: (isLabel ? contentHeight : Math.max(el.height, fontSize * lh)) * z,
         fontSize: fontSize * z,
         fontFamily: fontStack(el.fontFamily),
         fontWeight: el.bold ? 800 : fontWeightFor(el.strokeWidth),
         italic: !!el.italic,
         value: text,
         color: themeColorCss(el.strokeColor) ?? el.strokeColor,
         align: isLabel ? 'center' : (el.textAlign ?? 'left'),
         wrap: isLabel || (el.type === 'text' && !!el.wrap),
         center: isLabel,
         padding: (isLabel ? 8 : 2) * z,
         code: false,
         rich: el.type === 'text',
         lineHeight: fontSize * z * lh,
         padLeft: null as number | null,
         // The edit outline hugs the glyphs, like the selection box.
         ink: el.type === 'text' && (el.text ?? '').trim() ? inkRect(elementBox(el)) : null,
      };
      function inkRect(b: Box) {
         return { left: b.x0 * z + v.x, top: b.y0 * z + v.y, width: (b.x1 - b.x0) * z, height: (b.y1 - b.y0) * z };
      }
   });

   /** The language new code blocks start with: that of the most recent code block. */
   lastCodeLanguage(): CodeLanguage {
      const els = this.store.elements();
      for (let i = els.length - 1; i >= 0; i -= 1) {
         if (els[i].type === 'code' && els[i].language) {
            return els[i].language as CodeLanguage;
         }
      }
      return 'typescript';
   }

   // --- inline text editing ---

   onTextInput(value: string): void {
      const id = this.editingTextId();
      const el = id ? this.store.elements().find((e) => e.id === id) : null;
      if (!id || !el) {
         return;
      }
      if (el.type === 'code') {
         // The card grows to fit what is typed but never shrinks under a manual resize.
         const size = codeContentSize(value, el.fontSize ?? CODE_FONT_SIZE, codeTitle(el));
         this.store.patchElementLocal(id, {
            text: value,
            width: Math.max(el.width, size.width),
            height: Math.max(el.height, size.height),
         });
         return;
      }
      if (el.type !== 'text') {
         // Shape label: just update text; the shape box does not resize.
         this.store.patchElementLocal(id, { text: value });
         return;
      }
      // Auto-size (grow) while typing; once resized, keep the width and wrap.
      const size = this.fitTextSize(el, value);
      this.store.patchElementLocal(id, { text: value, width: size.width, height: size.height });
   }

   /** Typing in a diff card's right (changed) pane; the card grows taller to fit. */
   onDiffPaneInput(value: string): void {
      const id = this.editingTextId();
      const el = id ? this.store.elements().find((e) => e.id === id) : null;
      if (!id || el?.type !== 'code') {
         return;
      }
      const next = { ...el, diffText: value };
      const d = codeDiffEditLayout(next);
      const height = codeHeaderHeight(el.fontSize ?? CODE_FONT_SIZE) + d.rows * d.lineHeight + CODE_PADDING * 2;
      this.store.patchElementLocal(id, { diffText: value, height: Math.max(el.height, Math.ceil(height)) });
   }

   /** Leaving one pane of a diff card's editor: moving to the other pane keeps editing. */
   onCodePaneBlur(event: FocusEvent): void {
      const to = event.relatedTarget as HTMLElement | null;
      if (to?.classList.contains('code-pane')) {
         return;
      }
      this.commitTextEdit();
   }

   /** The box a text element takes for `value`: always hugging its content, never wrapped. */
   fitTextSize(el: CanvasElementModel, value: string): { width: number; height: number } {
      return fitTextElement(el, { text: value });
   }

   /**
    * Keys inside the inline editor. Esc leaves edit mode (for every element). In a
    * code block, Tab indents (Shift+Tab outdents the line), and Enter keeps the
    * current line's indent, adding one more level after an opening bracket.
    */
   onEditorKeydown(event: KeyboardEvent): void {
      const area = event.target as HTMLTextAreaElement;
      if (event.key === 'Escape') {
         event.preventDefault();
         area.blur();
         return;
      }
      const id = this.editingTextId();
      const el = id ? this.store.elements().find((e) => e.id === id) : null;
      if (el?.type !== 'code' || event.isComposing) {
         return;
      }
      const insert = (text: string): void => {
         // execCommand keeps the browser's native undo stack; fall back to a manual splice.
         if (!document.execCommand('insertText', false, text)) {
            area.setRangeText(text, area.selectionStart, area.selectionEnd, 'end');
            area.dispatchEvent(new Event('input', { bubbles: true }));
         }
      };
      const indent = ' '.repeat(TAB_SIZE);
      if (event.shiftKey && event.altKey && event.code === 'KeyS') {
         // Fit the card to what is being typed (grow or shrink); saved on commit.
         event.preventDefault();
         const size = codeContentSize(area.value, el.fontSize ?? CODE_FONT_SIZE, codeTitle(el));
         this.store.patchElementLocal(el.id, { width: size.width, height: size.height });
         return;
      }
      if (event.shiftKey && event.altKey && event.code === 'KeyF') {
         // Format in place through the textarea so the edit stays one undo step.
         event.preventDefault();
         void formatCode(area.value, el.language, codePrintWidth(el))
            .then((formatted) => {
               if (formatted === area.value) {
                  return;
               }
               area.select();
               insert(formatted);
            })
            .catch((err: unknown) => {
               const message = err instanceof Error ? err.message : 'Could not format the code.';
               this.snackBar.open(`Couldn't format: ${message}`, undefined, { duration: 4000 });
            });
         return;
      }
      if (event.key === 'Tab') {
         event.preventDefault();
         const { value, selectionStart: start, selectionEnd: end } = area;
         const multi = value.slice(start, end).includes('\n');
         if (!event.shiftKey && !multi) {
            insert(indent);
            return;
         }
         // Indent/outdent every line the selection touches.
         const from = value.lastIndexOf('\n', start - 1) + 1;
         const block = value.slice(from, end);
         const changed = block
            .split('\n')
            .map((line) => (event.shiftKey ? line.replace(new RegExp(`^(?: {1,${TAB_SIZE}}|\\t)`), '') : indent + line))
            .join('\n');
         area.setSelectionRange(from, end);
         insert(changed);
         area.setSelectionRange(from, from + changed.length);
         return;
      }
      if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey) {
         event.preventDefault();
         const { value, selectionStart: start } = area;
         const lineStart = value.lastIndexOf('\n', start - 1) + 1;
         const lead = /^[ \t]*/.exec(value.slice(lineStart, start))?.[0] ?? '';
         const opens = /[{[(]$/.test(value.slice(lineStart, start).trimEnd());
         insert(`\n${lead}${opens ? indent : ''}`);
      }
   }

   private readonly richSession = inject(RichTextSessionService);

   /** The editor host the current session was initialised for. */
   richInitFor: HTMLDivElement | null = null;

   /** Selection (character offsets) last seen inside the rich editor. */
   private richSel = { start: 0, end: 0 };

   private richCleanup: (() => void) | null = null;

   /** True while native line-break edits run; list blocks are rebuilt once after. */
   private richHoldLayout = false;

   /** Paint runs into the editor host as inline-styled spans. */
   private renderRichRuns(root: HTMLElement, runs: readonly TextRun[]): void {
      root.textContent = '';
      if (LIST_LINE.test(plainOf(runs))) {
         this.renderRichListLines(root, runs);
      } else {
         for (const run of runs) {
            if (run.text) {
               root.appendChild(this.richRunSpan(run));
            }
         }
      }
      if (plainOf(runs).endsWith('\n')) {
         // A trailing newline needs a placeholder so the empty last line is visible.
         root.appendChild(document.createElement('br'));
      }
   }

   /**
    * Text with list items: each item is its own block with a hanging indent the
    * width of its marker, so wrapped lines sit under the text (as on the canvas).
    * The line's newline stays inside its block, so the text reads back unchanged.
    */
   private renderRichListLines(root: HTMLElement, runs: readonly TextRun[]): void {
      const cs = getComputedStyle(root);
      const ctx = document.createElement('canvas').getContext('2d');
      const lines = runLines(runs);
      lines.forEach((line, i) => {
         const plain = line.map((r) => r.text).join('');
         const prefix = LIST_LINE_PREFIX.exec(plain)?.[0];
         let host: HTMLElement = root;
         let marker: HTMLElement | null = null;
         if (prefix) {
            host = document.createElement('span');
            host.className = 'li-line';
            let em = prefix.length * 0.5;
            if (ctx) {
               const bold = line[0]?.bold;
               const weight = bold === undefined ? cs.fontWeight : bold ? '700' : '400';
               ctx.font = `${cs.fontStyle} ${weight} 100px ${cs.fontFamily}`;
               em = ctx.measureText(prefix).width / 100;
            }
            // Inline styles: component (encapsulated) CSS does not reach nodes made here.
            // The marker floats in the left padding, so the text never breaks after it
            // (a long first word stays beside the marker, as on the canvas).
            host.style.display = 'block';
            host.style.paddingLeft = `${em}em`;
            marker = document.createElement('span');
            marker.className = 'li-marker';
            marker.style.cssFloat = 'left';
            marker.style.width = `${em}em`;
            marker.style.marginLeft = `-${em}em`;
            marker.style.whiteSpace = 'pre';
            host.appendChild(marker);
            root.appendChild(host);
         }
         let seen = 0;
         for (const run of line) {
            let text = run.text;
            if (marker && seen < prefix!.length) {
               const head = text.slice(0, prefix!.length - seen);
               marker.appendChild(this.richRunSpan({ ...run, text: head }));
               seen += head.length;
               text = text.slice(head.length);
            }
            if (text) {
               host.appendChild(this.richRunSpan({ ...run, text }));
            }
         }
         if (i < lines.length - 1) {
            const last = line[line.length - 1] ?? runs[0];
            host.appendChild(this.richRunSpan({ ...last, text: '\n', morph: undefined }));
         }
      });
   }

   /** True when the list blocks no longer match the content (e.g. after Enter). */
   private richListLayoutStale(root: HTMLElement, runs: readonly TextRun[]): boolean {
      const lines = plainOf(runs).split('\n');
      const items = lines.filter((l) => LIST_LINE_PREFIX.test(l)).length;
      const blocks = Array.from(root.querySelectorAll<HTMLElement>('.li-line'));
      if (blocks.length !== items) {
         return true;
      }
      return blocks.some((b) => {
         const t = b.textContent ?? '';
         const m = b.querySelector('.li-marker')?.textContent ?? '';
         if (m !== LIST_LINE_PREFIX.exec(t)?.[0]) {
            return true;
         }
         return (
            !!b.querySelector('br') ||
            (t.indexOf('\n') !== t.length - 1 && t.includes('\n')) ||
            !LIST_LINE_PREFIX.test(t)
         );
      });
   }

   private richRunSpan(run: TextRun): HTMLSpanElement {
      {
         const span = document.createElement('span');
         span.textContent = run.text;
         if (run.bold !== undefined) {
            span.style.fontWeight = run.bold ? '700' : '400';
         }
         if (run.italic !== undefined) {
            span.style.fontStyle = run.italic ? 'italic' : 'normal';
         }
         if (run.underline) {
            span.style.textDecoration = 'underline';
         }
         if (run.color) {
            // Theme tokens paint as their color; the dataset keeps the token to save back.
            const el = this.store.elements().find((e) => e.id === this.editingTextId());
            span.style.color = el ? themeSwatchCss(resolveThemeColor(run.color, this.host.deckThemeOf(el))) : run.color;
            span.dataset['color'] = run.color;
         }
         if (run.morph) {
            span.dataset['morph'] = run.morph;
         }
         return span;
      }
   }

   /** Read the editor host back into runs (tolerant of browser-inserted markup). */
   private readRichRuns(root: HTMLElement): TextRun[] {
      const out: TextRun[] = [];
      const push = (text: string, style: Partial<TextRun>): void => {
         if (text) {
            out.push({ text, ...style });
         }
      };
      const styleOf = (el: HTMLElement, parent: Partial<TextRun>): Partial<TextRun> => {
         const s: Partial<TextRun> = { ...parent };
         const fw = el.style.fontWeight;
         if (fw) {
            s.bold = fw === 'bold' || fw === 'bolder' || Number.parseInt(fw, 10) >= 600;
         } else if (el.tagName === 'B' || el.tagName === 'STRONG') {
            s.bold = true;
         }
         if (el.style.fontStyle) {
            s.italic = el.style.fontStyle === 'italic';
         } else if (el.tagName === 'I' || el.tagName === 'EM') {
            s.italic = true;
         }
         const deco = el.style.textDecorationLine || el.style.textDecoration;
         if (deco.includes('underline') || el.tagName === 'U') {
            s.underline = true;
         }
         const color = el.dataset['color'] ?? el.style.color;
         if (color) {
            s.color = color;
         }
         if (el.dataset['morph']) {
            s.morph = el.dataset['morph'];
         }
         return s;
      };
      const lastLeaf = (n: Node): Node => (n.lastChild ? lastLeaf(n.lastChild) : n);
      const last = lastLeaf(root);
      const isBlock = (n: Node): boolean => n instanceof HTMLElement && (n.tagName === 'DIV' || n.tagName === 'P');
      const walk = (node: Node, style: Partial<TextRun>): void => {
         node.childNodes.forEach((child, index) => {
            if (child.nodeType === Node.TEXT_NODE) {
               push(child.nodeValue ?? '', style);
            } else if (child instanceof HTMLElement) {
               if (child.tagName === 'BR') {
                  // The trailing <br> is only a placeholder for the last empty line, and
                  // a lone <br> inside a block is that block's own empty line.
                  const placeholder = isBlock(node) && node.childNodes.length === 1;
                  if (child !== last && !placeholder) {
                     push('\n', style);
                  }
                  return;
               }
               if (isBlock(child) && (out.length || index > 0)) {
                  push('\n', style);
               }
               walk(child, styleOf(child, style));
            }
         });
      };
      walk(root, {});
      return normalizeRuns(out);
   }

   private richOffset(root: HTMLElement, node: Node, offset: number): number {
      const range = document.createRange();
      range.selectNodeContents(root);
      range.setEnd(node, offset);
      // Range text skips <br>, which reads back as a newline; count them too.
      const frag = range.cloneContents();
      return (frag.textContent ?? '').length + frag.querySelectorAll('br').length;
   }

   private setRichSelection(root: HTMLElement, start: number, end: number): void {
      const locate = (target: number): { node: Node; offset: number } => {
         const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
         let seen = 0;
         let lastNode: Text | null = null;
         for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
            const len = n.nodeValue?.length ?? 0;
            if (target <= seen + len) {
               return { node: n, offset: target - seen };
            }
            seen += len;
            lastNode = n;
         }
         return lastNode ? { node: lastNode, offset: lastNode.nodeValue?.length ?? 0 } : { node: root, offset: 0 };
      };
      const a = locate(start);
      const b = locate(end);
      const range = document.createRange();
      range.setStart(a.node, a.offset);
      range.setEnd(b.node, b.offset);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
   }

   private richBase(el: CanvasElementModel): RunBase {
      return {
         bold: !!el.bold,
         italic: !!el.italic,
         underline: false,
         color: themeColorCss(el.strokeColor) ?? el.strokeColor,
      };
   }

   private publishRichSelection(runs?: TextRun[]): void {
      const root = this.host.richEditorRef()?.nativeElement;
      const id = this.editingTextId();
      const el = id ? this.store.elements().find((e) => e.id === id) : null;
      if (!root || !el) {
         return;
      }
      const { start, end } = this.richSel;
      const current = runs ?? this.readRichRuns(root);
      const style = styleOver(current, Math.min(start, end), Math.max(start, end), this.richBase(el));
      this.richSession.selection.set({
         ...style,
         hasRange: start !== end,
         list: listKindOver(plainOf(current), start, end),
      });
   }

   /** Show a list edit's runs in the editor, keeping the (remapped) selection. */
   private commitListResult(root: HTMLElement, res: ListResult): void {
      const { start, end } = this.richSel;
      const total = plainOf(res.runs).length;
      this.renderRichRuns(root, res.runs);
      root.focus();
      this.setRichSelection(root, Math.min(res.map(start), total), Math.min(res.map(end), total));
      this.captureRichSelection(root);
      this.syncRichModel(res.runs);
      this.publishRichSelection(res.runs);
   }

   /** Toolbar / shortcut: toggle a bulleted or numbered list on the selected lines. */
   private toggleRichList(kind: ListKind): void {
      const root = this.host.richEditorRef()?.nativeElement;
      if (!root) {
         return;
      }
      this.captureRichSelection(root);
      const { start, end } = this.richSel;
      this.commitListResult(root, toggleList(this.readRichRuns(root), start, end, kind));
   }

   /** Push the editor's runs into the store (live) with the refit box. */
   private syncRichModel(runs: TextRun[]): void {
      const id = this.editingTextId();
      const el = id ? this.store.elements().find((e) => e.id === id) : null;
      if (!id || !el) {
         return;
      }
      const text = plainOf(runs);
      const stored = isPlainRuns(runs) ? undefined : runs;
      const size = fitTextElement(el, { text, runs: stored ?? null });
      this.store.patchElementLocal(id, { text, runs: stored, width: size.width, height: size.height });
   }

   onRichInput(event?: Event): void {
      const root = this.host.richEditorRef()?.nativeElement;
      if (!root) {
         return;
      }
      const runs = this.readRichRuns(root);
      this.captureRichSelection(root);
      // Keep list numbering/bullets right after deletes and pastes (not mid-composition).
      const fixed = (event as InputEvent | undefined)?.isComposing ? null : normalizeLists(runs);
      if (fixed) {
         this.commitListResult(root, fixed);
         return;
      }
      if (
         !this.richHoldLayout &&
         !(event as InputEvent | undefined)?.isComposing &&
         this.richListLayoutStale(root, runs)
      ) {
         this.commitListResult(root, { runs, map: (p) => p });
         return;
      }
      this.syncRichModel(runs);
      this.captureRichSelection(root);
      this.publishRichSelection(runs);
   }

   /**
    * Run native edits that add a line break, then rebuild the list blocks once with
    * the caret `inserted` characters past the old selection start (the DOM caret
    * right after a <br> is unreliable to read back).
    */
   private richLineBreak(root: HTMLElement, edit: () => void, inserted: number): void {
      this.captureRichSelection(root);
      const caret = Math.min(this.richSel.start, this.richSel.end) + inserted;
      this.richHoldLayout = true;
      try {
         edit();
      } finally {
         this.richHoldLayout = false;
      }
      const runs = this.readRichRuns(root);
      if (this.richListLayoutStale(root, runs)) {
         this.richSel = { start: caret, end: caret };
         this.commitListResult(root, { runs, map: (p) => p });
      }
   }

   private captureRichSelection(root: HTMLElement): void {
      const sel = window.getSelection();
      if (!sel?.rangeCount || !root.contains(sel.anchorNode)) {
         return;
      }
      const r = sel.getRangeAt(0);
      this.richSel = {
         start: this.richOffset(root, r.startContainer, r.startOffset),
         end: this.richOffset(root, r.endContainer, r.endOffset),
      };
   }

   /** Style the selected characters, or the whole block when nothing is selected. */
   private applyRichPatch(patch: RunPatch): void {
      const root = this.host.richEditorRef()?.nativeElement;
      if (!root) {
         return;
      }
      const runs = this.readRichRuns(root);
      const total = plainOf(runs).length;
      const { start, end } = this.richSel;
      const from = start === end ? 0 : Math.min(start, end);
      const to = start === end ? total : Math.max(start, end);
      const next = patchRuns(runs, from, to, patch);
      this.renderRichRuns(root, next);
      root.focus();
      this.setRichSelection(root, Math.min(start, total), Math.min(end, total));
      this.syncRichModel(next);
      this.publishRichSelection(next);
   }

   /** Type text at the remembered caret (a field token from the toolbar), as if typed. */
   private insertRichText(text: string): void {
      const root = this.host.richEditorRef()?.nativeElement;
      if (!root) {
         return;
      }
      root.focus();
      const { start, end } = this.richSel;
      this.setRichSelection(root, Math.min(start, end), Math.max(start, end));
      // execCommand fires the editor's own input handling (and keeps native undo).
      document.execCommand('insertText', false, text);
   }

   initRichEditor(root: HTMLDivElement): void {
      const id = this.editingTextId();
      const el = id ? this.store.elements().find((e) => e.id === id) : null;
      if (!id || !el || el.type !== 'text') {
         return;
      }
      const text = el.text ?? '';
      this.renderRichRuns(root, runsOrPlain(text, el.runs));
      root.focus();
      this.setRichSelection(root, text.length, text.length);
      this.richSel = { start: text.length, end: text.length };
      // Opened by a double-click: select the word under it (typing replaces it), or put the caret there.
      const at = this.editClickPoint;
      this.editClickPoint = null;
      if (at && text) {
         const word = this.wordAtPoint(root, text, at.x, at.y);
         if (word) {
            this.setRichSelection(root, word.start, word.end);
            this.richSel = word;
         }
      }
      this.richSession.open(
         id,
         (patch) => this.applyRichPatch(patch),
         (kind) => this.toggleRichList(kind),
         (text) => this.insertRichText(text)
      );
      this.publishRichSelection();

      const onSelection = (): void => {
         if (document.activeElement === root) {
            this.captureRichSelection(root);
            this.publishRichSelection();
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
      this.richCleanup = () => {
         document.removeEventListener('selectionchange', onSelection);
         document.removeEventListener('mousedown', onMouseDown, true);
      };
   }

   /** Where the double-click that opened the editor landed (screen coords), if any. */
   editClickPoint: { x: number; y: number } | null = null;

   /** The word (plain-text offsets) under a screen point in the rich editor, or a caret there when it is not on a word. */
   private wordAtPoint(root: HTMLElement, text: string, x: number, y: number): { start: number; end: number } | null {
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
      const i = this.richOffset(root, node, offset);
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
      this.richCleanup?.();
      this.richCleanup = null;
      this.richInitFor = null;
      this.richSession.close();
   }

   onRichKeydown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
         event.preventDefault();
         (event.target as HTMLElement).blur();
         return;
      }
      const root = this.host.richEditorRef()?.nativeElement;
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
            const current = this.richSession.selection();
            this.applyRichPatch({ [flag]: !(current?.[flag] ?? false) });
         }
      }
   }

   /** List behaviour of the rich editor's keys; true when the key was handled. */
   private onRichListKey(event: KeyboardEvent, root: HTMLElement): boolean {
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
      this.captureRichSelection(root);
      const { start, end } = this.richSel;
      const runs = this.readRichRuns(root);
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

   onRichBlur(): void {
      // Switching windows or opening a native picker blurs the editor without leaving it.
      if (!document.hasFocus()) {
         return;
      }
      this.commitTextEdit();
   }

   commitTextEdit(): void {
      const id = this.editingTextId();
      this.editingTextId.set(null);
      this.teardownRichEditor();
      if (!id) {
         return;
      }
      const el = this.store.elements().find((e) => e.id === id);
      if (!el) {
         return;
      }
      const text = el.text ?? '';
      if (el.type === 'code') {
         const diff = codeDiffActive(el);
         this.codeActions.diffEditSide.set('original');
         // Code blocks stay even when left empty. A diff card grows to fit its diff view.
         const size = codeElementContentSize(el);
         void this.store.updateElement(id, {
            text,
            ...(diff ? { diffText: el.diffText ?? '' } : {}),
            width: Math.max(el.width, size.width),
            height: Math.max(el.height, size.height),
         });
         return;
      }
      if (el.type !== 'text') {
         // Shape label: store the (possibly empty) label without resizing the shape.
         void this.store.updateElement(id, { text });
         return;
      }
      if (text.trim() === '') {
         // An emptied placeholder stays: it goes back to showing its prompt.
         void (el.placeholder ? this.store.updateElement(id, { text: '', runs: null }) : this.store.deleteElement(id));
         return;
      }
      const runs = usableRuns(text, el.runs);
      const size = fitTextElement(el, { text, runs });
      void this.store.updateElement(id, {
         text,
         runs: runs ?? null,
         width: size.width,
         height: size.height,
      });
   }
}
