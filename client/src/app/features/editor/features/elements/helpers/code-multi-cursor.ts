import {
   type CaretMove,
   type CodeEditResult,
   type CodeSel,
   columnSelection,
   deleteAt,
   duplicateLines,
   insertAt,
   moveCarets,
   moveLines,
   newlineAt,
   normalizeSels,
   selMax,
   selMin,
   selectNextOccurrence,
   smartHome,
} from '../../../helpers/code-editing.helper';

/**
 * VS Code-style editing for a code card's textarea: line duplicate / move, smart
 * Home, Ctrl+D, and multiple cursors (Ctrl+click, Alt+Shift drag, Ctrl+D). A
 * textarea holds one selection, so while there are several the extra cursors live
 * here and are drawn in an overlay beside the textarea; the textarea keeps the
 * primary (last added) one. Edits go through `insertText`, so each stays one native
 * undo step.
 */
export class CodeMultiCursor {
   private sels: CodeSel[] = [];
   private overlay: HTMLDivElement | null = null;
   private drag: { line: number; col: number } | null = null;
   private wholeWord = false;
   private blinkStart = 0;
   private readonly onScroll = (): void => this.render();

   constructor(
      private readonly area: HTMLTextAreaElement,
      private readonly indent: string,
   ) {
      area.addEventListener('scroll', this.onScroll);
      area.addEventListener('dblclick', this.onDblClick);
   }

   /** Double-click selects just the word (the browser also takes the trailing space on Windows). */
   private readonly onDblClick = (): void => {
      const { selectionStart: a, selectionEnd: b, value } = this.area;
      const text = value.slice(a, b);
      const trimmed = text.replace(/\s+$/, '');
      if (trimmed && trimmed.length < text.length) {
         this.area.setSelectionRange(a, a + trimmed.length);
      }
   };

   get multi(): boolean {
      return this.sels.length > 1;
   }

   dispose(): void {
      this.area.removeEventListener('scroll', this.onScroll);
      this.area.removeEventListener('dblclick', this.onDblClick);
      this.reset();
   }

   /** Back to the textarea's single native selection. */
   reset(): void {
      this.sels = [];
      this.overlay?.remove();
      this.overlay = null;
      this.area.style.caretColor = 'var(--dd-text)';
   }

   private nativeSel(): CodeSel {
      const { selectionStart: s, selectionEnd: e, selectionDirection: d } = this.area;
      return d === 'backward' ? { anchor: e, head: s } : { anchor: s, head: e };
   }

   private current(): CodeSel[] {
      return this.multi ? this.sels : [this.nativeSel()];
   }

   /** Push a new value + selections into the textarea (one undo step). */
   private write(result: CodeEditResult): void {
      const area = this.area;
      const old = area.value;
      const next = result.value;
      if (next !== old) {
         let a = 0;
         while (a < old.length && a < next.length && old[a] === next[a]) a++;
         let b = 0;
         while (b < old.length - a && b < next.length - a && old[old.length - 1 - b] === next[next.length - 1 - b]) b++;
         area.setSelectionRange(a, old.length - b);
         const text = next.slice(a, next.length - b);
         if (!document.execCommand('insertText', false, text) || area.value !== next) {
            area.value = next;
            area.dispatchEvent(new Event('input', { bubbles: true }));
         }
      }
      this.select(result.sels);
   }

   private select(sels: CodeSel[]): void {
      const norm = normalizeSels(sels);
      const p = norm[norm.length - 1];
      this.area.setSelectionRange(selMin(p), selMax(p), p.head < p.anchor ? 'backward' : 'forward');
      this.sels = norm.length > 1 ? norm : [];
      if (this.multi) {
         this.render();
      } else {
         this.reset();
      }
   }

