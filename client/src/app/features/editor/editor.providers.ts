import type { Provider } from '@angular/core';
import { EditorShortcutsService } from './services/editor-shortcuts.service';
import { EditorExportService } from './features/export/services/editor-export.service';
import { MediaDropService } from './features/elements/services/media-drop.service';
import { ClipboardService } from './features/canvas/services/clipboard.service';
import { EditorViewportService } from './services/editor-viewport.service';
import { SlideshowService } from './features/slides/services/slideshow.service';
import { DeckFocusService } from './features/slides/services/deck-focus.service';
import { SlidePlacementService } from './features/slides/services/slide-placement.service';
import { FollowService } from './features/collaboration/services/follow.service';
import { TextEditingService } from './features/elements/services/text-editing.service';
import { CellEditorsService } from './features/elements/services/cell-editors.service';
import { PointerGestureService } from './services/pointer-gesture.service';
import { TableDragService } from './features/erd/services/table-drag.service';
import { RelationshipLinkService } from './features/erd/services/relationship-link.service';
import { EditorToolService } from './services/editor-tool.service';
import { CanvasViewService } from './services/canvas-view.service';
import { CanvasSnapService } from './services/canvas-snap.service';
import { LaserInputService } from './features/collaboration/services/laser-input.service';
import { GroupTransformService } from './features/elements/services/group-transform.service';
import { ElementGestureService } from './features/elements/services/element-gesture.service';
import { DrawToolService } from './features/elements/services/draw-tool.service';
import { DeckPanelsService } from './features/slides/services/deck-panels.service';
import { DeckLayoutSyncService } from './features/slides/services/deck-layout-sync.service';
import { SlideThumbnailsService } from './features/slides/services/slide-thumbnails.service';
import { CanvasDblClickService } from './features/elements/services/canvas-dblclick.service';
import { EditorPointerService } from './editor-pointer.service';
import { AlignService } from './services/align.service';
import { FloatingToolbarsService } from './features/elements/services/floating-toolbars.service';
import { RemotePresenceService } from './features/collaboration/services/remote-presence.service';
import { EditorBridgeService } from './editor-bridge.service';

/**
 * Everything one mounted editor owns, provided on the editor's own injector so two editors (the
 * workspace and an embedded guide/showcase editor) never share gesture, view or tool state.
 * ProjectStore stays `providedIn: 'root'` for now: the home showcase drives the store and renders
 * deck-compare outside the editor's injector (see docs/audits/03-code-cleanliness.md §4.4).
 */
export function provideEditor(): Provider[] {
   return [
      EditorShortcutsService,
      EditorExportService,
      MediaDropService,
      ClipboardService,
      EditorViewportService,
      SlideshowService,
      DeckFocusService,
      SlidePlacementService,
      FollowService,
      TextEditingService,
      CellEditorsService,
      PointerGestureService,
      TableDragService,
      RelationshipLinkService,
      EditorToolService,
      CanvasViewService,
      CanvasSnapService,
      LaserInputService,
      GroupTransformService,
      ElementGestureService,
      DrawToolService,
      DeckPanelsService,
      DeckLayoutSyncService,
      SlideThumbnailsService,
      CanvasDblClickService,
      EditorPointerService,
      AlignService,
      FloatingToolbarsService,
      RemotePresenceService,
      EditorBridgeService,
   ];
}
