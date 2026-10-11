import { Injectable, signal } from '@angular/core';
import type { RunPatch } from '../../features/editor/canvas/helpers/rich-text.helper';

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

  open(id: string, apply: (patch: RunPatch) => void): void {
    this.editingId.set(id);
    this.applier = apply;
  }

  close(): void {
    this.editingId.set(null);
    this.selection.set(null);
    this.applier = null;
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
