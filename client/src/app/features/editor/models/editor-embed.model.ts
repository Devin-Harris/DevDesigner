import type { Signal } from '@angular/core';

/** How a host embeds the editor (C3.8). The workspace uses the defaults. */
export interface EditorHostOptions {
   /**
    * `full`: the normal editor. `picture`: a live picture of the canvas for showcases, with
    * no tool dock, minimap, laser layer, deck panels or selection chrome (the deck panels
    * come back while the transition screen is open). Disabled controls draw as live ones.
    */
   chrome?: 'full' | 'picture';
   /** Hide sequence-diagram messages (a showcase player reveals them one by one). */
   hideSequenceMessages?: boolean;
}

/** What an embedding host (home showcase, guide sandboxes) may drive on a mounted editor. */
export interface EditorEmbedApi {
   /** Open a deck's transition screen for the transition into slide `slide` (1-based). */
   showTransitionScreen(deck: string, slide: number, view?: 'map' | 'preview'): void;
   /** Close deck focus (and its transition screen). */
   leaveDeckFocus(): void;
   /** The transition screen's preview is playing. */
   readonly previewPlaying: Signal<boolean>;
   /** Play the preview (or pause / rewind it, like its ▶ / ↻ button). */
   togglePreviewPlay(): void;
}
