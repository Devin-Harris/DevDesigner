// Public surface of the editor feature (docs/audits/03-code-cleanliness.md §2 A5).
// Hosts (workspace, share, guide, home, command palette) import the editor only from this file;
// eslint-plugin-boundaries rejects deep imports into features/editor from other features.

export { EditorComponent } from './editor.component';
export type { EditorTool } from './models/editor-tool.model';

// Pass 3 (§4.1 #1, §4.4): ProjectStore moves behind provideEditor() and the shell/palette talk to the
// editor through core/editor-bridge instead. Until then hosts that read editor state inject it from here.
export { ProjectStore } from './state/project/project.store';

// Home showcase (§4.2 "home"): reuses the deck-compare view, code highlighting and table metrics.
// Pass 3 replaces these with an EditorEmbedApi / showcase variant.
export { DeckCompareComponent } from './features/slides/features/deck-compare/deck-compare.component';
export { CompareUiState } from './features/slides/features/deck-compare/services/compare-ui-state.service';
export { codePalette, tokenColor, tokenizeCode } from './helpers/code-highlight.helper';
export { columnAnchor } from './helpers/node-metrics.helper';
