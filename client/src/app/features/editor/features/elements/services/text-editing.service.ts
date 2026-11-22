import { DEFAULT_FONT_SIZE } from '../../../helpers/render/text-layout';
import { applySplitDiffInput } from '../helpers/split-diff-input';
import { DIFF_SPACER, diffEditValue, stripDiffSpacers } from '../../../helpers/code-diff-edit.helper';
import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import {
   type CanvasElementModel,
   type CodeLanguage,
   type TextRun,
   resolveThemeElement,
   themeColorCss,
} from '@devdesigner/shared';
import { ProjectStore } from '../../../state/project/project.store';
import { CodeActionsService } from '../../../services/code-actions.service';
import { FRAME_TITLE_H, FRAME_TITLE_W, elementBox } from '../../../helpers/element-geometry.helper';
import {
   CODE_FONT_SIZE,
   CODE_PADDING,
   SHAPE_TEXT_PADDING,
   codeContentSize,
   codeDiffActive,
   codeDiffEditLayout,
   codeDiffEditSize,
   codeDiffPrintWidths,
   codeElementContentSize,
   codeHeaderHeight,
   codeLayoutMetrics,
   codeLineCount,
   codePrintWidth,
   codeTitle,
   fontStack,
   fontWeightFor,
   layoutTextBlock,
   shapeLabelOptions,
   shapeTextBox,
} from '../../../helpers/render';
import { DEFAULT_LINE_HEIGHT, fitTextElement, textBlockShift } from '../../../helpers/text-metrics';
import { hoistUniformColor, usableRuns } from '../../../helpers/rich-text.helper';
import { RichTextSessionService } from './rich-text-session.service';
import { TAB_SIZE } from '../../../helpers/code-highlight.helper';
import { formatCode } from '../../../helpers/code-format.helper';
import { CodeMultiCursor } from '../helpers/code-multi-cursor';
import type { Box } from '../../../models/geometry.model';
import { CanvasViewService } from '../../../services/canvas-view.service';
import type { TextEditingHost } from './text-editing.helpers';
import { RichTextRender } from './rich-text-render';
import { RichTextInput } from './rich-text-input';

/**
 * Inline editing of text, code and diff panes on the canvas: the editor overlay's geometry, the
 * rich text (contenteditable) session with per-run styling and lists, and committing the edit.
 */
@Injectable()
export class TextEditingService {
   /** Methods moved to rich-text-input.ts. */
   private readonly richTextInput = new RichTextInput(this);

   /** Methods moved to rich-text-render.ts. */
   private readonly richTextRender = new RichTextRender(this);

   private readonly destroyRef = inject(DestroyRef);
   readonly store = inject(ProjectStore);
   private readonly codeActions = inject(CodeActionsService);
   readonly canvasView = inject(CanvasViewService);
   host!: TextEditingHost;

