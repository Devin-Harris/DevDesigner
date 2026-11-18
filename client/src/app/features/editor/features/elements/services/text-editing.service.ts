import { DEFAULT_FONT_SIZE } from '../../../helpers/render/text-layout';
import {
   type ElementRef,
   computed,
   inject,
   signal,
   Injectable,
   type Signal,
   effect,
   untracked,
   DestroyRef,
} from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { CanvasElementModel, CodeLanguage, TextRun } from '@devdesigner/shared';
import { isColorValue, themeColorCss, resolveThemeElement, resolveThemeColor, themeSwatchCss } from '@devdesigner/shared';
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
   layoutTextBlock,
   shapeLabelOptions,
   shapeTextBox,
   SHAPE_TEXT_PADDING,
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
import { CodeMultiCursor } from '../helpers/code-multi-cursor';
import type { Box } from '../../../models/geometry.model';
import { LIST_LINE, parseLines } from '../helpers/rich-list.helper';
import { hoistUniformColor } from '../../../helpers/rich-text.helper';
import { LIST_LINE_PREFIX } from '../helpers/rich-list.helper';
import { CanvasViewService } from '../../../services/canvas-view.service';
/** What inline text editing reads from the editor entry; the entry wires it with `connect`. */
export interface TextEditingHost {
   /** The contenteditable of the rich text editor, while one is open. */
   readonly richEditorRef: Signal<ElementRef<HTMLDivElement> | undefined>;
}

/**
 * Inline editing of text, code and diff panes on the canvas: the editor overlay's geometry, the
 * rich text (contenteditable) session with per-run styling and lists, and committing the edit.
 */
@Injectable()
export class TextEditingService {
   private readonly destroyRef = inject(DestroyRef);
   private readonly store = inject(ProjectStore);
   private readonly codeActions = inject(CodeActionsService);
   private readonly snackBar = inject(MatSnackBar);
   private readonly canvasView = inject(CanvasViewService);
   private host!: TextEditingHost;

