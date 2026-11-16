import { Injectable, signal } from '@angular/core';
import type { ListKind } from '../helpers/rich-list.helper';
import type { RunPatch } from '../../../helpers/rich-text.helper';

/** What the toolbar needs to know about the selection inside the rich-text editor. */
export interface RichSelectionState {
   bold: boolean;
   italic: boolean;
   underline: boolean;
   /** The color shared by the selection, or null when it is mixed. */
   color: string | null;
   /** The morph tag shared by the selection ('' when none or mixed). */
   morph: string;
   /** True when characters are selected (otherwise a patch targets the whole block). */
   hasRange: boolean;
   /** The list kind shared by the selected lines, or null. */
   list: ListKind | null;
}

/**
 * Bridge between the inline rich-text editor and the floating toolbar. While a
 * text element is being edited the editor publishes its selection style here and
 * registers `apply`; the toolbar then routes bold/italic/underline/color to the
 * selected characters instead of the whole element.
 */
@Injectable({ providedIn: 'root' })
export class RichTextSessionService {
   /** Id of the text element being edited, or null. */
   readonly editingId = signal<string | null>(null);
   readonly selection = signal<RichSelectionState | null>(null);
   private applier: ((patch: RunPatch) => void) | null = null;
   private listApplier: ((kind: ListKind) => void) | null = null;
   private inserter: ((text: string) => void) | null = null;

   open(
      id: string,
      apply: (patch: RunPatch) => void,
      list?: (kind: ListKind) => void,
      insert?: (text: string) => void
   ): void {
      this.editingId.set(id);
      this.applier = apply;
      this.listApplier = list ?? null;
      this.inserter = insert ?? null;
   }

   /** Type text at the caret (replacing the selection) in the text being edited. */
   insert(text: string): boolean {
      if (!this.inserter) {
         return false;
      }
      this.inserter(text);
      return true;
   }

   close(): void {
      this.editingId.set(null);
      this.selection.set(null);
      this.applier = null;
      this.listApplier = null;
      this.inserter = null;
   }

   /** Toggle a bulleted/numbered list on the selected lines. */
   toggleList(kind: ListKind): boolean {
      if (!this.listApplier) {
         return false;
      }
      this.listApplier(kind);
      return true;
   }

   /** Style the selected characters (or the whole block when nothing is selected). */
   apply(patch: RunPatch): boolean {
      if (!this.applier) {
         return false;
      }
      this.applier(patch);
      return true;
   }
}