   /** Keys; returns true when handled (the caller then prevents the default). */
   handleKey(e: KeyboardEvent): boolean {
      const ctrl = e.ctrlKey || e.metaKey;
      const value = this.area.value;
      const sels = this.current();
      const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown';

      // Shift+Alt+Up/Down duplicates the line(s); Alt+Up/Down moves them.
      if (vertical && e.altKey && !ctrl && e.shiftKey) {
         this.write(duplicateLines(value, sels, e.key === 'ArrowUp'));
         return true;
      }
      if (vertical && e.altKey && !ctrl && !e.shiftKey) {
         const moved = moveLines(value, sels, e.key === 'ArrowUp');
         if (moved) this.write(moved);
         return true;
      }
      if (ctrl && !e.altKey && !e.shiftKey && e.code === 'KeyD') {
         const p = sels[sels.length - 1];
         // Started from a bare cursor (VS Code): later matches are whole words only.
         if (sels.length === 1 && p.anchor === p.head) this.wholeWord = true;
         else if (sels.length === 1) this.wholeWord = false;
         this.select(selectNextOccurrence(value, sels, this.wholeWord));
         return true;
      }
      if (e.key === 'Escape' && this.multi) {
         this.select([sels[sels.length - 1]]);
         return true;
      }
      if (e.key === 'Home' && !ctrl && !e.altKey) {
         if (!this.multi) {
            const s = this.nativeSel();
            const h = smartHome(value, s.head);
            this.select([e.shiftKey ? { anchor: s.anchor, head: h } : { anchor: h, head: h }]);
            return true;
         }
      }
      if (!this.multi) {
         return false;
      }

      // Several cursors: everything below applies to each.
      const move = this.caretMove(e, ctrl);
      if (move) {
         this.select(moveCarets(value, sels, move, e.shiftKey));
         return true;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
         this.write(deleteAt(value, sels, e.key === 'Backspace' ? -1 : 1, ctrl));
         return true;
      }
      if (e.key === 'Enter' && !ctrl && !e.altKey) {
         this.write(newlineAt(value, sels, this.indent));
         return true;
      }
      if (e.key === 'Tab' && !e.shiftKey) {
         this.write(insertAt(value, sels, this.indent));
         return true;
      }
      if (ctrl && e.code === 'KeyA') {
         this.select([{ anchor: 0, head: value.length }]);
         return true;
      }
      if (e.key.length === 1 && !ctrl && !e.altKey) {
         this.write(insertAt(value, sels, e.key));
         return true;
      }
      if (ctrl && (e.code === 'KeyC' || e.code === 'KeyX' || e.code === 'KeyV' || e.code === 'KeyZ' || e.code === 'KeyY')) {
         // Clipboard events handle copy/cut/paste; undo/redo fall back to one cursor.
         if (e.code === 'KeyZ' || e.code === 'KeyY') this.reset();
         return false;
      }
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
         return false;
      }
      // Anything else: drop to the primary cursor and let the browser handle it.
      this.select([sels[sels.length - 1]]);
      return false;
   }

   private caretMove(e: KeyboardEvent, ctrl: boolean): CaretMove | null {
      switch (e.key) {
         case 'ArrowLeft':
            return ctrl ? 'wordLeft' : 'left';
         case 'ArrowRight':
            return ctrl ? 'wordRight' : 'right';
         case 'ArrowUp':
            return 'up';
         case 'ArrowDown':
            return 'down';
         case 'Home':
            return ctrl ? 'docStart' : 'home';
         case 'End':
            return ctrl ? 'docEnd' : 'end';
      }
      return null;
   }

   /** Copy / cut with several cursors: one line per cursor. */
   handleClipboard(e: ClipboardEvent): void {
      if (!this.multi || !e.clipboardData) {
         return;
      }
      const value = this.area.value;
      const ordered = [...this.sels].sort((a, b) => selMin(a) - selMin(b));
      if (e.type === 'paste') {
         e.preventDefault();
         const text = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
         const lines = text.split('\n');
         // As many lines as cursors: one each; otherwise the whole text at every cursor.
         const perCursor =
            lines.length === ordered.length
               ? this.sels.map((s) => lines[ordered.indexOf(s)])
               : text;
         this.write(insertAt(value, this.sels, perCursor));
         return;
      }
      e.preventDefault();
      e.clipboardData.setData('text/plain', ordered.map((s) => value.slice(selMin(s), selMax(s))).join('\n'));
      if (e.type === 'cut') {
         this.write(insertAt(value, this.sels, ''));
      }
   }

   /** Ctrl+click adds a cursor; Alt+Shift drag makes a column selection; a plain click resets. */
   handlePointerDown(e: PointerEvent): void {
      if (e.button !== 0) {
         return;
      }
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.altKey && e.shiftKey) {
         e.preventDefault();
         this.area.focus();
         const start = this.pointToLineCol(e);
         this.drag = start;
         this.select(columnSelection(this.area.value, start, start));
         const onMove = (ev: PointerEvent): void => {
            if (this.drag) this.select(columnSelection(this.area.value, this.drag, this.pointToLineCol(ev)));
         };
         const onUp = (): void => {
            this.drag = null;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
         };
         window.addEventListener('pointermove', onMove);
         window.addEventListener('pointerup', onUp);
         return;
      }
      if (ctrl) {
         // Keep what exists and add a caret at the click (it becomes the primary).
         e.preventDefault();
         this.area.focus();
         const at = this.pointToOffset(e);
         const existing = this.current();
         const hit = existing.findIndex((s) => s.anchor === s.head && s.head === at);
         if (hit >= 0 && existing.length > 1) {
            // Ctrl+click on an existing cursor removes it.
            this.select(existing.filter((_, i) => i !== hit));
            return;
         }
         this.select([...existing, { anchor: at, head: at }]);
         return;
      }
      if (this.multi) {
         this.reset();
      }
   }

   // --- geometry -------------------------------------------------------------

   private metrics(): { padTop: number; padLeft: number; lineH: number; charW: number; tab: number } {
      const cs = getComputedStyle(this.area);
      const ctx = document.createElement('canvas').getContext('2d');
      let charW = parseFloat(cs.fontSize) * 0.6;
      if (ctx) {
         ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
         charW = ctx.measureText('M'.repeat(50)).width / 50;
      }
      const lineH = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
      return {
         padTop: parseFloat(cs.paddingTop) || 0,
         padLeft: parseFloat(cs.paddingLeft) || 0,
         lineH,
         charW,
         tab: parseInt(cs.tabSize, 10) || 2,
      };
   }

   /** Visual column of `at` on its line (tabs expanded). */
   private visualCol(lineText: string, chars: number, tab: number): number {
      let col = 0;
      for (let i = 0; i < chars && i < lineText.length; i++) {
         col = lineText[i] === '\t' ? col + tab - (col % tab) : col + 1;
      }
      return col;
   }

   private pointToLineCol(e: PointerEvent): { line: number; col: number } {
      const m = this.metrics();
      const r = this.area.getBoundingClientRect();
      const y = e.clientY - r.top - m.padTop + this.area.scrollTop;
      const x = e.clientX - r.left - m.padLeft + this.area.scrollLeft;
      const lines = this.area.value.split('\n');
      const line = Math.max(0, Math.min(lines.length - 1, Math.floor(y / m.lineH)));
      const target = Math.max(0, Math.round(x / m.charW));
      // Visual column back to characters (tabs).
      const text = lines[line];
      let col = 0;
      let vis = 0;
      while (col < text.length) {
         const w = text[col] === '\t' ? m.tab - (vis % m.tab) : 1;
         if (vis + w / 2 > target) break;
         vis += w;
         col++;
      }
      return { line, col: target > vis && col >= text.length ? col + (target - vis) : col };
   }

   private pointToOffset(e: PointerEvent): number {
      const { line, col } = this.pointToLineCol(e);
      const lines = this.area.value.split('\n');
      let off = 0;
      for (let l = 0; l < line; l++) off += lines[l].length + 1;
      return off + Math.min(col, lines[line].length);
   }

   /** Draw every cursor but the primary (the textarea draws that one natively). */
   private render(): void {
      if (!this.multi) {
         return;
      }
      const area = this.area;
      const parent = area.offsetParent as HTMLElement | null;
      if (!parent) return;
      if (!this.overlay) {
         this.overlay = document.createElement('div');
         Object.assign(this.overlay.style, { position: 'absolute', pointerEvents: 'none', overflow: 'hidden', zIndex: '5' });
         area.after(this.overlay);
      }
      const ov = this.overlay;
      Object.assign(ov.style, {
         left: `${area.offsetLeft}px`,
         top: `${area.offsetTop}px`,
         width: `${area.offsetWidth}px`,
         height: `${area.offsetHeight}px`,
         transform: getComputedStyle(area).transform === 'none' ? '' : getComputedStyle(area).transform,
      });
      ov.textContent = '';
      const m = this.metrics();
      const value = area.value;
      const lines = value.split('\n');
      const starts: number[] = [];
      let acc = 0;
      for (const l of lines) {
         starts.push(acc);
         acc += l.length + 1;
      }
      const lineOf = (off: number): number => {
         let lo = 0;
         let hi = starts.length - 1;
         while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (starts[mid] <= off) lo = mid;
            else hi = mid - 1;
         }
         return lo;
      };
      const pos = (off: number): { x: number; y: number; line: number } => {
         const line = lineOf(off);
         const col = this.visualCol(lines[line], off - starts[line], m.tab);
         return {
            x: m.padLeft + col * m.charW - area.scrollLeft,
            y: m.padTop + line * m.lineH - area.scrollTop,
            line,
         };
      };
      this.blinkStart = document.timeline.currentTime as number;
      // The overlay draws every caret (the native one would blink on its own clock).
      area.style.caretColor = 'transparent';
      const box = (x: number, y: number, w: number, h: number, bg: string, caret = false): void => {
         const d = document.createElement('div');
         Object.assign(d.style, {
            position: 'absolute',
            left: `${x}px`,
            top: `${y}px`,
            width: `${w}px`,
            height: `${h}px`,
            background: bg,
         });
         ov.appendChild(d);
         if (caret) {
            const anim = d.animate([{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0, offset: 0.51 }, { opacity: 0 }], {
               duration: 1000,
               iterations: Infinity,
            });
            // One shared clock: every caret blinks together, restarting visible after each change.
            anim.startTime = this.blinkStart;
         }
      };
      const selBg = 'color-mix(in srgb, var(--dd-primary) 30%, transparent)';
      this.sels.forEach((s, i) => {
         const primary = i === this.sels.length - 1;
         const a = selMin(s);
         const b = selMax(s);
         if (a !== b && !primary) {
            const pa = pos(a);
            const pb = pos(b);
            for (let l = pa.line; l <= pb.line; l++) {
               const x0 = l === pa.line ? pa.x : m.padLeft - area.scrollLeft;
               const endOff = l === pb.line ? b : starts[l] + lines[l].length;
               const x1 = pos(endOff).x + (l === pb.line ? 0 : m.charW * 0.5);
               box(x0, m.padTop + l * m.lineH - area.scrollTop, Math.max(0, x1 - x0), m.lineH, selBg);
            }
         }
         const p = pos(s.head);
         box(p.x - 0.5, p.y, 1.5, m.lineH, 'var(--dd-text)', true);
      });
      // The primary's selection highlight is the native one (same colour).
   }
}