   constructor() {
      // Initialise the contenteditable once per editing session (the DOM owns the
      // content while typing, so it is never re-rendered from the store).
      // The inspector's "Edit original / Edit changed" opens the inline editor on that side.
      effect(() => {
         const req = this.codeActions.editRequest();
         if (!req) return;
         untracked(() => {
            this.codeActions.editRequest.set(null);
            if (this.editingTextId()) this.commitTextEdit();
            this.codeActions.diffEditSide.set(req.side);
            this.editingTextId.set(req.id);
         });
      });
      // A diff card's editor opens with the caret in the pane that was asked for.
      // Only when the editor opens: later keystrokes must not pull the caret across.
      effect(() => {
         const id = this.editingTextId();
         if (!id || untracked(() => !this.diffPaneEditor() || this.codeActions.diffEditSide() !== 'modified')) return;
         setTimeout(() => {
            const pane = document.querySelector('textarea.diff-pane') as HTMLTextAreaElement | null;
            pane?.focus();
            pane?.setSelectionRange(pane.value.length, pane.value.length);
         }, 30);
      });
      effect(() => {
         const ref = this.host.richEditorRef();
         untracked(() => {
            if (ref && ref.nativeElement !== this.richInitFor) {
               this.richInitFor = ref.nativeElement;
               this.initRichEditor(ref.nativeElement);
            } else if (!ref && this.richInitFor) {
               this.teardownRichEditor();
            }
         });
      });
      this.destroyRef.onDestroy(() => this.teardownRichEditor());
   }

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
      const v = this.canvasView.viewportFor(id);
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
      const el = raw && resolveThemeElement(raw, this.canvasView.deckThemeOf(raw));
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
      const v = this.canvasView.viewportFor(id);
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
      if (el.type === 'rectangle' || el.type === 'ellipse' || el.type === 'diamond') {
         // A shape label edits like a wrapping text box: rich text inside the shape's inset
         // text box, laid out exactly as the renderer lays it out (wrap + alignment).
         const opts = shapeLabelOptions(el, this.canvasView.themeColors());
         const inner = shapeTextBox(el);
         const block = layoutTextBlock(el.text || ' ', inner, opts);
         const lh = opts.fontSize * (el.lineHeight ?? DEFAULT_LINE_HEIGHT);
         const blockH = Math.max(1, block.lines.length) * lh + SHAPE_TEXT_PADDING * 2;
         const vAlign = el.verticalAlign ?? 'middle';
         const y =
            vAlign === 'top'
               ? inner.y
               : vAlign === 'bottom'
                 ? inner.y + inner.height - blockH
                 : inner.y + (inner.height - blockH) / 2;
         return {
            id,
            left: inner.x * z + v.x,
            top: y * z + v.y,
            width: inner.width * z,
            height: blockH * z,
            fontSize: opts.fontSize * z,
            fontFamily: fontStack(el.fontFamily),
            fontWeight: opts.fontWeight,
            italic: !!el.italic,
            value: el.text ?? '',
            color: opts.color,
            align: opts.align,
            wrap: true,
            center: false,
            padding: SHAPE_TEXT_PADDING * z,
            code: false,
            rich: true,
            lineHeight: lh * z,
            padLeft: null as number | null,
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
      const from = event.target as HTMLTextAreaElement;
      this.cursors.get(from)?.dispose();
      this.cursors.delete(from);
      const to = event.relatedTarget as HTMLElement | null;
      if (to?.classList.contains('code-pane')) {
         return;
      }
      this.commitTextEdit();
   }

   /** VS Code-style multi-cursor state per code textarea (dropped on blur). */
   private readonly cursors = new Map<HTMLTextAreaElement, CodeMultiCursor>();

   private multiCursor(area: HTMLTextAreaElement): CodeMultiCursor {
      let mc = this.cursors.get(area);
      if (!mc) {
         mc = new CodeMultiCursor(area, ' '.repeat(TAB_SIZE));
         this.cursors.set(area, mc);
      }
      return mc;
   }

   /** Code panes: Ctrl+click adds a cursor, Alt+Shift drag selects a column. */
   onCodePointerDown(event: PointerEvent): void {
      event.stopPropagation();
      const area = event.target as HTMLTextAreaElement;
      if (area.classList.contains('code-pane')) {
         this.multiCursor(area).handlePointerDown(event);
      }
   }

   /** Copy / cut / paste with several cursors (one line per cursor). */
   onCodeClipboard(event: ClipboardEvent): void {
      this.cursors.get(event.target as HTMLTextAreaElement)?.handleClipboard(event);
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
      if (this.multiCursor(area).handleKey(event)) {
         event.preventDefault();
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
         // Every line is its own block (the block boundary is the newline).
         this.renderRichListLines(root, runs);
         return;
      }
      for (const run of runs) {
         if (run.text) {
            root.appendChild(this.richRunSpan(run));
         }
      }
      if (plainOf(runs).endsWith('\n')) {
         // A trailing newline needs a placeholder so the empty last line is visible.
         root.appendChild(document.createElement('br'));
      }
   }

   /**
    * Text with list items: each line is its own block, list items with a hanging
    * indent the width of their marker so wrapped lines sit under the text (as on the
    * canvas). No newline characters live in the DOM: a newline inside a block let the
    * caret sit on either side of it (looking like the line's end while really being
    * the next line's start), so Enter/Tab hit the wrong line. Block boundaries read
    * back as newlines instead (readRichRuns / richOffset / setRichSelection).
    */
   private renderRichListLines(root: HTMLElement, runs: readonly TextRun[]): void {
      const cs = getComputedStyle(root);
      const ctx = document.createElement('canvas').getContext('2d');
      for (const line of runLines(runs)) {
         const plain = line.map((r) => r.text).join('');
         const prefix = LIST_LINE_PREFIX.exec(plain)?.[0];
         // Inline styles: component (encapsulated) CSS does not reach nodes made here.
         const host = document.createElement('div');
         host.className = 'li-line';
         let marker: HTMLElement | null = null;
         if (prefix) {
            host.classList.add('li-item');
            let em = prefix.length * 0.5;
            if (ctx) {
               const bold = line[0]?.bold;
               const weight = bold === undefined ? cs.fontWeight : bold ? '700' : '400';
               ctx.font = `${cs.fontStyle} ${weight} 100px ${cs.fontFamily}`;
               em = ctx.measureText(prefix).width / 100;
            }
            // A hanging indent (padding + negative text-indent) keeps the marker inline,
            // so the caret sits right after it, even on an empty item.
            host.style.paddingLeft = `${em}em`;
            host.style.textIndent = `-${em}em`;
            marker = document.createElement('span');
            marker.className = 'li-marker';
            marker.style.whiteSpace = 'pre';
            host.appendChild(marker);
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
         if (!plain) {
            // An empty line still needs height (and a place for the caret).
            host.appendChild(document.createElement('br'));
         }
         root.appendChild(host);
      }
   }

   /** True when the line blocks no longer match the content (e.g. after Enter or a paste). */
   private richListLayoutStale(root: HTMLElement, runs: readonly TextRun[]): boolean {
      const lines = plainOf(runs).split('\n');
      const blocks = Array.from(root.children);
      if (blocks.length !== lines.length || blocks.some((b) => !b.classList.contains('li-line'))) {
         return true;
      }
      return blocks.some((b, i) => {
         const t = b.textContent ?? '';
         if (t !== lines[i] || t.includes('\n')) return true;
         // A <br> is only the placeholder of an empty line.
         if (b.querySelector('br') && t) return true;
         const m = b.querySelector('.li-marker')?.textContent ?? '';
         return m !== (LIST_LINE_PREFIX.exec(t)?.[0] ?? '');
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
            span.style.color = el
               ? themeSwatchCss(resolveThemeColor(run.color, this.canvasView.deckThemeOf(el)))
               : run.color;
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
         // Browser-inserted markup can carry CSS like `var(--dd-text)`: keep only real colors.
         const color = el.dataset['color'] ?? el.style.color;
         if (color && isColorValue(color)) {
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
      // Range text skips <br>, which reads back as a newline; count them too (not an
      // empty line block's placeholder). Each line block after the first is a newline.
      const frag = range.cloneContents();
      const brs = Array.from(frag.querySelectorAll('br')).filter((br) => !this.isLinePlaceholder(br)).length;
      const blocks = Array.from(root.children).filter(
         (b, i) => i > 0 && b.classList.contains('li-line') && range.intersectsNode(b)
      ).length;
      return (frag.textContent ?? '').length + brs + blocks;
   }

   /** A <br> that only holds an empty line block open (reads back as nothing). */
   private isLinePlaceholder(br: Element): boolean {
      const p = br.parentElement;
      return !!p && p.classList.contains('li-line') && p.childNodes.length === 1;
   }

   private setRichSelection(root: HTMLElement, start: number, end: number): void {
      const locate = (target: number): { node: Node; offset: number } => {
         let seen = 0;
         let last: { node: Node; offset: number } = { node: root, offset: 0 };
         const visit = (parent: Node): { node: Node; offset: number } | null => {
            for (let i = 0; i < parent.childNodes.length; i++) {
               const n = parent.childNodes[i];
               if (n.nodeType === Node.TEXT_NODE) {
                  const len = n.nodeValue?.length ?? 0;
                  // A boundary goes to the start of the next node, so a caret right after a
                  // list marker lands in the item's text rather than inside the marker span.
                  if (target < seen + len) return { node: n, offset: target - seen };
                  seen += len;
                  last = { node: n, offset: len };
               } else if (n instanceof HTMLElement) {
                  if (n.tagName === 'BR') {
                     if (this.isLinePlaceholder(n)) {
                        last = { node: parent, offset: i };
                        continue;
                     }
                     if (target <= seen) return last.node === root ? { node: parent, offset: i } : last;
                     seen += 1;
                     last = { node: parent, offset: i + 1 };
                     continue;
                  }
                  const isLine = parent === root && n.classList.contains('li-line');
                  if (isLine && i > 0) {
                     // The newline between line blocks: the end of the previous line.
                     if (target <= seen) return last;
                     seen += 1;
                  }
                  if (isLine) last = { node: n, offset: 0 };
                  const hit = visit(n);
                  if (hit) return hit;
               }
            }
            return null;
         };
         return visit(root) ?? last;
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
      if (el.type !== 'text') {
         // A shape label: the shape keeps its size.
         this.store.patchElementLocal(id, { text, runs: stored });
         return;
      }
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

   /**
    * Keep a collapsed caret where it looks like it is. Each list line's newline is a
    * character at the end of its block, so a caret placed "at the line end" can sit
    * after it (logically the next line's start), making Enter/Tab act on the wrong
    * line. A caret inside a bullet marker moves to just after it, so the marker and
    * its space cannot be edited apart (Backspace there removes/outdents the marker).
    */
   private clampRichCaret(root: HTMLElement): void {
      const sel = window.getSelection();
      if (!sel?.rangeCount || !sel.isCollapsed) return;
      const node = sel.anchorNode;
      if (!node || node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return;
      const text = node.nodeValue ?? '';
      const offset = sel.anchorOffset;
      const marker = node.parentElement?.closest('.li-marker');
      if (marker && root.contains(marker)) {
         // Just after the marker: the first character of the item's text, else the marker's end.
         const walker = document.createTreeWalker(marker.parentElement!, NodeFilter.SHOW_TEXT);
         let next: Node | null = null;
         for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (!marker.contains(n)) {
               next = n;
               break;
            }
         }
         const markerText = marker.lastChild?.lastChild ?? marker.lastChild;
         const home = next ? { node: next, offset: 0 } : markerText ? { node: markerText, offset: markerText.nodeValue?.length ?? 0 } : null;
         const prev = this.lastCaret;
         const wasHome = !!home && !!prev && prev.node === home.node && prev.offset === home.offset;
         const block = marker.closest('.li-line');
         if (wasHome && this.arrowLeftHeld && block?.previousElementSibling) {
            // ArrowLeft from an item's first character: to the end of the previous line.
            const before = block.previousElementSibling;
            const walker = document.createTreeWalker(before, NodeFilter.SHOW_TEXT);
            let lastText: Node | null = null;
            for (let n = walker.nextNode(); n; n = walker.nextNode()) lastText = n;
            if (lastText) sel.collapse(lastText, lastText.nodeValue?.length ?? 0);
            else sel.collapse(before, 0);
            this.lastCaret = sel.anchorNode ? { node: sel.anchorNode, offset: sel.anchorOffset } : null;
            return;
         }
         if (home && !(node === home.node && offset === home.offset)) {
            sel.collapse(home.node, home.offset);
         }
         this.lastCaret = home;
         return;
      }
      if (offset === text.length && text.endsWith('\n') && node.parentElement?.closest('.li-line')) {
         const prev = this.lastCaret;
         if (prev && prev.node === node && prev.offset === text.length - 1) {
            // ArrowRight from the line's end: on to the next line (just after its marker).
            const block = node.parentElement!.closest('.li-line')!;
            const nextBlock = block.nextSibling;
            const walker = nextBlock ? document.createTreeWalker(nextBlock, NodeFilter.SHOW_TEXT) : null;
            let target: Node | null = null;
            for (let n = walker?.nextNode() ?? null; n; n = walker!.nextNode()) {
               if (!n.parentElement?.closest('.li-marker')) {
                  target = n;
                  break;
               }
            }
            if (target) {
               sel.collapse(target, 0);
               this.lastCaret = { node: target, offset: 0 };
               return;
            }
         }
         sel.collapse(node, text.length - 1);
      }
      this.lastCaret = sel.anchorNode ? { node: sel.anchorNode, offset: sel.anchorOffset } : null;
   }

   private lastCaret: { node: Node; offset: number } | null = null;

   /** Set briefly after an ArrowLeft keydown, so the caret can leave an item to the previous line. */
   private arrowLeftHeld = false;

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
      if (
         !id ||
         !el ||
         (el.type !== 'text' && el.type !== 'rectangle' && el.type !== 'ellipse' && el.type !== 'diamond')
      ) {
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
            this.clampRichCaret(root);
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
      if (root && !event.isComposing) this.clampRichCaret(root);
      if (root && !event.isComposing && this.onRichArrowAcrossMarker(event, root)) {
         return;
      }
      // The caret moves after this event; the selectionchange that follows reads the flag.
      this.arrowLeftHeld = event.key === 'ArrowLeft' && !event.shiftKey;
      if (this.arrowLeftHeld) setTimeout(() => (this.arrowLeftHeld = false), 50);
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

   /**
    * ArrowLeft/Right across a bullet: jump straight between an item's first character
    * and the previous line's end (and back), so the caret never paints inside the
    * marker first. True when handled.
    */
   private onRichArrowAcrossMarker(event: KeyboardEvent, root: HTMLElement): boolean {
      if (
         (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') ||
         event.shiftKey ||
         event.ctrlKey ||
         event.metaKey ||
         event.altKey
      ) {
         return false;
      }
      this.captureRichSelection(root);
      const { start, end } = this.richSel;
      if (start !== end) return false;
      const lines = parseLines(plainOf(this.readRichRuns(root)));
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
      this.setRichSelection(root, target, target);
      this.richSel = { start: target, end: target };
      this.lastCaret = (() => {
         const s = window.getSelection();
         return s?.anchorNode ? { node: s.anchorNode, offset: s.anchorOffset } : null;
      })();
      return true;
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
         void this.store.updateElement(id, { text, runs: text ? (usableRuns(text, el.runs) ?? null) : null });
         return;
      }
      // All text recolored alike: that is the block's color now, for text typed later too.
      const hoisted = text.trim() ? hoistUniformColor(usableRuns(text, el.runs)) : null;
      if (text.trim() === '') {
         // An emptied placeholder stays: it goes back to showing its prompt.
         void (el.placeholder ? this.store.updateElement(id, { text: '', runs: null }) : this.store.deleteElement(id));
         return;
      }
      const runs = hoisted ? hoisted.runs : usableRuns(text, el.runs);
      const size = fitTextElement(el, { text, runs });
      void this.store.updateElement(id, {
         text,
         runs: runs ?? null,
         ...(hoisted ? { strokeColor: hoisted.color } : {}),
         width: size.width,
         height: size.height,
      });
   }
}
