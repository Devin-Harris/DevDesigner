// Public surface of the editor feature (docs/audits/03-code-cleanliness.md §2 A5).
// Hosts (workspace, share, guide, home, command palette) import the editor only from this file;
// eslint-plugin-boundaries rejects deep imports into features/editor from other features.

export { EditorComponent } from './editor.component';
export type { EditorTool } from './models/editor-tool.model';
export type { EditorEmbedApi, EditorHostOptions } from './models/editor-embed.model';

// The shell, command palette and realtime reach the editor through core/editor-bridge. Embedders drive a
// mounted editor through `EditorComponent.embed` (EditorEmbedApi) and style it through `hostOptions`
// (EditorHostOptions). The home showcase still injects ProjectStore to replay its build-up through the
// store's remote-apply path and renders deck-compare outside the editor, so the store stays providedIn: 'root'.
export { ProjectStore } from './state/project/project.store';

// Home showcase (§4.2 "home"): reuses the deck-compare view, code highlighting and table metrics.
// Pass 3 replaces these with an EditorEmbedApi / showcase variant.
export { DeckCompareComponent } from './features/slides/features/deck-compare/deck-compare.component';
export { CompareUiState } from './features/slides/features/deck-compare/services/compare-ui-state.service';
export { codePalette, tokenColor, tokenizeCode } from './helpers/code-highlight.helper';
export { columnAnchor } from './helpers/node-metrics.helper';

// Desktop sync's compare view (workspace/features/compare): draws two versions of a project with
// the export renderer and outlines the items that differ.
export { buildDiagramSvg, sequenceBounds } from './helpers/diagram-svg.helper';
export { elementBox } from './helpers/element-geometry.helper';
export { tableBox } from './helpers/node-metrics.helper';
export type { Box } from './models/geometry.model';
