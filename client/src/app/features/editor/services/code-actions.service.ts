import { Injectable, inject, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { CanvasElementModel, CodeDiffView } from '@devdesigner/shared';
import { ProjectStore } from '../../../stores/project.store';
import { formatCode } from '../canvas/helpers/code-format.helper';
import {
   CODE_FONT_SIZE,
   codeContentSize,
   codeHeaderHeight,
   codeTitle,
   codePrintWidth,
   codeDiffActive,
   codeElementContentSize,
} from '../canvas/helpers/shape-render.helper';

/** Actions on code-block elements shared by the inspector and the floating toolbar. */
@Injectable({ providedIn: 'root' })
export class CodeActionsService {
   private readonly store = inject(ProjectStore);
   private readonly snackBar = inject(MatSnackBar);

   /** Id of the code block whose file name is being edited in place on the canvas. */
   readonly fileNameEditId = signal<string | null>(null);

   /**
    * Which side of a diff the inline editor is editing: the original (`text`) or the
    * changed side (`diffText`). While editing, the card shows that side plain.
    */
   readonly diffEditSide = signal<'original' | 'modified'>('original');

   /** A request (from the inspector) for the editor to start editing a diff side. */
   readonly editRequest = signal<{ id: string; side: 'original' | 'modified' } | null>(null);

   /** Ask the canvas to open the inline editor on one side of a code block's diff. */
   editDiffSide(id: string, side: 'original' | 'modified'): void {
      this.store.selectElement(id);
      this.editRequest.set({ id, side });
   }

   /**
    * Show a code block's diff split, inline, or turn it off (original only). Turning it on
    * the first time seeds the changed side with a copy of the code. The card grows to fit
    * the new view; one that was fit to its old view is refit exactly.
    */
   async setDiffView(ids: readonly string[], view: CodeDiffView): Promise<void> {
      const blocks = this.store.elements().filter((e) => e.type === 'code' && ids.includes(e.id));
      for (const el of blocks) {
         if ((el.diffView ?? 'off') === view && (view === 'off' || el.diffText != null)) {
            continue;
         }
         const diffText = el.diffText ?? (view === 'off' ? undefined : (el.text ?? ''));
         const next: CanvasElementModel = { ...el, diffView: view, diffText };
         await this.store.updateElement(el.id, {
            diffView: view,
            ...(el.diffText == null && diffText != null ? { diffText } : {}),
            ...this.refit(el, next),
         });
      }
   }

   /** Toggle whether whitespace-only changes count in a code block's diff (ignored by default). */
   async toggleDiffWhitespace(ids: readonly string[]): Promise<void> {
      const blocks = this.store.elements().filter((e) => e.type === 'code' && ids.includes(e.id));
      const show = !blocks.every((e) => e.diffShowWhitespace);
      for (const el of blocks) {
         await this.store.updateElement(el.id, { diffShowWhitespace: show });
      }
   }

   /** Remove a code block's diff entirely (keeps the original code). */
   async clearDiff(id: string): Promise<void> {
      const el = this.store.elements().find((e) => e.id === id);
      if (el?.type !== 'code' || el.diffText == null) {
         return;
      }
      const next: CanvasElementModel = { ...el, diffText: undefined, diffView: 'off' };
      await this.store.updateElement(id, { diffText: null, diffView: 'off', ...this.refit(el, next) });
   }

   /** Swap the original and changed sides of a code block's diff. */
   async swapDiffSides(id: string): Promise<void> {
      const el = this.store.elements().find((e) => e.id === id);
      if (el?.type !== 'code' || el.diffText == null) {
         return;
      }
      await this.store.updateElement(id, { text: el.diffText, diffText: el.text ?? '' });
   }

   /** Size patch moving a card from `before`'s view to `after`'s: exact refit when it was fit, else grow only. */
   private refit(before: CanvasElementModel, after: CanvasElementModel): { width?: number; height?: number } {
      if (before.expandedHeight != null) {
         return {};
      }
      const was = codeElementContentSize(before);
      const now = codeElementContentSize(after);
      const fitted = Math.abs(was.width - before.width) < 2 && Math.abs(was.height - before.height) < 2;
      const width = fitted ? now.width : Math.max(before.width, now.width);
      const height = fitted ? now.height : Math.max(before.height, now.height);
      return {
         ...(width !== before.width ? { width } : {}),
         ...(height !== before.height ? { height } : {}),
      };
   }

   /** Open the in-canvas file-name editor on a code block. */
   editFileName(id: string): void {
      this.store.selectElement(id);
      this.fileNameEditId.set(id);
   }

   /** Set (or clear, with an empty value) a code block's file name; the card widens if the title needs it. */
   async setFileName(id: string, value: string): Promise<void> {
      const el = this.store.elements().find((e) => e.id === id);
      if (el?.type !== 'code') {
         return;
      }
      const fileName = value.trim();
      if (fileName === (el.fileName ?? '')) {
         return;
      }
      const minWidth = codeContentSize(
         '',
         el.fontSize ?? CODE_FONT_SIZE,
         codeTitle({ fileName, language: el.language })
      ).width;
      await this.store.updateElement(id, {
         fileName,
         ...(minWidth > el.width ? { width: minWidth } : {}),
      });
   }

   /** Collapse a code block to its title bar, or restore it to its previous height. */
   async toggleCollapsed(id: string): Promise<void> {
      const el = this.store.elements().find((e) => e.id === id);
      if (el?.type !== 'code') {
         return;
      }
      if (el.expandedHeight != null) {
         await this.store.updateElement(id, { height: el.expandedHeight, expandedHeight: null });
      } else {
         const header = codeHeaderHeight(el.fontSize ?? CODE_FONT_SIZE);
         await this.store.updateElement(id, { height: header, expandedHeight: el.height });
      }
   }

   /** Prettier-format every selected code block to its card's width, growing the card taller to fit. */
   async format(ids: readonly string[]): Promise<void> {
      const blocks = this.store.elements().filter((e) => e.type === 'code' && ids.includes(e.id));
      for (const el of blocks) {
         try {
            const fontSize = el.fontSize ?? CODE_FONT_SIZE;
            // Re-flow to the card's current width: it grows taller, not wider.
            const text = await formatCode(el.text ?? '', el.language, codePrintWidth(el));
            const diffText =
               el.diffText != null ? await formatCode(el.diffText, el.language, codePrintWidth(el)) : undefined;
            if (text === (el.text ?? '') && diffText === el.diffText) {
               continue;
            }
            const size = codeDiffActive(el)
               ? codeElementContentSize({ ...el, text, diffText })
               : codeContentSize(text, fontSize, codeTitle(el));
            // A collapsed block keeps its title-bar height; only the text changes.
            await this.store.updateElement(el.id, {
               text,
               ...(diffText !== el.diffText ? { diffText } : {}),
               width: Math.max(el.width, size.width),
               ...(el.expandedHeight == null
                  ? { height: Math.max(el.height, size.height) }
                  : { expandedHeight: Math.max(el.expandedHeight, size.height) }),
            });
         } catch (err) {
            const message = err instanceof Error ? err.message : 'Could not format the code.';
            this.snackBar.open(`Couldn't format: ${message}`, undefined, { duration: 4000 });
         }
      }
   }

   /** Resize every selected code block to exactly fit its content (width and height, grow or shrink). */
   async fitToContent(ids: readonly string[]): Promise<void> {
      const blocks = this.store.elements().filter((e) => e.type === 'code' && ids.includes(e.id));
      for (const el of blocks) {
         const size = codeElementContentSize(el);
         if (size.width === el.width && size.height === el.height && el.expandedHeight == null) {
            continue;
         }
         // Fitting also expands a collapsed block.
         await this.store.updateElement(el.id, {
            width: size.width,
            height: size.height,
            ...(el.expandedHeight != null ? { expandedHeight: null } : {}),
         });
      }
   }
}
