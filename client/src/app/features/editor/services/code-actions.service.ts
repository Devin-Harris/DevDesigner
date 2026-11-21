import { languageForFileName } from '../helpers/code-highlight.helper';
import { Injectable, inject, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { CanvasElementModel, CodeDiffView } from '@devdesigner/shared';
import { ProjectStore } from '../state/project/project.store';
import { CodeFormatError, findFormatErrors, formatCode } from '../helpers/code-format.helper';

/** One line Format could not handle, underlined on the card. */
export interface FormatErrorMark {
   id: string;
   side: 'original' | 'modified';
   line: number;
   column?: number;
   source: string;
}
import {
   CODE_FONT_SIZE,
   codeContentSize,
   codeHeaderHeight,
   codeTitle,
   codeDiffActive,
   codeElementContentSize,
   codeDiffPrintWidths,
} from '../helpers/render';

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
      // Every patch is worked out from one snapshot up front, then applied as ONE undo
      // step: nothing reads the store half-way through a multi-block change.
      const wanted = new Set(ids);
      const patches = this.store
         .elements()
         .filter((e) => e.type === 'code' && wanted.has(e.id))
         .filter((el) => !((el.diffView ?? 'off') === view && (view === 'off' || el.diffText != null)))
         .map((el) => {
            const diffText = el.diffText ?? (view === 'off' ? undefined : (el.text ?? ''));
            const next: CanvasElementModel = { ...el, diffView: view, diffText };
            return {
               id: el.id,
               patch: {
                  diffView: view,
                  ...(el.diffText == null && diffText != null ? { diffText } : {}),
                  ...this.refit(el, next),
               },
            };
         });
      if (!patches.length) {
         return;
      }
      await this.store.batchHistory(async () => {
         await Promise.all(patches.map((p) => this.store.updateElement(p.id, p.patch)));
      });
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
      // Renaming to another extension switches the highlighting to match.
      const language = languageForFileName(fileName);
      await this.store.updateElement(id, {
         fileName,
         ...(language && language !== el.language ? { language } : {}),
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

   /**
    * Every line the last Format could not handle, each drawn as a red squiggle until that
    * side's code changes (`source` is the side's text it was reported against).
    */
   readonly formatErrors = signal<FormatErrorMark[]>([]);

   /**
    * Mark every failing line of one side (`err` is the first failure, used when the full
    * scan finds nothing better) and describe them in a snackbar.
    */
   async reportFormatErrors(
      el: CanvasElementModel,
      side: 'original' | 'modified',
      err: unknown,
      source: string,
      printWidth: number
   ): Promise<void> {
      const found = await findFormatErrors(source, el.language, printWidth);
      const errs = found.length ? found : [err];
      const marks: FormatErrorMark[] = [];
      for (const e of errs) {
         if (e instanceof CodeFormatError && e.line) marks.push({ id: el.id, side, line: e.line, column: e.column, source });
      }
      this.formatErrors.update((list) => [...list.filter((m) => !(m.id === el.id && m.side === side)), ...marks]);
      this.describeFormatError(el, side, errs[0], errs.length);
   }

   /** Snackbar text for a failed side: which side, the first line and reason, and how many more. */
   private describeFormatError(el: CanvasElementModel, side: 'original' | 'modified', err: unknown, count: number): void {
      const diff = codeDiffActive(el) || (side === 'modified' && el.diffText != null);
      const where = diff ? (side === 'original' ? 'Original (left) side' : 'Changed (right) side') : '';
      const reason =
         err instanceof CodeFormatError ? err.reason : err instanceof Error ? err.message : 'Could not format the code.';
      const line = err instanceof CodeFormatError ? err.line : undefined;
      const column = err instanceof CodeFormatError ? err.column : undefined;
      const at = line ? `line ${line}${column ? `, col ${column}` : ''}` : '';
      const prefix = [where, at].filter(Boolean).join(', ');
      const more = count > 1 ? ` (+${count - 1} more line${count > 2 ? 's' : ''} underlined)` : '';
      this.snackBar.open(`Couldn't format${prefix ? ` (${prefix})` : ''}: ${reason}${more}`, 'Dismiss', { duration: 8000 });
   }

   /**
    * Prettier-format every selected code block to its card's width without resizing the card.
    * Each side of a diff is formatted to the room it has as shown (half a split), so
    * setting a width and formatting fits the code to it, like a plain block.
    */
   async format(ids: readonly string[]): Promise<void> {
      const blocks = this.store.elements().filter((e) => e.type === 'code' && ids.includes(e.id));
      this.formatErrors.set([]);
      for (const el of blocks) {
         const widths = codeDiffPrintWidths(el);
         const side = async (which: 'original' | 'modified', source: string, width: number): Promise<string | null> => {
            try {
               return await formatCode(source, el.language, width);
            } catch (err) {
               await this.reportFormatErrors(el, which, err, source, width);
               return null;
            }
         };
         // Re-flow to the card's current width.
         // Both sides are checked even when one fails, so every bad line gets underlined.
         const text = await side('original', el.text ?? '', widths.original);
         const formattedDiff = el.diffText != null ? await side('modified', el.diffText, widths.modified) : undefined;
         if (text == null || formattedDiff === null) continue;
         const diffText = formattedDiff;
         if (text === (el.text ?? '') && diffText === el.diffText) {
            continue;
         }
         // Formatting never resizes the card: it fits the code to the bounds as best it can.
         await this.store.updateElement(el.id, { text, ...(diffText !== el.diffText ? { diffText } : {}) });
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
