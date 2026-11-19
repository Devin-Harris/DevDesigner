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
   /**
    * The selected object / pair in Map pairs, for the side panel's controls (the stage
    * publishes it with the actions it supports; null when nothing is selected).
    */
   readonly selection = signal<PairSelection | null>(null);
   /** The preview is playing (mirrored from the stage, for embedders). */
   readonly previewPlaying = signal(false);
   /** Bumped to press the preview's ▶ / ↻ button from outside (EditorEmbedApi). */
   readonly previewPlayRequests = signal(0);
}

export interface PairSelection {
   label: string;
   /** The object it morphs with on the other slide ('' when it has no partner). */
   partnerLabel: string;
   paired: boolean;
   forced: boolean;
   cut: boolean;
   solo: boolean;
   /** "Animate by" of the pair (stored on the later slide's object); null when unpaired. */
   animateBy: string | null;
   setAnimateBy(by: string): void;
   /** Don't morph: the objects fade out / in instead. */
   fade(): void;
   /** Remove a pairing made by hand. */
   unpair(): void;
   /** No transition at all: it switches instantly. */
   cut_(): void;
   reset(): void;
   done(): void;
}
