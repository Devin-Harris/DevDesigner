import {
   type CanvasElementModel,
   type TextRun,
   isColorValue,
   resolveThemeColor,
   themeColorCss,
   themeSwatchCss,
} from '@devdesigner/shared';
import { type RunBase, normalizeRuns, plainOf, runLines, styleOver } from '../../../helpers/rich-text.helper';
import { LIST_LINE, LIST_LINE_PREFIX, listKindOver, outsideMarker } from '../helpers/rich-list.helper';
import type { TextEditingService } from './text-editing.service';

/** Rich text rendering, reading and selection for the text editor. */
export class RichTextRender {
   constructor(private readonly host: TextEditingService) {}

   /** Paint runs into the editor host as inline-styled spans. */
   renderRichRuns(root: HTMLElement, runs: readonly TextRun[]): void {
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
   renderRichListLines(root: HTMLElement, runs: readonly TextRun[]): void {
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
   richListLayoutStale(root: HTMLElement, runs: readonly TextRun[]): boolean {
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

   richRunSpan(run: TextRun): HTMLSpanElement {
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
            const el = this.host.store.elements().find((e) => e.id === this.host.editingTextId$());
            span.style.color = el
               ? themeSwatchCss(resolveThemeColor(run.color, this.host.canvasView.deckThemeOf(el)))
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
   readRichRuns(root: HTMLElement): TextRun[] {
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

   richOffset(root: HTMLElement, node: Node, offset: number): number {
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
   isLinePlaceholder(br: Element): boolean {
      const p = br.parentElement;
      return !!p && p.classList.contains('li-line') && p.childNodes.length === 1;
   }

   setRichSelection(root: HTMLElement, start: number, end: number): void {
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
      // `start` is the anchor and `end` the focus, so a backward selection keeps its direction.
      const a = locate(start);
      const b = locate(end);
      window.getSelection()?.setBaseAndExtent(a.node, a.offset, b.node, b.offset);
   }

   /** The selection's anchor and focus as plain-text offsets (null when it is not in the editor). */
   richAnchorFocus(root: HTMLElement): { anchor: number; focus: number } | null {
      const sel = window.getSelection();
      if (!sel?.rangeCount || !sel.anchorNode || !sel.focusNode) return null;
      if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null;
      return {
         anchor: this.richOffset(root, sel.anchorNode, sel.anchorOffset),
         focus: this.richOffset(root, sel.focusNode, sel.focusOffset),
      };
   }

   /** Move a range selection's ends out of list markers, so bullets/numbers are never selected. */
   clampRichRange(root: HTMLElement): void {
      const sel = window.getSelection();
      if (!sel?.rangeCount || sel.isCollapsed) return;
      const at = this.richAnchorFocus(root);
      if (!at) return;
      const text = plainOf(this.readRichRuns(root));
      const anchor = outsideMarker(text, at.anchor);
      const focus = outsideMarker(text, at.focus);
      if (anchor !== at.anchor || focus !== at.focus) this.setRichSelection(root, anchor, focus);
   }

   richBase(el: CanvasElementModel): RunBase {
      return {
         bold: !!el.bold,
         italic: !!el.italic,
         underline: false,
         color: themeColorCss(el.strokeColor) ?? el.strokeColor,
      };
   }

   publishRichSelection(runs?: TextRun[]): void {
      const root = this.host.host.richEditorRef()?.nativeElement;
      const id = this.host.editingTextId$();
      const el = id ? this.host.store.elements().find((e) => e.id === id) : null;
      if (!root || !el) {
         return;
      }
      const { start, end } = this.host.richSel;
      const current = runs ?? this.readRichRuns(root);
      const style = styleOver(current, Math.min(start, end), Math.max(start, end), this.richBase(el));
      this.host.richSession.selection.set({
         ...style,
         hasRange: start !== end,
         list: listKindOver(plainOf(current), start, end),
      });
   }

   /**
    * Keep a collapsed caret where it looks like it is. Each list line's newline is a
    * character at the end of its block, so a caret placed "at the line end" can sit
    * after it (logically the next line's start), making Enter/Tab act on the wrong
    * line. A caret inside a bullet marker moves to just after it, so the marker and
    * its space cannot be edited apart (Backspace there removes/outdents the marker).
    */
   clampRichCaret(root: HTMLElement): void {
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
         const home = next
            ? { node: next, offset: 0 }
            : markerText
              ? { node: markerText, offset: markerText.nodeValue?.length ?? 0 }
              : null;
         const prev = this.host.lastCaret;
         const wasHome = !!home && !!prev && prev.node === home.node && prev.offset === home.offset;
         const block = marker.closest('.li-line');
         if (wasHome && this.host.arrowLeftHeld && block?.previousElementSibling) {
            // ArrowLeft from an item's first character: to the end of the previous line.
            const before = block.previousElementSibling;
            const walker = document.createTreeWalker(before, NodeFilter.SHOW_TEXT);
            let lastText: Node | null = null;
            for (let n = walker.nextNode(); n; n = walker.nextNode()) lastText = n;
            if (lastText) sel.collapse(lastText, lastText.nodeValue?.length ?? 0);
            else sel.collapse(before, 0);
            this.host.lastCaret = sel.anchorNode ? { node: sel.anchorNode, offset: sel.anchorOffset } : null;
            return;
         }
         if (home && !(node === home.node && offset === home.offset)) {
            sel.collapse(home.node, home.offset);
         }
         this.host.lastCaret = home;
         return;
      }
      if (offset === text.length && text.endsWith('\n') && node.parentElement?.closest('.li-line')) {
         const prev = this.host.lastCaret;
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
               this.host.lastCaret = { node: target, offset: 0 };
               return;
            }
         }
         sel.collapse(node, text.length - 1);
      }
      this.host.lastCaret = sel.anchorNode ? { node: sel.anchorNode, offset: sel.anchorOffset } : null;
   }

   captureRichSelection(root: HTMLElement): void {
      const sel = window.getSelection();
      if (!sel?.rangeCount || !root.contains(sel.anchorNode)) {
         return;
      }
      const r = sel.getRangeAt(0);
      this.host.richSel = {
         start: this.richOffset(root, r.startContainer, r.startOffset),
         end: this.richOffset(root, r.endContainer, r.endOffset),
      };
   }
}
