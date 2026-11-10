import { Injectable, signal } from '@angular/core';

/** Mapping state shared by the stage and the dock's pairs list (so the list highlights what you edit). */
@Injectable({ providedIn: 'root' })
export class CompareUiState {
   /** The object picked first (waiting for its partner on the other slide). */
   readonly armed = signal<{ side: 'a' | 'b'; key: string } | null>(null);
   /** The object under the pointer. */
   readonly lit = signal<string | null>(null);
   /** Stage view: map pairs on both slides, or a full-size preview. */
   readonly view = signal<'map' | 'preview'>('map');
}
