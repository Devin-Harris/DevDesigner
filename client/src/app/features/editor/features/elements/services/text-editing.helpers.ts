import type { ElementRef, Signal } from '@angular/core';

/** What inline text editing reads from the editor entry; the entry wires it with `connect`. */
export interface TextEditingHost {
   /** The contenteditable of the rich text editor, while one is open. */
   readonly richEditorRef: Signal<ElementRef<HTMLDivElement> | undefined>;
}