   constructor() {
      // Initialise the contenteditable once per editing session (the DOM owns the
      // content while typing, so it is never re-rendered from the store).
      // The inspector's "Edit original / Edit changed" opens the inline editor on that side.
      effect(() => {
         const req = this.codeActions.editRequest();
         if (!req) return;
         untracked(() => {
            this.codeActions.editRequest.set(null);
            if (this.editingTextId$()) this.commitTextEdit();
            this.codeActions.diffEditSide.set(req.side);
            this.editingTextId$.set(req.id);
         });
      });
      // Remember each edited element as it was when its editor opened: live typing and
      // per-run styling patch the store locally, so the commit records against this.
      effect(() => {
         const id = this.editingTextId$();
         untracked(() => {
            if (!id) return;
            if (this.editStart?.id === id) return;
            this.editStart = this.store.elements().find((e) => e.id === id) ?? null;
            this.prepareDiffEdit(id);
         });
      });
      // A diff card's editor opens with the caret in the pane that was asked for.
      // Only when the editor opens: later keystrokes must not pull the caret across.
      effect(() => {
         const id = this.editingTextId$();
         if (!id || untracked(() => !this.diffPaneEditor$() || this.codeActions.diffEditSide() !== 'modified')) return;
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
   readonly editingTextId$ = signal<string | null>(null);

   /** The right (changed) pane's editor of a diff code block being edited; null otherwise. */
   readonly diffPaneEditor$ = computed(() => {
      const id = this.editingTextId$();
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
         value: splitDiffEdit(el)
            ? diffEditValue(el.text ?? '', el.diffText ?? '', 'modified', !el.diffShowWhitespace)
            : (el.diffText ?? ''),
      };
   });

   readonly textEditor$ = computed(() => {
      const id = this.editingTextId$();
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
            el.type === 'diamond' || el.type === 'triangle' ||
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
            value: splitDiffEdit(el)
               ? diffEditValue(code, el.diffText ?? '', 'original', !el.diffShowWhitespace)
               : code,
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
      if (el.type === 'rectangle' || el.type === 'ellipse' || el.type === 'diamond' || el.type === 'triangle') {
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
      // Middle/bottom-aligned text (slide placeholders) is drawn shifted in its box:
      // the editor follows the drawn lines so clicks and the caret land on them.
      const shift = el.type === 'text' ? textBlockShift(el) : 0;
      const editBox = elementBox(el);
      // Right after Enter the new (still empty) last line has no glyphs: keep it inside the outline.
      if (/\n[^\S\n]*$/.test(text)) editBox.y1 = Math.max(editBox.y1, el.y + el.height);
      // The editor overlays the text exactly, sized and styled to match the
      // rendered glyphs so it reads as true WYSIWYG — no overlay surface and no
      // second copy of the text behind it. A shape label centers over its shape; a
      // text element sits at its own top-left (auto-sized, or fixed-width + wrap).
      return {
         id,
         left: (isLabel ? el.x + el.width / 2 : el.x) * z + v.x,
         top: (isLabel ? el.y + el.height / 2 : el.y + shift) * z + v.y,
         // A free text box gets a comfortable typing area (about 8 characters wide and one
         // full line tall) even while it is empty or short; it still grows with the text.
         width: Math.max(el.width, isLabel || el.wrap ? 8 : fontSize * 8) * z,
         height: (isLabel ? contentHeight : Math.max(el.height - shift, fontSize * lh)) * z,
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
         ink: el.type === 'text' && (el.text ?? '').trim() ? inkRect(editBox) : null,
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

   onTextInput(value: string, event?: Event): void {
      const id = this.editingTextId$();
      const el = id ? this.store.elements().find((e) => e.id === id) : null;
      if (!id || !el) {
         return;
      }
      if (el.type === 'code' && splitDiffEdit(el) && event) {
         this.onSplitDiffInput(el, 'original', event);
         return;
      }
      if (el.type === 'code' && codeDiffActive(el)) {
         this.growDiffWhileEditing(el, { text: value });
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

   /** Typing in a diff card's right (changed) pane; the card grows to fit both panes. */
   onDiffPaneInput(value: string, event?: Event): void {
      const id = this.editingTextId$();
      const el = id ? this.store.elements().find((e) => e.id === id) : null;
      if (!id || el?.type !== 'code') {
         return;
      }
      if (splitDiffEdit(el) && event) {
         this.onSplitDiffInput(el, 'modified', event);
         return;
      }
      this.growDiffWhileEditing(el, { diffText: value });
   }

   /** Typing in a split diff pane: store the real code; the card only grows taller. */
   private onSplitDiffInput(el: CanvasElementModel, side: 'original' | 'modified', event: Event): void {
      const code = { text: el.text ?? '', diffText: el.diffText ?? '' };
      const real = applySplitDiffInput(event, side, code, !el.diffShowWhitespace);
      const patch = side === 'original' ? { text: real } : { diffText: real };
      const size = codeElementContentSize({ ...el, ...patch });
      this.store.patchElementLocal(el.id, { ...patch, height: Math.max(el.height, size.height) });
   }

   /** The size a diff card had before editing widened it, so commit can put it back. */
   private diffEditOrigin: { id: string; width: number; height: number } | null = null;

   /**
    * While a diff card is edited its two panes are plain code side by side: grow the card
    * so neither textarea ever scrolls (a scrolled textarea's caret no longer lines up with
    * the code drawn beneath it, so keys like End/arrows appear to land on the wrong text).
    */
   private growDiffWhileEditing(el: CanvasElementModel, patch: { text?: string; diffText?: string }): void {
      if (this.diffEditOrigin?.id !== el.id) {
         this.diffEditOrigin = { id: el.id, width: el.width, height: el.height };
      }
      const size = codeDiffEditSize({ ...el, ...patch });
      this.store.patchElementLocal(el.id, {
         ...patch,
         width: Math.max(el.width, size.width),
         height: Math.max(el.height, size.height),
      });
   }

   /** Begin a diff edit: make room for both panes up front so nothing scrolls from the first key. */
   prepareDiffEdit(id: string): void {
      const el = this.store.elements().find((e) => e.id === id);
      // A split diff edits in place and keeps its bounds; only inline needs two panes' room.
      if (el?.type === 'code' && codeDiffActive(el) && !splitDiffEdit(el)) {
         this.growDiffWhileEditing(el, {});
      }
   }

   /**
    * Code textareas must never scroll: their glyphs are transparent over the SVG
    * rendering, which does not scroll with them. The card grows to fit instead.
    */
   onCodeScroll(event: Event): void {
      const area = event.target as HTMLTextAreaElement;
      if (area.scrollLeft || area.scrollTop) {
         area.scrollLeft = 0;
         area.scrollTop = 0;
      }
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

   /** Code panes: Ctrl+click adds a cursor, Alt+Shift or Ctrl+Shift drag selects a column. */
   onCodePointerDown(event: PointerEvent): void {
      event.stopPropagation();
      const area = event.target as HTMLTextAreaElement;
      if (area.classList.contains('code-pane')) {
         this.multiCursor(area).handlePointerDown(event);
      }
   }

   /** Copy / cut / paste with several cursors (one line per cursor). */
   onCodeClipboard(event: ClipboardEvent): void {
      const area = event.target as HTMLTextAreaElement;
      this.cursors.get(area)?.handleClipboard(event);
      // A split diff's pane holds invisible spacer lines: never let them reach the clipboard.
      if (event.defaultPrevented || event.type === 'paste' || !event.clipboardData) return;
      const picked = area.value.slice(area.selectionStart, area.selectionEnd);
      if (!picked.includes(DIFF_SPACER)) return;
      event.preventDefault();
      event.clipboardData.setData('text/plain', stripDiffSpacers(picked));
      if (event.type === 'cut') {
         area.setRangeText('', area.selectionStart, area.selectionEnd, 'start');
         area.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteByCut' }));
      }
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
      const id = this.editingTextId$();
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
         const size = codeDiffActive(el)
            ? codeDiffEditSize(el)
            : codeContentSize(area.value, el.fontSize ?? CODE_FONT_SIZE, codeTitle(el));
         this.store.patchElementLocal(el.id, { width: size.width, height: size.height });
         return;
      }
      if (event.shiftKey && event.altKey && event.code === 'KeyF') {
         // Format in place through the textarea so the edit stays one undo step.
         event.preventDefault();
         const side = area.classList.contains('diff-pane') ? 'modified' : 'original';
         const widths = codeDiffPrintWidths(el);
         const source = stripDiffSpacers(area.value);
         const printWidth = codeDiffActive(el) ? widths[side] : codePrintWidth(el);
         void formatCode(source, el.language, printWidth)
            .then((formatted) => {
               if (formatted === area.value) {
                  return;
               }
               area.select();
               insert(formatted);
            })
            .catch((err: unknown) => this.codeActions.reportFormatErrors(el, side, err, source, printWidth));
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

   readonly richSession = inject(RichTextSessionService);

   /** The editor host the current session was initialised for. */
   richInitFor: HTMLDivElement | null = null;

   /** Selection (character offsets) last seen inside the rich editor. */
   richSel = { start: 0, end: 0 };

   richCleanup: (() => void) | null = null;

   /** True while native line-break edits run; list blocks are rebuilt once after. */
   richHoldLayout = false;

   lastCaret: { node: Node; offset: number } | null = null;

   /** Set briefly after an ArrowLeft keydown, so the caret can leave an item to the previous line. */
   arrowLeftHeld = false;

   /** Where the double-click that opened the editor landed (screen coords), if any. */
   editClickPoint: { x: number; y: number } | null = null;

   /** The edited element as it was when its inline editor opened (undo baseline). */
   private editStart: CanvasElementModel | null = null;

   commitTextEdit(): void {
      const id = this.editingTextId$();
      const start = this.editStart?.id === id ? this.editStart : null;
      this.editStart = null;
      this.editingTextId$.set(null);
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
         // A diff card widened only to edit both panes goes back to its own size (or what its view needs).
         const origin = diff && this.diffEditOrigin?.id === id ? this.diffEditOrigin : null;
         this.diffEditOrigin = null;
         const base = origin ?? el;
         // A split diff was edited in place: it keeps its width (only grows taller).
         const keepWidth = diff && splitDiffEdit(el);
         void this.store.commitElementEdit(id, start, {
            text,
            ...(diff ? { diffText: el.diffText ?? '' } : {}),
            width: keepWidth ? base.width : Math.max(base.width, size.width),
            height: Math.max(base.height, size.height),
         });
         return;
      }
      if (el.type !== 'text') {
         // Shape label: store the (possibly empty) label without resizing the shape.
         void this.store.commitElementEdit(id, start, {
            text,
            runs: text ? (usableRuns(text, el.runs) ?? null) : null,
         });
         return;
      }
      // All text recolored alike: that is the block's color now, for text typed later too.
      const hoisted = text.trim() ? hoistUniformColor(usableRuns(text, el.runs)) : null;
      if (text.trim() === '') {
         // An emptied placeholder stays: it goes back to showing its prompt.
         void (el.placeholder
            ? this.store.commitElementEdit(id, start, { text: '', runs: null })
            : this.store.deleteElement(id));
         return;
      }
      const runs = hoisted ? hoisted.runs : usableRuns(text, el.runs);
      const size = fitTextElement(el, { text, runs });
      void this.store.commitElementEdit(id, start, {
         text,
         runs: runs ?? null,
         ...(hoisted ? { strokeColor: hoisted.color } : {}),
         width: size.width,
         height: size.height,
      });
   }

   // ---- delegates to rich-text-render.ts ----
   renderRichRuns(root: HTMLElement, runs: readonly TextRun[]): void {
      return this.richTextRender.renderRichRuns(root, runs);
   }
   richListLayoutStale(root: HTMLElement, runs: readonly TextRun[]): boolean {
      return this.richTextRender.richListLayoutStale(root, runs);
   }
   readRichRuns(root: HTMLElement): TextRun[] {
      return this.richTextRender.readRichRuns(root);
   }
   richOffset(root: HTMLElement, node: Node, offset: number): number {
      return this.richTextRender.richOffset(root, node, offset);
   }
   setRichSelection(root: HTMLElement, start: number, end: number): void {
      return this.richTextRender.setRichSelection(root, start, end);
   }
   publishRichSelection(runs?: TextRun[]): void {
      return this.richTextRender.publishRichSelection(runs);
   }
   clampRichCaret(root: HTMLElement): void {
      return this.richTextRender.clampRichCaret(root);
   }
   captureRichSelection(root: HTMLElement): void {
      return this.richTextRender.captureRichSelection(root);
   }

   // ---- delegates to rich-text-input.ts ----
   onRichInput(event?: Event): void {
      return this.richTextInput.onRichInput(event);
   }
   initRichEditor(root: HTMLDivElement): void {
      return this.richTextInput.initRichEditor(root);
   }
   teardownRichEditor(): void {
      return this.richTextInput.teardownRichEditor();
   }
   onRichKeydown(event: KeyboardEvent): void {
      return this.richTextInput.onRichKeydown(event);
   }
   onRichPaste(event: ClipboardEvent): void {
      return this.richTextInput.onRichPaste(event);
   }
   onRichBlur(): void {
      return this.richTextInput.onRichBlur();
   }
}
export type { TextEditingHost } from './text-editing.helpers';

/** A split diff (not inline) is edited in place over its own view, with spacer lines. */
function splitDiffEdit(el: CanvasElementModel): boolean {
   return el.type === 'code' && codeDiffActive(el) && el.diffView !== 'inline';
}
