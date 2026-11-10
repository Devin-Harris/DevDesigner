import { TextEditingService } from './features/elements/services/text-editing.service';
import { CellEditorsService } from './features/elements/services/cell-editors.service';
import { DEFAULT_FONT_SIZE } from './helpers/render/text-layout';
import { SlidePlacementService } from './features/slides/services/slide-placement.service';
import { DeckFocusService } from './features/slides/services/deck-focus.service';
import { SlideshowService } from './features/slides/services/slideshow.service';
import { FollowService } from './features/collaboration/services/follow.service';
import type { SequenceStart } from './models/sequence-start.model';
import { EditorViewportService } from './services/editor-viewport.service';
import { MediaDropService } from './features/elements/services/media-drop.service';
import { ClipboardService } from './features/canvas/services/clipboard.service';
import { EditorExportService } from './features/export/services/editor-export.service';
import { EditorShortcutsService } from './services/editor-shortcuts.service';
import type { DragMode } from './models/drag-mode.model';
import {
   ChangeDetectionStrategy,
   Component,
   DestroyRef,
   ElementRef,
   HostListener,
   computed,
   effect,
   inject,
   input,
   signal,
   untracked,
   viewChild,
} from '@angular/core';
import { ToolbarPrefsService } from './features/toolbar/services/toolbar-prefs.service';
import { PenOptionsBarComponent } from './features/toolbar/components/pen-options-bar/pen-options-bar.component';
import { PenPrefsService } from './services/pen-prefs.service';
import { InspectorPanelService } from './services/inspector-panel.service';
import type { CanvasItemRef } from '../../core/editor-bridge/editor-actions.service';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { IconComponent } from '../../shared/ui/components/icon/icon.component';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import type {
   CanvasElementModel,
   CreateElementDto,
   ElementType,
   UpdateElementDto,
   RelationshipModel,
   RelationshipType,
   TableModel,
} from '@devdesigner/shared';
import {
   presentationOf,
   presentationSlides,
   type SequenceDiagramModel,
   layoutOf,
   layoutNameOf,
   isEmptyPlaceholder,
   placeholderPrompt,
   sequenceDiagramRect,
   resolveThemedElements,
   masterOf,
   DEFAULT_THEME,
   type SlideTheme,
} from '@devdesigner/shared';
import {
   boxToOuter,
   inBlock,
   slideView,
   slideViewTransform,
   type SlideView,
   toInner,
   toOuter,
} from './helpers/slide-zoom.helper';
import { LOCAL_LASER, LaserService } from '../../core/realtime/laser.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { type DeckSummary, EditorActionsService } from '../../core/editor-bridge/editor-actions.service';
import { FontMetricsService } from './services/font-metrics.service';
import type { ShapeView } from './models/shape-view.model';
import { ProjectFileService } from '../../shared/services/project-file.service';
import { isSandboxId } from '../../core/sandbox/sandbox-backend.service';
import { MediaActionsService } from './services/media-actions.service';
import { ImageCropOverlayComponent } from './features/elements/components/image-crop-overlay/image-crop-overlay.component';
import { ProjectsStore } from '../../shared/state/projects/projects.store';
import { ThemeService } from '../../core/theme/theme.service';
import {
   ProjectStore,
   elementToCreateDto,
   type ItemMoves,
   type SequenceLayoutSnapshot,
} from './state/project/project.store';
import { splitAtGaps } from './helpers/render';
import { AutofocusDirective } from '../../shared/ui/directives/autofocus.directive';
import { CodeActionsService } from './services/code-actions.service';
import { GridTableService } from './services/grid-table.service';
import {
   GRID_MIN_CELL,
   defaultGrid,
   gridInPixels,
   gridCellAt,
   parseGrid,
   serializeGrid,
} from './helpers/grid-table.helper';
import {
   CanvasConnectorsComponent,
   type EndpointDownEvent,
   type SegmentDownEvent,
} from './features/canvas/components/canvas-connectors/canvas-connectors.component';
import {
   CanvasShapesComponent,
   type ResizeDownEvent,
   type ResizeHandle,
   type ShapeBendEvent,
   type ShapeEndpointEvent,
   type ShapePointerEvent,
} from './features/canvas/components/canvas-shapes/canvas-shapes.component';
import { type AlignAction } from './models/toolbar-actions';
import { slotFollower, slotStyle, standInFor } from './helpers/layout-placeholders';
import { MinimapComponent, type MinimapItem } from './features/minimap/minimap.component';
import { NODE_WIDTH, SVG_OFFSET } from './shared/constants/canvas.constants';
import { ConnectorRouteCache, computeConnectors, segmentDrag } from './helpers/connectors.helper';
import { LAYOUT_Z_OFFSET, frameContents, sequenceDiagramBox } from './helpers/frame-contents.helper';
import { DEFAULT_FRAME_PRESET, framePreset } from './shared/constants/frame-presets';
import {
   absolutePoints,
   elementBox,
   sameBoxes,
   elementIntersectsRect,
   hitTestElement,
   isPathElement,
   tableBox,
   toRelative,
} from './helpers/element-geometry.helper';
import { chordNormal } from './helpers/freedraw-path.helper';
import { buildColumnLocations, columnAnchor, tableHeight, snapToGrid, tableWidth } from './helpers/node-metrics.helper';
import { messageLabelBoxes } from './helpers/message-box.helper';
import {
   buildShapeViews,
   ShapeViewCache,
   CODE_FONT_SIZE,
   codeDiffActive,
   codeDiffSplit,
   CODE_DOTS_WIDTH,
   codeHeaderHeight,
   gridRowNeeds,
   SURFACE_FILL,
} from './helpers/render';
import { fitTextElement, TEXT_MAX_FONT_SIZE, TEXT_MIN_FONT_SIZE } from './helpers/text-metrics';
import { elbowPath } from './helpers/svg-path.helper';
import { findLinkSnap, type LinkSnap } from './features/canvas/helpers/link-snap.helper';
import { smartSnap, smartSnapEdges, snapTargets, type SmartSnap } from './features/canvas/helpers/smart-guides.helper';
import type { Box, Point, Rect, Side } from './models/geometry.model';
import { ElementFloatingToolbarComponent } from './features/elements/components/element-floating-toolbar/element-floating-toolbar.component';
import { InspectorComponent } from './features/erd/components/inspector/inspector.component';
import { RelationshipInspectorComponent } from './features/erd/components/relationship-inspector/relationship-inspector.component';
import { ElementInspectorComponent } from './features/elements/components/element-inspector/element-inspector.component';
import { SequenceInspectorComponent } from './features/sequence-diagram/components/sequence-inspector/sequence-inspector.component';
import { SequenceMessageToolbarComponent } from './features/sequence-diagram/components/sequence-message-toolbar/sequence-message-toolbar.component';
import { SequenceParticipantToolbarComponent } from './features/sequence-diagram/components/sequence-participant-toolbar/sequence-participant-toolbar.component';
import { SequenceDiagramToolbarComponent } from './features/sequence-diagram/components/sequence-diagram-toolbar/sequence-diagram-toolbar.component';
import { CanvasSequenceComponent } from './features/canvas/components/canvas-sequence/canvas-sequence.component';
import { TableToolbarComponent } from './features/erd/components/table-toolbar/table-toolbar.component';
import { RelationshipToolbarComponent } from './features/erd/components/relationship-toolbar/relationship-toolbar.component';
import { MultiSelectBarComponent } from './features/elements/components/multi-select-bar/multi-select-bar.component';
import { LaserLayerComponent } from './features/collaboration/components/laser-layer/laser-layer.component';
import { ShapeToolbarComponent } from './features/toolbar/shape-toolbar.component';
import type { EditorTool } from './models/editor-tool.model';
import { ShareDialogComponent } from './features/share-dialog/share-dialog.component';
import { PresentModeComponent } from './features/slides/features/present/present-mode.component';
import { SlideRenderService } from './features/slides/services/slide-render.service';
import { ensureDeckDefaults } from './features/slides/helpers/deck-defaults';
import { SlidesPanelComponent } from './features/slides/features/slides-panel/slides-panel.component';
import type { SlidesCommand } from './features/slides/features/slides-panel/models/slides-command.model';
import { FocusUiState } from './features/slides/features/slides-panel/services/focus-ui-state.service';
import { PopoverTriggerDirective } from '../../shared/ui/directives/popover-trigger.directive';
import { DeckCompareComponent } from './features/slides/features/deck-compare/deck-compare.component';
import { CompareUiState } from './features/slides/features/deck-compare/services/compare-ui-state.service';
import { AnimationPaneComponent } from './features/slides/features/slides-panel/features/animation-pane/animation-pane.component';
import { TableNodeComponent, type HandleEvent } from './features/erd/components/table-node/table-node.component';
import { DEFAULT_ELEMENT_STROKE } from './shared/constants/canvas.constants';

interface ElementGesture {
   id: string;
   /** Starting geometry of the element(s) at gesture start (for delta math). */
   start: { x: number; y: number; width: number; height: number; angle: number };
   /** The element's full state at gesture start (for undo history). */
   snapshot: CanvasElementModel;
   /** Additional selected elements moved together (id -> start x/y), move only. */
   others?: Map<string, { x: number; y: number }>;
   /** Tables carried along by a moved frame (id -> start x/y). */
   tables?: Map<string, { x: number; y: number }>;
   /** Manual relationship routes between two carried tables (id -> start waypoints). */
   waypoints?: Map<string, { x: number; y: number }[]>;
   /** Sequence diagrams carried along by a moved frame (id -> start layout). */
   sequences?: Map<string, SequenceStart>;
   handle?: ResizeHandle;
   which?: 'start' | 'end';
   /** Original points (absolute) for an endpoint drag. */
   points?: { x: number; y: number }[];
}

/** A resize of several selected items at once: everything scales about one shared box. */
interface GroupResize {
   /** Handle being dragged (nw/ne/sw/se/n/s/e/w), mapped onto the group's box. */
   handle: string;
   box: { x0: number; y0: number; x1: number; y1: number };
   /** Element states at gesture start. */
   elements: CanvasElementModel[];
   diagrams: {
      id: string;
      start: SequenceStart;
      rowSpacing: number;
      before: SequenceLayoutSnapshot;
   }[];
}

interface RelinkState {
   relationshipId: string;
   which: 'source' | 'target';
}

/** Element kinds that can contain other items (a lone selection aligns to these). */
const CONTAINER_TYPES: ReadonlySet<string> = new Set(['frame', 'rectangle', 'ellipse', 'diamond']);
const GRID_SNAP_KEY = 'dd-grid-snap';
const SMART_GUIDES_KEY = 'dd-smart-guides';

function readFlag(key: string, fallback: boolean): boolean {
   try {
      const v = globalThis.localStorage?.getItem(key);
      return v == null ? fallback : v === '1';
   } catch {
      return fallback;
   }
}

function readStoredSmartGuides(): boolean {
   try {
      return globalThis.localStorage?.getItem(SMART_GUIDES_KEY) === '1';
   } catch {
      return false;
   }
}

function readStoredGrid(): boolean {
   try {
      return globalThis.localStorage?.getItem(GRID_SNAP_KEY) === '1';
   } catch {
      return false;
   }
}

/**
 * Canvas host and interaction orchestrator: pan/zoom, table dragging, multi
 * selection (modifier-click + marquee), relationship linking and endpoint
 * re-pointing, grid snap, and alignment. Rendering is delegated to child
 * components; the store is the single source of truth.
 *
 * Pan with middle-mouse or Space+drag; left-drag on empty canvas is a marquee.
 */
const dim = (v: ShapeView): ShapeView => ({ ...v, opacity: v.opacity * 0.5 });
const lock = (v: ShapeView): ShapeView => ({ ...v, locked: true });
/** `make(v)`, made once per view object. */
function variant(cache: WeakMap<ShapeView, ShapeView>, v: ShapeView, make: (v: ShapeView) => ShapeView): ShapeView {
   let out = cache.get(v);
   if (!out) {
      out = make(v);
      cache.set(v, out);
   }
   return out;
}

@Component({
   selector: 'dd-editor',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [
      ImageCropOverlayComponent,
      MatProgressSpinnerModule,
      IconComponent,
      MatTooltipModule,
      CanvasConnectorsComponent,
      CanvasShapesComponent,
      LaserLayerComponent,
      ShapeToolbarComponent,
      InspectorComponent,
      SequenceInspectorComponent,
      SequenceMessageToolbarComponent,
      SequenceParticipantToolbarComponent,
      SequenceDiagramToolbarComponent,
      MinimapComponent,
      CanvasSequenceComponent,
      ElementFloatingToolbarComponent,
      RelationshipInspectorComponent,
      ElementInspectorComponent,
      RelationshipToolbarComponent,
      MultiSelectBarComponent,
      PenOptionsBarComponent,
      DeckCompareComponent,
      PopoverTriggerDirective,
      AnimationPaneComponent,
      TableToolbarComponent,
      TableNodeComponent,
      AutofocusDirective,
      SlidesPanelComponent,
      PresentModeComponent,
   ],
   providers: [
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
   ],
   templateUrl: './editor.component.html',
   styleUrl: './editor.component.scss',
})
export class EditorComponent {
   protected readonly cellEditors = inject(CellEditorsService);
   protected readonly textEditing = inject(TextEditingService);
   protected readonly follow = inject(FollowService);
   protected readonly placement = inject(SlidePlacementService);
   protected readonly deckFocus = inject(DeckFocusService);
   protected readonly slideshow = inject(SlideshowService);
   protected readonly viewport = inject(EditorViewportService);
   protected readonly clipboard = inject(ClipboardService);
   protected readonly mediaDrop = inject(MediaDropService);
   protected readonly exporter = inject(EditorExportService);
   protected readonly shortcuts = inject(EditorShortcutsService);
   protected readonly store = inject(ProjectStore);
   protected readonly realtime = inject(RealtimeService);
   private readonly laser = inject(LaserService);
   protected readonly toolbarPrefs = inject(ToolbarPrefsService);
   private readonly penPrefs = inject(PenPrefsService);
   private readonly focusUi = inject(FocusUiState);
   protected readonly compareUi = inject(CompareUiState);
   /** The tool dock sits along the top edge (bars that would sit there move down). */
   protected readonly toolbarPosTop = computed(() => this.toolbarPrefs.position() === 'top');
   private readonly dialog = inject(MatDialog);
   private readonly projectFile = inject(ProjectFileService);
   private readonly projectsStore = inject(ProjectsStore);
   private readonly snackBar = inject(MatSnackBar);
   private readonly slideRender = inject(SlideRenderService);

   /** The slide sorter panel (slides / presentation mode). */
   /** Kept as a signal other code reads; the panel itself shows whenever a frame is selected. */
   protected readonly slidesOpen = signal(false);

   /** Details panel visibility (opened from a floating toolbar, or pinned). */
   protected readonly inspector = inject(InspectorPanelService);
   /** Something is selected that the details panel can show. */
   protected readonly hasInspectable = computed(
      () =>
         !!this.store.selectedTable() ||
         !!this.store.selectedRelationship() ||
         !!this.store.selectedElement() ||
         !!this.store.selectedLifeline() ||
         !!this.store.selectedMessage() ||
         !!this.store.selectedDiagram()
   );
   /** Identity of the current selection, so an unpinned panel closes when it changes. */
   private readonly selectionKey = computed(() =>
      [
         this.store.selectedTableIds().join(','),
         this.store.selectedElementIds().join(','),
         this.store.selectedLifelineIds().join(','),
         this.store.selectedMessageIds().join(','),
         this.store.selectedDiagramIds().join(','),
         this.store.selectedRelationship()?.id ?? '',
      ].join('|')
   );

   /** The slide being shown/edited; it is the only slide on the canvas. */
   protected readonly activeSlideId = this.store.activeSlideId;

   /** What the canvas leaves out because it belongs to another (stacked) slide. */
   protected readonly focusHidden = this.store.hiddenBySlides;

   /** The elements on the canvas right now (not collapsed away with another slide). */
   private shownElements(): CanvasElementModel[] {
      const hide = this.focusHidden();
      const locked = this.store.layoutItemIds();
      return this.store.elements().filter((e) => !hide?.elementIds.has(e.id) && !locked.has(e.id));
   }

   /** Tables that are on the canvas right now (focus mode collapses other slides' tables). */
   protected readonly visibleTables = computed(() => {
      const hide = this.focusHidden();
      const tables = this.store.tables();
      return hide ? tables.filter((t) => !hide.tableIds.has(t.id)) : tables;
   });

   /** Sequence diagrams hidden by focus mode. */
   protected readonly hiddenDiagramIds = computed<ReadonlySet<string> | null>(
      () => this.focusHidden()?.diagramIds ?? null
   );

   /**
    * Slides zoomed out inside their block (Ctrl + scroll over a shown slide). Their frame
    * and items are drawn in a layer of their own, scaled about the frame's centre and
    * clipped to the block, so the staging room around the frame shows.
    */
   readonly slideViews = computed<SlideView[]>(() => {
      // Every shown slide is drawn through its block, also at scale 1: the block is a
      // window onto the slide, so items staged outside the frame only show zoomed out.
      const zoom = this.store.slideZoom();
      const frames = this.store.slideFrames();
      return [...this.store.shownByPresentation()].flatMap(([name, id]) => {
         const frame = frames.find((f) => f.id === id);
         return frame ? [slideView(frame, name, zoom[name] ?? 1)] : [];
      });
   });

   /** Which zoomed slide view draws each item (frame + what the slide owns), by kind. */
   private readonly zoomedItems = computed(() => {
      const views = new Map(this.slideViews().map((v) => [v.frameId, v]));
      const elements = new Map<string, SlideView>();
      const tables = new Map<string, SlideView>();
      const diagrams = new Map<string, SlideView>();
      // A shape being drawn inside a zoomed slide is drawn there before it is saved.
      const draft = this.draft();
      const draftView = draft ? views.get(this.drawSlideId() ?? '') : undefined;
      if (draft && draftView) elements.set(draft.id, draftView);
      if (views.size) {
         // A zoomed slide's layout and master items are drawn in its layer too, beneath its own.
         const frames = this.store.slideFrames();
         const layoutViews = new Map<string, SlideView>();
         for (const f of frames) {
            const v = views.get(f.id);
            if (!v) continue;
            for (const u of [layoutOf(f, frames), masterOf(f, frames)]) {
               if (u && !views.has(u.id) && !layoutViews.has(u.id)) layoutViews.set(u.id, v);
            }
         }
         const locked = this.store.layoutItemIds();
         for (const e of this.store.elements()) {
            // The frame joins its layer only zoomed out: at scale 1 its title strip and
            // handles sit on or past the block's edge, where the layer clips.
            const own = views.get(e.id);
            const v =
               own && own.scale < 1
                  ? own
                  : e.slideId
                    ? (views.get(e.slideId) ?? (locked.has(e.id) ? layoutViews.get(e.slideId) : undefined))
                    : undefined;
            if (v) elements.set(e.id, v);
         }
         for (const t of this.store.tables()) {
            const v = t.slideId ? views.get(t.slideId) : undefined;
            if (v) tables.set(t.id, v);
         }
         for (const d of this.store.sequenceDiagrams()) {
            const v = d.slideId ? views.get(d.slideId) : undefined;
            if (v) diagrams.set(d.id, v);
         }
      }
      return { elements, tables, diagrams };
   });

   /** The zoomed-out slide the current drawing gesture started in (its draft is drawn there). */
   private readonly drawSlideId = signal<string | null>(null);

   /** The zoomed slide view an item is drawn in, if any. */
   private viewOf(id: string): SlideView | undefined {
      const z = this.zoomedItems();
      return z.elements.get(id) ?? z.tables.get(id) ?? z.diagrams.get(id);
   }

   /**
    * Slide zoom an item is drawn at (1 on the plain canvas). The slide frame itself is
    * the block: moving it moves the whole presentation at canvas scale.
    */
   private itemScale(id: string): number {
      const v = this.viewOf(id);
      return v && v.frameId !== id ? v.scale : 1;
   }

   /**
    * The viewport an item is effectively drawn through: the canvas viewport, composed
    * with its slide's zoom when it sits in a zoomed-out slide. For overlays placed in
    * screen px over an item (inline text / cell editors).
    */
   viewportFor(id: string): { x: number; y: number; zoom: number } {
      const v = this.store.viewport();
      const view = this.viewOf(id);
      if (!view) return v;
      return {
         x: v.x + view.cx * (1 - view.scale) * v.zoom,
         y: v.y + view.cy * (1 - view.scale) * v.zoom,
         zoom: v.zoom * view.scale,
      };
   }

   /** An item's box as drawn on the canvas (through its slide's zoom, if any). */
   drawnBox(id: string, box: Box): Box {
      const view = this.viewOf(id);
      return view ? boxToOuter(view, box) : box;
   }

   /**
    * A canvas rect as seen through a slide's block: clipped to the block and mapped into
    * the slide's coordinates; null when it misses the block (nothing there is visible).
    */
   private rectThrough(view: SlideView, rect: Rect): Rect | null {
      const k = view.block;
      const x0 = Math.max(rect.minX, k.x0);
      const y0 = Math.max(rect.minY, k.y0);
      const x1 = Math.min(rect.maxX, k.x1);
      const y1 = Math.min(rect.maxY, k.y1);
      if (x0 > x1 || y0 > y1) return null;
      const p = toInner(view, { x: x0, y: y0 });
      const q = toInner(view, { x: x1, y: y1 });
      return { minX: p.x, minY: p.y, maxX: q.x, maxY: q.y };
   }

   /** Tables drawn on the canvas itself (not inside a zoomed slide). */
   protected readonly outerTables = computed(() => {
      const z = this.zoomedItems().tables;
      const all = this.visibleTables();
      return z.size ? all.filter((t) => !z.has(t.id)) : all;
   });

   protected readonly outerShapeViews = computed(() => {
      const z = this.zoomedItems().elements;
      const all = this.shapeViews();
      return z.size ? all.filter((v) => !z.has(v.id)) : all;
   });

   /** Relationship lines between two tables of the same zoomed slide are drawn inside it. */
   private readonly zoomedConnectorIds = computed(() => {
      const out = new Map<string, SlideView>();
      const z = this.zoomedItems().tables;
      if (!z.size) return out;
      const tableOf = new Map<string, string>();
      for (const t of this.store.tables()) for (const c of t.columns) tableOf.set(c.id, t.id);
      for (const r of this.store.relationships()) {
         const a = z.get(tableOf.get(r.sourceColumnId) ?? '');
         const b = z.get(tableOf.get(r.targetColumnId) ?? '');
         if (a && a === b) out.set(r.id, a);
      }
      return out;
   });

   protected readonly outerConnectors = computed(() => {
      const z = this.zoomedConnectorIds();
      const all = this.displayConnectors();
      return z.size ? all.filter((c) => !z.has(c.id)) : all;
   });

   protected readonly outerHiddenDiagramIds = computed<ReadonlySet<string> | null>(() => {
      const z = this.zoomedItems().diagrams;
      const hidden = this.hiddenDiagramIds();
      return z.size ? new Set([...(hidden ?? []), ...z.keys()]) : hidden;
   });

   /** Everything each zoomed slide view draws, for its own set of layers. */
   protected readonly slideViewLayers = computed(() => {
      const z = this.zoomedItems();
      const conn = this.zoomedConnectorIds();
      const shapes = this.shapeViews();
      const tables = this.visibleTables();
      const connectors = this.displayConnectors();
      const hidden = this.hiddenDiagramIds();
      const diagrams = this.store.sequenceDiagrams();
      return this.slideViews().map((v) => ({
         view: v,
         transform: slideViewTransform(v),
         left: v.block.x0,
         top: v.block.y0,
         width: v.block.x1 - v.block.x0,
         height: v.block.y1 - v.block.y0,
         shapes: shapes.filter((s) => z.elements.get(s.id) === v),
         tables: tables.filter((t) => z.tables.get(t.id) === v),
         connectors: connectors.filter((c) => conn.get(c.id) === v),
         hiddenDiagramIds: new Set(
            diagrams.filter((d) => z.diagrams.get(d.id) !== v || hidden?.has(d.id)).map((d) => d.id)
         ) as ReadonlySet<string>,
         toWorld: (clientX: number, clientY: number) => toInner(v, this.viewport.toWorldRaw(clientX, clientY)),
      }));
   });

   /** Panels hug the frame: this is the gap to its edge, and the outline's padding. */
   private static readonly PANEL_GAP = 8;
   private static readonly PANEL_PAD = 6;
   /** Smallest outline padding on screen, so the dashed border clears the panels at any zoom. */
   private static readonly PANEL_MIN_PAD_PX = 2;
   /** The panels' own corner radius (world units); the outline's is concentric with it. */
   private static readonly PANEL_RADIUS = 14;
   private static readonly LIST_W = 296;
   private static readonly SETTINGS_W = 400;
   private static readonly FOLDED_W = 44;
   /** As tall as the frame on screen, but never so short that the panel stops being usable. */
   private static readonly PANEL_MIN_H = 320;

   /**
    * The panels are part of the frame's world: laid out in world units (width fixed,
    * height = the frame's) and scaled by the zoom with a CSS transform, so they keep
    * the same proportion to the frame at every zoom. `width`/`height` are the
    * unscaled world size the element is given; `scale` is applied around the top-left.
    */
   /**
    * One block per presentation: its shown slide's frame with the slide list pinned
    * to its left edge, the settings pinned to its right, and a border around all
    * three. Each presentation is a self-contained set at its own spot.
    */
   /** World-space box of each presentation's dashed outline (list + frame + settings, as laid out in slideSets). */
   private presentationOutlineBoxes(): { frameId: string; box: Box }[] {
      const gap = EditorComponent.PANEL_GAP;
      const zoom = this.store.viewport().zoom;
      const pad = Math.max(EditorComponent.PANEL_PAD, EditorComponent.PANEL_MIN_PAD_PX / zoom);
      const frames = this.store.slideFrames();
      const shown = this.store.shownByPresentation();
      const settingsW = this.deckFocus.settingsFolded() ? EditorComponent.FOLDED_W : EditorComponent.SETTINGS_W;
      return this.store.presentations().flatMap((name) => {
         const f = frames.find((fr) => fr.id === shown.get(name));
         if (!f) return [];
         const y0 = f.y;
         const y1 = f.y + Math.max(f.height, EditorComponent.PANEL_MIN_H);
         return [
            {
               frameId: f.id,
               box: {
                  x0: f.x - gap - EditorComponent.LIST_W - pad,
                  y0: y0 - pad,
                  x1: f.x + f.width + gap + settingsW + pad,
                  y1: y1 + pad,
               },
            },
         ];
      });
   }

   protected readonly slideSets = computed(() => {
      const v = this.store.viewport();
      const gap = EditorComponent.PANEL_GAP;
      const frames = this.store.slideFrames();
      const shown = this.store.shownByPresentation();
      const folded = this.deckFocus.settingsFolded();
      return this.store.presentations().flatMap((name) => {
         const frame = frames.find((f) => f.id === shown.get(name));
         if (!frame) {
            return [];
         }
         const top = frame.y * v.zoom + v.y;
         const height = Math.max(frame.height, EditorComponent.PANEL_MIN_H);
         const list = {
            left: (frame.x - EditorComponent.LIST_W - gap) * v.zoom + v.x,
            top,
            width: EditorComponent.LIST_W,
            height,
            scale: v.zoom,
         };
         const settings = {
            left: (frame.x + frame.width + gap) * v.zoom + v.x,
            top,
            width: folded ? EditorComponent.FOLDED_W : EditorComponent.SETTINGS_W,
            height,
            scale: v.zoom,
         };
         // Padding and corner radius scale with the panels so the outline keeps the same
         // shape at every zoom; only the hairline border stays in screen px, so keep just
         // enough padding for it to clear the panels.
         const pad = Math.max(EditorComponent.PANEL_PAD * v.zoom, EditorComponent.PANEL_MIN_PAD_PX);
         const radius = EditorComponent.PANEL_RADIUS * v.zoom + pad;
         const bottom = top + height * v.zoom;
         return [
            {
               name,
               frameId: frame.id,
               list,
               settings,
               // While a layout is shown, it is ringed and labelled so it is not mistaken for a slide.
               layoutEdit: frame.slide?.layout
                  ? {
                       left: frame.x * v.zoom + v.x,
                       top,
                       width: frame.width * v.zoom,
                       height: frame.height * v.zoom,
                       name: frame.slide.master ? 'Master' : layoutNameOf(frame, frames),
                       master: !!frame.slide.master,
                    }
                  : null,
               outline: {
                  left: list.left - pad,
                  top: top - pad,
                  width: settings.left + settings.width * v.zoom - list.left + pad * 2,
                  height: bottom - top + pad * 2,
                  radius,
               },
            },
         ];
      });
   });

   /**
    * The presentations selected as a whole (outer border clicked, or enclosed by a
    * marquee): drawn with a selected outline, and Delete removes every slide of them.
    */
   readonly selectedSlideSets = signal<string[]>([]);

   /**
    * Pointer down on a slide set's outer border: select the whole presentation and grab
    * its shown slide frame (it carries its contents; the other slides follow it).
    */
   protected onSlideBorderDown(name: string, frameId: string, event: PointerEvent): void {
      if (event.button !== 0 || !this.shapesInteractive()) {
         return;
      }
      event.stopPropagation();
      this.store.selectPresentation(name);
      // Grabbing one of several selected presentations moves them all, still selected.
      const sets = this.selectedSlideSets();
      const keep = sets.includes(name) && !EditorComponent.additive(event);
      this.onElementPointerDown({ id: frameId, event });
      this.selectedSlideSets.set(keep ? sets : [name]);
   }

   /** Touching a presentation's panels makes it the selected one (F5, export). */
   selectSlideSet(name: string): void {
      this.store.selectPresentation(name);
   }
   private readonly destroyRef = inject(DestroyRef);
   private readonly editorActions = inject(EditorActionsService);
   private readonly fontMetrics = inject(FontMetricsService);
   private readonly theme = inject(ThemeService);
   protected readonly svgOffset = SVG_OFFSET;

   /** Owner/anonymous mode passes a project id; shared mode passes a token instead. */
   readonly projectId = input<string | null>(null);
   readonly shareToken = input<string | null>(null);
   /** Embedded use (the canvas guide): frame the content once after it loads, at most 100%. */
   readonly fitOnLoad = input(false);
   private fittedProjectId: string | null = null;
   private homeAppliedFor: string | null = null;
   /** Embedded use: the tool to have active once the project loads (e.g. the guide's current tool). */
   readonly initialTool = input<EditorTool | null>(null);
   private toolAppliedFor: string | null = null;
   readonly canvasRef = viewChild.required<ElementRef<HTMLDivElement>>('canvas');

   /** Other participants' cursors projected to screen coordinates for rendering. */
   protected readonly remoteCursors = computed(() => {
      const v = this.store.viewport();
      return this.realtime.remoteCursors().map((c) => ({
         id: c.participantId,
         name: c.name,
         color: c.color,
         left: c.x * v.zoom + v.x,
         top: c.y * v.zoom + v.y,
      }));
   });

   /** Highlight rings (world coords) for tables another participant has selected. */
   protected readonly remoteTableHighlights = computed(() => {
      const highlights = this.realtime.tableHighlights();
      const rings: {
         id: string;
         x: number;
         y: number;
         width: number;
         height: number;
         color: string;
      }[] = [];
      for (const table of this.store.tables()) {
         const colors = highlights[table.id];
         if (colors?.length) {
            rings.push({
               id: table.id,
               x: table.x,
               y: table.y,
               width: tableWidth(table),
               height: tableHeight(table),
               color: colors[0],
            });
         }
      }
      return rings;
   });

   readonly gridSnap = signal(readStoredGrid());
   /** Snap drags to nearby items' edges, centers and spacing (Figma-style guides). */
   protected readonly smartGuides = signal(readStoredSmartGuides());
   /** What the moving selection snaps against, captured when a drag starts. */
   private smartBase: { box: Box; parts: Box[]; targets: Box[]; view?: SlideView } | null = null;
   /** Guides for the current drag, in world (or slide-inner) coordinates. */
   private readonly smartSnapState = signal<{ snap: SmartSnap; view?: SlideView } | null>(null);
   /** The current drag's guides in canvas-screen px, for the overlay. */
   protected readonly smartGuideMarks = computed(() => {
      const st = this.smartSnapState();
      if (!st) return null;
      const v = this.store.viewport();
      const sp = (x: number, y: number) => {
         const p = st.view ? toOuter(st.view, { x, y }) : { x, y };
         return { x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y };
      };
      const seg = (axis: 'x' | 'y', pos: number, a: number, b: number) => {
         const p = axis === 'x' ? sp(pos, a) : sp(a, pos);
         const q = axis === 'x' ? sp(pos, b) : sp(b, pos);
         return { x1: p.x, y1: p.y, x2: q.x, y2: q.y };
      };
      return {
         lines: st.snap.guides.map((g) => seg(g.axis, g.pos, g.from, g.to)),
         gaps: st.snap.gaps.map((g) => {
            // A gap along x is a horizontal segment at y = cross.
            const s = seg(g.axis === 'x' ? 'y' : 'x', g.cross, g.a, g.b);
            const label = String(Math.round(g.b - g.a));
            const horiz = g.axis === 'x';
            const lx = (s.x1 + s.x2) / 2;
            const ly = (s.y1 + s.y2) / 2;
            const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
            // Room the label needs along the line (text width, or its height when vertical).
            const half = horiz ? label.length * 3.2 + 4 : 9;
            const T = 3; // end-tick half length
            const ticks = horiz
               ? [
                    { x1: s.x1, y1: s.y1 - T, x2: s.x1, y2: s.y1 + T },
                    { x1: s.x2, y1: s.y2 - T, x2: s.x2, y2: s.y2 + T },
                 ]
               : [
                    { x1: s.x1 - T, y1: s.y1, x2: s.x1 + T, y2: s.y1 },
                    { x1: s.x2 - T, y1: s.y2, x2: s.x2 + T, y2: s.y2 },
                 ];
            if (len > 2 * half + 6) {
               // Two lines: element -> label, label -> next element.
               const segs = horiz
                  ? [
                       { x1: s.x1, y1: ly, x2: lx - half, y2: ly },
                       { x1: lx + half, y1: ly, x2: s.x2, y2: ly },
                    ]
                  : [
                       { x1: lx, y1: s.y1, x2: lx, y2: ly - half },
                       { x1: lx, y1: ly + half, x2: lx, y2: s.y2 },
                    ];
               return { segs: [...segs, ...ticks], label, lx, ly };
            }
            // Too tight for the label inline: keep the line whole and set the label beside it.
            return { segs: [s, ...ticks], label, lx: horiz ? lx : lx + half + 4, ly: horiz ? ly - 9 : ly };
         }),
      };
   });

   /** The image element being cropped inline (crop overlay), while it still exists. */
   protected readonly croppingElement = computed(() => {
      const id = this.mediaActions.croppingId();
      return id ? (this.store.elements().find((e) => e.id === id && e.type === 'image') ?? null) : null;
   });
   protected readonly saveLabel = computed(() => {
      switch (this.store.saveStatus()) {
         case 'saving':
            return 'Saving...';
         case 'saved':
            return 'Saved';
         case 'error':
            return 'Save failed';
         default:
            return '';
      }
   });

   readonly columnLocations = computed(() => buildColumnLocations(this.store.tables()));

   /** Frame boxes (connectors stay inside a shared frame); unchanged unless a frame moves or resizes. */
   private readonly frameBoxes = computed(
      () =>
         this.store
            .elements()
            .filter((e) => e.type === 'frame')
            .map(elementBox),
      { equal: sameBoxes }
   );

   protected readonly connectors = computed(() =>
      computeConnectors(
         this.visibleTables(),
         this.store.relationships(),
         new Set(this.store.selectedRelationshipIds()),
         this.frameBoxes(),
         this.connectorRoutes
      )
   );
   /** Routes of relationships nothing moved around since the last pass (see computeConnectors). */
   private readonly connectorRoutes = new ConnectorRouteCache();

   // --- drawing tools / canvas elements ---

   /** The active tool. 'select' is the pointer mode; others draw that element. */
   readonly activeTool = signal<EditorTool>('select');
   /** Aspect-ratio preset new frames are drawn with (see frame-presets). */
   protected readonly framePresetId = signal<string>(DEFAULT_FRAME_PRESET);

   /** True while a pan gesture is active (hand tool, middle-mouse, or space-drag). */
   protected readonly panning = signal(false);

   /**
    * Canvas cursor driven by the active tool and pan state: a crosshair for the
    * drawing tools (Excalidraw-style), grab/grabbing for the hand/pan tool, and
    * the default pointer for select.
    */
   protected readonly canvasCursor = computed(() => {
      if (this.panning()) {
         return 'grabbing';
      }
      const tool = this.activeTool();
      if (tool === 'hand') {
         return 'grab';
      }
      if (tool === 'select') {
         return 'default';
      }
      if (tool === 'freedraw' && this.penPrefs.eraser()) {
         // A ring the size of the eraser's reach (browsers cap cursors at 128px).
         const d = Math.min(126, Math.max(6, Math.round(this.penPrefs.eraserSize())));
         const c = d / 2 + 1;
         return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${d + 2}' height='${d + 2}'%3E%3Ccircle cx='${c}' cy='${c}' r='${d / 2}' fill='rgba(255,255,255,0.35)' stroke='black' stroke-width='1'/%3E%3C/svg%3E") ${c} ${c}, cell`;
      }
      return 'crosshair';
   });

   /** The element currently being drawn (local only until committed on pointer-up). */
   private readonly draft = signal<CanvasElementModel | null>(null);
   private elementGesture: ElementGesture | null = null;
   /** Non-table selection members dragged along when a table is grabbed (groups, mixed selections). */
   private nodeExtras: {
      elements: Map<string, { x: number; y: number }>;
      sequences: Map<string, SequenceStart>;
   } | null = null;

   /** Box of the shape/table an arrow endpoint will bind to (drawn as a highlight). */
   protected readonly bindHighlight = signal<{
      x: number;
      y: number;
      width: number;
      height: number;
   } | null>(null);

   /** True while an element gesture is in progress, so the floating toolbar hides. */
   private readonly gestureActive = signal(false);

   /** Placement + representative element for the floating context toolbar. */
   protected readonly elementToolbar = computed(() => {
      // Shown whenever element(s) are selected and no gesture/text-edit is active,
      // even while a draw tool stays active (drawing a shape selects it).
      const editingId = this.textEditing.editingTextId();
      const richEditing = !!editingId && this.store.elements().find((e) => e.id === editingId)?.type === 'text';
      if ((editingId && !richEditing) || this.gestureActive()) {
         return null;
      }
      const ids = this.store.selectedElementIds();
      if (!ids.length) {
         return null;
      }
      const idSet = new Set(ids);
      const els = this.store.elements().filter((e) => idSet.has(e.id));
      if (!els.length) {
         return null;
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const e of els) {
         const b = this.drawnBox(e.id, elementBox(e));
         minX = Math.min(minX, b.x0);
         minY = Math.min(minY, b.y0);
         maxX = Math.max(maxX, b.x1);
         maxY = Math.max(maxY, b.y1);
      }
      const v = this.store.viewport();
      // Clear the rotate handle (sits ~24px above the top edge) so the bar never
      // covers it; when there is no room above, flip the bar below the selection.
      const ROTATE_CLEAR = 24;
      const BAR = 52;
      const above = minY * v.zoom + v.y - ROTATE_CLEAR * v.zoom - BAR;
      const below = maxY * v.zoom + v.y + 16;
      return {
         left: ((minX + maxX) / 2) * v.zoom + v.x,
         top: above >= 8 ? above : below,
         element: els[0],
      };
   });

   /**
    * Placement for the multi-select bar: under the union box of 2+ selected units
    * (or a single selected group, so it can be ungrouped).
    */
   protected readonly multiSelectBar = computed(() => {
      if (this.gestureActive() || !this.store.canEdit() || this.textEditing.editingTextId()) {
         return null;
      }
      const byItem = this.store.groupByItem();
      const entered = this.store.enteredGroupId();
      const ids = [
         ...this.store.selectedTableIds(),
         ...this.store.selectedElementIds(),
         ...this.store.selectedDiagramIds(),
      ];
      const units = new Set(
         ids.map((id) => {
            const g = byItem.get(id);
            return g && g !== entered ? g : id;
         })
      );
      const grouped = units.size === 1 && ids.length > 1 && [...units][0] !== ids[0];
      if (units.size < 2 && !grouped) {
         return null;
      }
      const selected = new Set(ids);
      let x0 = Infinity,
         y0 = Infinity,
         x1 = -Infinity,
         y1 = -Infinity;
      const grow = (b: Box): void => {
         x0 = Math.min(x0, b.x0);
         y0 = Math.min(y0, b.y0);
         x1 = Math.max(x1, b.x1);
         y1 = Math.max(y1, b.y1);
      };
      for (const t of this.store.tables()) if (selected.has(t.id)) grow(tableBox(t));
      for (const e of this.store.elements()) if (selected.has(e.id)) grow(this.drawnBox(e.id, elementBox(e)));
      for (const d of this.store.sequenceDiagrams()) {
         const b = selected.has(d.id) ? this.diagramBox(d) : null;
         if (b) grow({ x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY });
      }
      if (!Number.isFinite(x0)) {
         return null;
      }
      const v = this.store.viewport();
      const below = y1 * v.zoom + v.y + 14;
      const maxTop = (this.viewport.canvasSize().height || window.innerHeight) - 110;
      return {
         left: ((x0 + x1) / 2) * v.zoom + v.x,
         top: Math.min(below, maxTop),
         count: grouped ? ids.length : units.size,
         grouped,
      };
   });

   /** Bottom-right minimap visibility (remembered per browser). */
   protected readonly showMinimap = signal(readFlag('devdesigner.minimap', true));
   protected toggleMinimap(): void {
      const on = !this.showMinimap();
      this.showMinimap.set(on);
      try {
         globalThis.localStorage?.setItem('devdesigner.minimap', on ? '1' : '0');
      } catch {
         // storage unavailable
      }
   }

   protected duplicateSelectionInPlace(): void {
      this.clipboard.copySelection();
      void this.clipboard.pasteClipboard();
   }

   /** Placement + table for the floating table action bar (single table selected). */
   protected readonly tableToolbar = computed(() => {
      if (this.gestureActive()) {
         return null;
      }
      const table = this.store.selectedTable();
      if (!table) {
         return null;
      }
      const v = this.store.viewport();
      return {
         left: (table.x + tableWidth(table) / 2) * v.zoom + v.x,
         top: Math.max(table.y * v.zoom + v.y - 52, 8),
         table,
      };
   });

   /** Placement for the floating contextual bar over the selected sequence message. */
   protected readonly sequenceMessageToolbar = computed(() => {
      const m = this.store.selectedMessage();
      if (!m) {
         return null;
      }
      const d = this.store.sequenceDiagrams().find((x) => x.id === m.diagramId);
      if (!d) {
         return null;
      }
      const lls = this.store.lifelines();
      const base = d.originY + d.headerHeight;
      const row = Math.max(1, Math.round((m.y - base) / d.rowSpacing));
      const y = base + d.rowSpacing * row;
      let midX: number;
      const from = lls.find((l) => l.id === m.fromLifelineId);
      const to = lls.find((l) => l.id === m.toLifelineId);
      if (m.style === 'break' || !from || !to) {
         const own = lls.filter((l) => l.diagramId === m.diagramId);
         if (!own.length) return null;
         const minX = Math.min(...own.map((l) => l.x));
         const maxX = Math.max(...own.map((l) => l.x));
         midX = (minX + maxX) / 2;
      } else {
         midX = (from.x + to.x) / 2;
      }
      const v = this.store.viewport();
      return { left: midX * v.zoom + v.x, top: y * v.zoom + v.y };
   });

   /** Placement for the floating participant (lifeline) toolbar, above its header. */
   protected readonly sequenceParticipantToolbar = computed(() => {
      const l = this.store.selectedLifeline();
      if (!l) {
         return null;
      }
      const d = this.store.sequenceDiagrams().find((x) => x.id === l.diagramId);
      if (!d) {
         return null;
      }
      const v = this.store.viewport();
      return { left: l.x * v.zoom + v.x, top: d.originY * v.zoom + v.y };
   });

   /** Screen anchor (top-center of the box) for the selected sequence diagram's toolbar. */
   protected readonly sequenceDiagramToolbar = computed(() => {
      const d = this.store.selectedDiagram();
      if (!d || this.store.selectedLifeline() || this.store.selectedMessage()) {
         return null;
      }
      const r = sequenceDiagramRect(d, this.store.lifelines(), this.store.sequenceMessages());
      if (!r) {
         return null;
      }
      const v = this.store.viewport();
      return { left: (r.x + r.w / 2) * v.zoom + v.x, top: r.y * v.zoom + v.y };
   });

   /** World boxes of sequence message labels: anchor targets for lines/arrows. */
   private readonly messageBoxes = computed(() =>
      messageLabelBoxes(this.store.sequenceDiagrams(), this.store.lifelines(), this.store.sequenceMessages())
   );

   /**
    * Stacking of sequence diagrams against drawing elements. A diagram with a
    * zIndex at or below the topmost element sits among the content shapes (the
    * content layer is split into slices around each such diagram); one above
    * every element also clears the table nodes. Table nodes stay at z 400;
    * elements flagged `aboveTables` draw in their own slice at z 401.
    */
   protected readonly diagramLayers = computed(() => {
      const els = this.store.elements().filter((e) => e.type !== 'frame');
      const maxZ = els.reduce((m, e) => Math.max(m, e.zIndex), -Infinity);
      const sorted = [...this.store.sequenceDiagrams()].sort((a, b) => a.zIndex - b.zIndex);
      const among = sorted.filter((d) => d.zIndex <= maxZ);
      const z = new Map<string, number>();
      among.forEach((d, i) => z.set(d.id, 11 + 2 * i));
      // 401 is the above-tables content slice (elements brought in front of the ERD).
      sorted.filter((d) => d.zIndex > maxZ).forEach((d, i) => z.set(d.id, 402 + i));
      const segmentOf = new Map<string, number>();
      // A shown slide's layout items sit beneath everything on it.
      const locked = this.store.layoutItemIds();
      for (const e of els) {
         if (locked.has(e.id)) {
            segmentOf.set(e.id, 0);
            continue;
         }
         if (e.aboveTables) {
            segmentOf.set(e.id, among.length + 1);
            continue;
         }
         let s = 0;
         while (s < among.length && among[s].zIndex < e.zIndex) s++;
         segmentOf.set(e.id, s);
      }
      return { z, segmentOf, segments: among.length + 1 };
   });

   /** One content-layer slice per gap between diagrams (a single one without diagrams). */
   protected readonly contentSegments = computed(() => {
      const { segmentOf, segments } = this.diagramLayers();
      // One extra slice above the table nodes for elements flagged `aboveTables`.
      return Array.from({ length: segments + 1 }, (_, index) => ({
         index,
         z: index === segments ? 401 : 10 + 2 * index,
         // Anything unknown (the in-progress draft) is newest, so it draws on top.
         accept: (id: string): boolean => (segmentOf.get(id) ?? segments - 1) === index,
      }));
   });

   /** Render views for all elements plus any in-progress draft, resolved for the SVG layer. */
   readonly shapeViews = computed(() => {
      const draft = this.draft();
      const hide = this.focusHidden();
      const shown = hide ? this.store.elements().filter((e) => !hide.elementIds.has(e.id)) : this.store.elements();
      // A shown slide's layout items draw beneath it, locked.
      const locked = this.store.layoutItemIds();
      const editing = this.textEditing.editingTextId();
      const looks = this.emptyCopyLooks();
      const fills = this.layoutFills();
      // Elements draw in array order, so a shown slide's layout items go first (beneath it).
      const ordered = locked.size
         ? [...shown.filter((e) => locked.has(e.id)), ...shown.filter((e) => !locked.has(e.id))]
         : shown;
      const masters = this.store.masterItemIds();
      const under = this.inheritedOffsets();
      const all = ordered.map((e) => {
         if (locked.has(e.id)) {
            // The master's items sit below the layout's.
            const depth = masters.has(e.id) ? 2 : 1;
            // Drawn where the shown slide is (its layout catches up once a drag settles).
            const d = e.slideId ? under.get(e.slideId) : undefined;
            const at = d ? { x: e.x + d.dx, y: e.y + d.dy } : {};
            return { ...e, ...at, zIndex: e.zIndex - LAYOUT_Z_OFFSET * depth, aboveTables: false };
         }
         const fill = fills.get(e.id);
         if (fill) return { ...e, ...fill };
         // An empty placeholder copy shows its layout slot's text, ghosted (not while typed into).
         const look = looks.get(e.id);
         if (look && e.id !== editing) return { ...look.el, opacity: look.el.opacity * 0.45 };
         if (isEmptyPlaceholder(e) && e.id !== editing) {
            return { ...e, text: placeholderPrompt(e.placeholder!), runs: undefined, opacity: e.opacity * 0.45 };
         }
         return e;
      });
      // Fields ({{slide}}, {{date}}, ...) stay as tokens on the canvas; they fill in when presenting/exporting.
      const filled = all;
      // A diff card being edited shows both sides plain, one under each of its two editors.
      const editedDiff = editing ? filled.find((e) => e.id === editing) : undefined;
      const diffEditingId = editedDiff?.type === 'code' && codeDiffActive(editedDiff) ? editing : null;
      // Deck theme tokens ($accent1, $heading, ...) resolve against each item's presentation.
      const elements = resolveThemedElements(draft ? [...filled, draft] : filled, this.store.slideFrames());
      // Depend on the theme so colors re-resolve (and re-contrast) on toggle, and re-measure
      // text once web fonts arrive.
      this.theme.dark();
      this.fontMetrics.fontsLoaded$();
      const views = buildShapeViews(
         elements,
         this.visibleTables(),
         new Set(this.store.selectedElementIds()),
         this.themeColors(),
         this.messageBoxes(),
         diffEditingId,
         { cache: this.shapeViewCache, generation: this.fontMetrics.generation }
      );
      // Slide items staged wholly outside their frame (morph entrances/exits) are dimmed:
      // they are part of the slide but never shown when presenting.
      const frames = new Map(this.store.slideFrames().map((f) => [f.id, f]));
      const offSlide = new Set(
         elements
            .filter((e) => {
               const f = e.slideId ? frames.get(e.slideId) : undefined;
               if (!f || e.type === 'frame') return false;
               const b = elementBox(e);
               return b.x1 <= f.x || b.x0 >= f.x + f.width || b.y1 <= f.y || b.y0 >= f.y + f.height;
            })
            .map((e) => e.id)
      );
      // Derived copies are memoized per view, so unchanged items keep their object identity.
      const out = offSlide.size
         ? views.map((v) => (offSlide.has(v.id) ? variant(this.dimmedViews, v, dim) : v))
         : views;
      return locked.size ? out.map((v) => (locked.has(v.id) ? variant(this.lockedViews, v, lock) : v)) : out;
   });
   /** Unchanged elements keep their render view between rebuilds (see buildShapeViews). */
   private readonly shapeViewCache = new ShapeViewCache();
   private readonly dimmedViews = new WeakMap<ShapeView, ShapeView>();
   private readonly lockedViews = new WeakMap<ShapeView, ShapeView>();

   /** Resolved canvas background + text color for the render-time contrast guard. */
   private readonly themeColors = computed(
      (): { canvasBg: string; text: string; surface: string } | undefined => {
         // Re-read the tokens only when the theme flips, not on every shape rebuild.
         this.theme.themeChanged$();
         try {
            const styles = getComputedStyle(this.canvasRef().nativeElement);
            const canvasBg = styles.getPropertyValue('--dd-canvas-bg').trim();
            const text = styles.getPropertyValue('--dd-text').trim();
            const surface = styles.getPropertyValue('--dd-surface').trim();
            return canvasBg && text ? { canvasBg, text, surface } : undefined;
         } catch {
            return undefined;
         }
      },
      { equal: (a, b) => a?.canvasBg === b?.canvasBg && a?.text === b?.text && a?.surface === b?.surface }
   );

   /** The shapes layer is interactive only in select mode (drawing passes through it). */
   /** Two or more independently movable units (a whole group counts as one). */
   private readonly alignUnitCount = computed(() => {
      const byItem = this.store.groupByItem();
      const entered = this.store.enteredGroupId();
      const ids = [
         ...this.store.selectedTableIds(),
         ...this.store.selectedElementIds(),
         ...this.store.selectedDiagramIds(),
      ];
      const units = new Set(
         ids.map((id) => {
            const g = byItem.get(id);
            return g && g !== entered ? g : id;
         })
      );
      return units.size;
   });

   /**
    * The frame / shape a lone selected unit sits fully inside, if any. A single
    * selection aligns to this container, so no second selection is needed. Once
    * several units are selected they align to each other instead (which already
    * covers the "item + its container" case).
    */
   private readonly alignContainer = computed<Box | null>(() => {
      if (this.alignUnitCount() !== 1) {
         return null;
      }
      const selected = new Set([
         ...this.store.selectedTableIds(),
         ...this.store.selectedElementIds(),
         ...this.store.selectedDiagramIds(),
      ]);
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      const grow = (b: Box): void => {
         x0 = Math.min(x0, b.x0);
         y0 = Math.min(y0, b.y0);
         x1 = Math.max(x1, b.x1);
         y1 = Math.max(y1, b.y1);
      };
      for (const t of this.store.tables()) {
         if (selected.has(t.id)) grow(tableBox(t));
      }
      for (const e of this.store.elements()) {
         if (selected.has(e.id)) grow(elementBox(e));
      }
      for (const d of this.store.sequenceDiagrams()) {
         const b = selected.has(d.id) ? this.diagramBox(d) : null;
         if (b) grow({ x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY });
      }
      if (!Number.isFinite(x0)) {
         return null;
      }
      const eps = 0.5;
      let best: Box | null = null;
      let bestArea = Infinity;
      for (const e of this.store.elements()) {
         if (selected.has(e.id) || !CONTAINER_TYPES.has(e.type)) continue;
         const b = elementBox(e);
         if (b.x0 > x0 + eps || b.y0 > y0 + eps || b.x1 < x1 - eps || b.y1 < y1 - eps) continue;
         const area = (b.x1 - b.x0) * (b.y1 - b.y0);
         if (area < bestArea) {
            best = b;
            bestArea = area;
         }
      }
      return best;
   });

   /** Align buttons are live for 2+ units, or for one unit inside a container. */
   protected readonly canAlign = computed(
      () => this.store.canEdit() && (this.alignUnitCount() >= 2 || !!this.alignContainer())
   );
   protected readonly canDistribute = computed(() => this.store.canEdit() && this.alignUnitCount() >= 3);
   /** True when an align action would target the surrounding container. */
   protected readonly alignToContainer = computed(() => this.alignUnitCount() === 1 && !!this.alignContainer());

   /** Dashed outlines around selected groups and the group currently entered. */
   protected readonly groupOutlines = computed(() => {
      const groups = this.store.groups();
      if (!groups.size) {
         return [];
      }
      const entered = this.store.enteredGroupId();
      const selT = new Set(this.store.selectedTableIds());
      const selE = new Set(this.store.selectedElementIds());
      const selD = new Set(this.store.selectedDiagramIds());
      const tables = new Map(this.store.tables().map((t) => [t.id, t] as const));
      const elements = new Map(this.store.elements().map((e) => [e.id, e] as const));
      const diagrams = new Map(this.store.sequenceDiagrams().map((d) => [d.id, d] as const));
      const lifelines = this.store.lifelines();
      const messages = this.store.sequenceMessages();
      const pad = 8;
      const out: {
         id: string;
         left: number;
         top: number;
         width: number;
         height: number;
         entered: boolean;
      }[] = [];
      for (const [gid, g] of groups) {
         const active =
            gid === entered ||
            g.tableIds.some((id) => selT.has(id)) ||
            g.elementIds.some((id) => selE.has(id)) ||
            g.diagramIds.some((id) => selD.has(id));
         if (!active) {
            continue;
         }
         const boxes: Box[] = [];
         for (const id of g.tableIds) {
            const t = tables.get(id);
            if (t) boxes.push(tableBox(t));
         }
         for (const id of g.elementIds) {
            const e = elements.get(id);
            if (e) boxes.push(elementBox(e));
         }
         for (const id of g.diagramIds) {
            const d = diagrams.get(id);
            const b = d ? sequenceDiagramBox(d, lifelines, messages) : null;
            if (b) boxes.push(b);
         }
         if (!boxes.length) {
            continue;
         }
         const x0 = Math.min(...boxes.map((b) => b.x0)) - pad;
         const y0 = Math.min(...boxes.map((b) => b.y0)) - pad;
         const x1 = Math.max(...boxes.map((b) => b.x1)) + pad;
         const y1 = Math.max(...boxes.map((b) => b.y1)) + pad;
         out.push({
            id: gid,
            left: x0,
            top: y0,
            width: x1 - x0,
            height: y1 - y0,
            entered: gid === entered,
         });
      }
      return out;
   });

   protected readonly shapesInteractive = computed(() => this.activeTool() === 'select' && this.store.canEdit());

   private readonly codeActions = inject(CodeActionsService);
   protected readonly grids = inject(GridTableService);

   /** Screen-space placement + value for the inline text editor overlay. */
   /**
    * Empty placeholder copies, drawn as their layout slot: its size, style and text (the
    * prompt), at the copy's own spot. `patch` is the slot look to store when typed into.
    */
   private readonly emptyCopyLooks = computed(() => {
      const elements = this.store.elements();
      const out = new Map<string, { el: CanvasElementModel; patch: UpdateElementDto }>();
      if (!elements.some((e) => e.placeholder?.of)) return out;
      const byId = new Map(elements.map((e) => [e.id, e] as const));
      for (const e of elements) {
         const slot = e.placeholder?.of ? byId.get(e.placeholder.of) : undefined;
         if (!slot || !isEmptyPlaceholder(e)) continue;
         const patch = slotStyle(slot);
         out.set(e.id, {
            el: { ...e, ...(patch as Partial<CanvasElementModel>), text: slot.text, runs: slot.runs },
            patch,
         });
      }
      return out;
   });

   /** Slide placeholders nobody changed follow their layout slot when it moves or restyles. */
   private readonly followSlots = (() => {
      const follow = slotFollower(this.store);
      return effect(() => {
         this.store.elements();
         untracked(follow);
      });
   })();

   /**
    * Layout / master frames drawn under a shown frame -> how far that frame sits from
    * them (non-zero only while a moved slide's stack has not caught up yet).
    */
   private readonly inheritedOffsets = computed(() => {
      const frames = this.store.slideFrames();
      const shown = this.store.shownSlideIds();
      const out = new Map<string, { dx: number; dy: number }>();
      for (const f of frames) {
         if (!shown.has(f.id)) continue;
         for (const u of [layoutOf(f, frames), masterOf(f, frames)]) {
            if (u && !shown.has(u.id) && (u.x !== f.x || u.y !== f.y)) out.set(u.id, { dx: f.x - u.x, dy: f.y - u.y });
         }
      }
      return out;
   });

   /** Shown slides/layouts without a background of their own take their layout's, else the master's. */
   private readonly layoutFills = computed(() => {
      const frames = this.store.slideFrames();
      const shown = this.store.shownSlideIds();
      const out = new Map<string, Pick<CanvasElementModel, 'fillStyle' | 'backgroundColor'>>();
      const filled = (u: CanvasElementModel | undefined) => (u && u.fillStyle !== 'none' ? u : undefined);
      for (const f of frames) {
         const l =
            shown.has(f.id) && f.fillStyle === 'none'
               ? (filled(layoutOf(f, frames)) ?? filled(masterOf(f, frames)))
               : undefined;
         if (l) {
            out.set(f.id, { fillStyle: l.fillStyle, backgroundColor: l.backgroundColor });
         }
      }
      return out;
   });

   /** Every presentation gets a theme and a default layout; every slide a layout. */
   private readonly deckDefaults = effect(() => {
      this.store.slideFrames();
      if (!this.store.canEdit()) return;
      untracked(() => void ensureDeckDefaults(this.store, this.themeVar('--dd-text-muted') ?? DEFAULT_ELEMENT_STROKE));
   });

   /** Typing into an empty placeholder: it takes its slot's current size and style first. */
   private readonly adoptSlotLook = effect(() => {
      const id = this.textEditing.editingTextId();
      const look = id ? untracked(() => this.emptyCopyLooks().get(id)) : undefined;
      if (!id || !look || !this.store.canEdit()) return;
      const el = untracked(() => this.store.elements().find((e) => e.id === id));
      const stale =
         el && Object.entries(look.patch).some(([k, v]) => (el as unknown as Record<string, unknown>)[k] !== v);
      if (stale) void this.store.patchElementSilently(id, look.patch);
   });

   /** The deck theme an element's tokens resolve against (its presentation's, else the default). */
   deckThemeOf(el: Pick<CanvasElementModel, 'id' | 'type' | 'slideId'>): SlideTheme {
      const f =
         el.type === 'frame'
            ? this.store.slideFrames().find((x) => x.id === el.id)
            : this.store.slideFrames().find((x) => x.id === el.slideId);
      return (f && this.store.presentationThemes().get(presentationOf(f))) || DEFAULT_THEME;
   }

   /**
    * Connectors as rendered. While re-pointing an endpoint, the affected line's
    * own end follows the cursor (so the line moves in place) instead of showing a
    * separate temporary line.
    */
   protected readonly displayConnectors = computed(() => {
      const base = this.connectors();
      const relink = this.relinkState();
      const cursor = this.linkSnap()?.anchor ?? this.linkCursor();
      if (!relink || !cursor) {
         return base;
      }
      return base.map((c) => {
         if (c.id !== relink.relationshipId) {
            return c;
         }
         const fixed = relink.which === 'source' ? { x: c.bx, y: c.by } : { x: c.ax, y: c.ay };
         return {
            ...c,
            d: elbowPath(fixed, cursor),
            ax: relink.which === 'source' ? cursor.x : c.ax,
            ay: relink.which === 'source' ? cursor.y : c.ay,
            bx: relink.which === 'target' ? cursor.x : c.bx,
            by: relink.which === 'target' ? cursor.y : c.by,
            routePoints: [fixed, cursor],
            segments: [],
         };
      });
   });

   protected readonly selectedRelInline = computed<{
      x: number;
      y: number;
      rel: RelationshipModel;
   } | null>(() => {
      const rel = this.store.selectedRelationship();
      if (!rel) {
         return null;
      }
      const connector = this.connectors().find((c) => c.id === rel.id);
      if (!connector) {
         return null;
      }
      const v = this.store.viewport();
      return { x: connector.mx * v.zoom + v.x, y: connector.my * v.zoom + v.y, rel };
   });

   // Linking / re-pointing
   private readonly linkSourceColumnId = signal<string | null>(null);
   /** Edge handle the in-flight link started from; the new line is pinned there. */
   private readonly linkSourceSide = signal<Side>('right');
   private readonly relinkState = signal<RelinkState | null>(null);
   private readonly linkCursor = signal<{ x: number; y: number } | null>(null);

   // Relationship segment being dragged (Miro-style perpendicular slide)
   private readonly activeSegment = signal<{
      relationshipId: string;
      segIndex: number;
      a: Point;
      b: Point;
      route: Point[];
   } | null>(null);

   /** True while any connector drag (link / re-point / segment) is in progress. */
   protected readonly dragging = computed(
      () => !!(this.linkSourceColumnId() || this.relinkState() || this.activeSegment())
   );

   /** True once a move of elements / tables has passed the click threshold. */
   private readonly movingItems = signal(false);

   /** Slide blocks stop clipping while anything is carried, so it stays visible past the block. */
   protected readonly slideUnclipped = computed(() => {
      if (this.dragging()) return true;
      if (!this.movingItems()) return false;
      // Only a carried slide item needs the block unclipped; moving canvas items must not
      // reveal the staging content around every slide.
      const els = new Set(this.store.selectedElementIds());
      const tbls = new Set(this.store.selectedTableIds());
      const dgs = new Set(this.store.selectedDiagramIds());
      return (
         this.store.elements().some((e) => els.has(e.id) && (!!e.slideId || e.type === 'frame')) ||
         this.store.tables().some((t) => tbls.has(t.id) && !!t.slideId) ||
         this.store.sequenceDiagrams().some((d) => dgs.has(d.id) && !!d.slideId)
      );
   });

   /**
    * Column row the in-flight link / re-point would attach to if released now.
    * Magnetic: the cursor only has to be near a table, not on the tiny handle.
    */
   protected readonly linkSnap = computed<LinkSnap | null>(() => {
      const cursor = this.linkCursor();
      if (!cursor) {
         return null;
      }
      const relink = this.relinkState();
      let exclude: string | null = null;
      if (relink) {
         const rel = this.store.relationships().find((r) => r.id === relink.relationshipId);
         exclude = (relink.which === 'source' ? rel?.targetColumnId : rel?.sourceColumnId) ?? null;
      } else {
         exclude = this.linkSourceColumnId();
         if (!exclude) {
            return null;
         }
      }
      return findLinkSnap(this.store.tables(), cursor, exclude, this.store.viewport().zoom);
   });

   /** Dashed preview only for drawing a brand-new relationship (re-point moves the line itself). */
   protected readonly tempLink = computed<string | null>(() => {
      const cursor = this.linkSnap()?.anchor ?? this.linkCursor();
      const sourceId = this.linkSourceColumnId();
      if (!cursor || !sourceId || this.relinkState()) {
         return null;
      }
      const loc = this.columnLocations().get(sourceId);
      if (!loc) {
         return null;
      }
      const a = columnAnchor(loc.table, loc.index, this.linkSourceSide());
      // Orthogonal elbow, never a diagonal, to match the finished connectors.
      return elbowPath(a, cursor);
   });

   // Marquee (screen coords relative to the canvas)
   private readonly marqueeStart = signal<{ x: number; y: number } | null>(null);
   private readonly marqueeCurrent = signal<{ x: number; y: number } | null>(null);
   protected readonly marqueeRect = computed<{
      left: number;
      top: number;
      width: number;
      height: number;
   } | null>(() => {
      const s = this.marqueeStart();
      const c = this.marqueeCurrent();
      if (!s || !c) {
         return null;
      }
      return {
         left: Math.min(s.x, c.x),
         top: Math.min(s.y, c.y),
         width: Math.abs(s.x - c.x),
         height: Math.abs(s.y - c.y),
      };
   });

   mode: DragMode = 'idle';
   spaceDown = false;
   private marqueeAdditive = false;
   private startClientX = 0;
   private startClientY = 0;
   private startViewportX = 0;
   private startViewportY = 0;
   private dragTableId: string | null = null;
   /** World-space point a shape draw started from (the corner, or the center with Alt). */
   private drawAnchor = { x: 0, y: 0 };
   lastDrawPointer = { x: 0, y: 0 };
   /** True once the current drag has switched to dragging Alt-made copies. */
   private dragCopied = false;
   /** Pointer was released while Alt-drag copies were still being created. */
   private releasedWhileDuplicating = false;
   lastPointer: PointerEvent | null = null;
   /** Live Shift state, so a move drag can lock to an axis without a pointer move. */
   shiftHeld = false;
   private multiDragStart = new Map<string, { x: number; y: number }>();
   // Manual routes touching the dragged tables. `both` true when both endpoints
   // move together (rigid translate). Otherwise only one end moves: the waypoint
   // nearest that anchor follows it vertically (so the closest vertical run
   // shrinks) while its x is absorbed by the horizontal run. `sourceMoved` picks
   // which end (first vs last waypoint) is the one being dragged.
   private waypointDragStart = new Map<string, { wp: Point[]; both: boolean; sourceMoved: boolean }>();

   private lastCursorSent = 0;

   constructor() {
      this.cellEditors.connect(this);
      this.textEditing.connect(this);
      this.placement.connect(this);
      this.deckFocus.connect(this);
      this.viewport.connect(this);
      this.clipboard.connect(this);
      this.mediaDrop.connect(this);
      this.exporter.connect(this);
      this.shortcuts.connect(this);
      // Ctrl/Cmd+wheel (and trackpad pinch) anywhere over the editor — canvas,
      // slides panel, side panels — must never zoom the browser page. Capture
      // phase so panels that stopPropagation() on wheel are still covered; the
      // canvas's own (wheel) handler still runs and does the canvas zoom.
      const host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
      const blockPageZoom = (e: WheelEvent) => {
         if (e.ctrlKey || e.metaKey) e.preventDefault();
      };
      host.addEventListener('wheel', blockPageZoom, { capture: true, passive: false });
      this.destroyRef.onDestroy(() => host.removeEventListener('wheel', blockPageZoom, { capture: true }));

      // Double-click detection of our own. The browser only fires `dblclick` when both
      // clicks land on the same live DOM node, but the first click often re-renders the
      // item under the pointer (selection moves it between layers, slide placeholders
      // swap for their copies...), which silently swallows the native event. Two quick
      // presses close together count as a double-click wherever they land.
      let lastDown: { t: number; x: number; y: number } | null = null;
      let pending: { x: number; y: number } | null = null;
      const onDown = (e: PointerEvent): void => {
         if (e.button !== 0 || e.pointerType === 'touch') return;
         const now = performance.now();
         const near =
            lastDown && now - lastDown.t < 450 && Math.hypot(e.clientX - lastDown.x, e.clientY - lastDown.y) < 6;
         pending = near ? { x: e.clientX, y: e.clientY } : null;
         lastDown = near ? null : { t: now, x: e.clientX, y: e.clientY };
      };
      const onUp = (e: PointerEvent): void => {
         const p = pending;
         pending = null;
         if (!p || e.button !== 0 || Math.hypot(e.clientX - p.x, e.clientY - p.y) >= 6) return;
         const canvas = this.canvasRef().nativeElement;
         const target = document.elementFromPoint(e.clientX, e.clientY);
         if (!target || !canvas.contains(target)) return;
         this.lastOwnDblClick = performance.now();
         this.handleDoubleClick(target, canvas, e.clientX, e.clientY);
      };
      // A native dblclick right after one we replayed is the same gesture: drop it
      // before it reaches item handlers (it would e.g. enter a group, then edit).
      const dedupeDbl = (e: MouseEvent): void => {
         if (
            !this.replayingDblClick &&
            performance.now() - this.lastOwnDblClick < 600 &&
            (e.target as Element | null)?.closest?.(EditorComponent.SELF_DBLCLICK)
         ) {
            e.stopImmediatePropagation();
         }
      };
      host.addEventListener('dblclick', dedupeDbl, { capture: true });
      host.addEventListener('pointerdown', onDown, { capture: true });
      window.addEventListener('pointerup', onUp, { capture: true });
      this.destroyRef.onDestroy(() => {
         host.removeEventListener('dblclick', dedupeDbl, { capture: true });
         host.removeEventListener('pointerdown', onDown, { capture: true });
         window.removeEventListener('pointerup', onUp, { capture: true });
      });

      // Initialise the contenteditable once per editing session (the DOM owns the
      // content while typing, so it is never re-rendered from the store).
      // The inspector's "Edit original / Edit changed" opens the inline editor on that side.
      effect(() => {
         const req = this.codeActions.editRequest();
         if (!req) return;
         untracked(() => {
            this.codeActions.editRequest.set(null);
            if (this.textEditing.editingTextId()) this.textEditing.commitTextEdit();
            this.codeActions.diffEditSide.set(req.side);
            this.textEditing.editingTextId.set(req.id);
         });
      });
      // A diff card's editor opens with the caret in the pane that was asked for.
      // Only when the editor opens: later keystrokes must not pull the caret across.
      effect(() => {
         const id = this.textEditing.editingTextId();
         if (
            !id ||
            untracked(() => !this.textEditing.diffPaneEditor() || this.codeActions.diffEditSide() !== 'modified')
         )
            return;
         setTimeout(() => {
            const pane = document.querySelector('textarea.diff-pane') as HTMLTextAreaElement | null;
            pane?.focus();
            pane?.setSelectionRange(pane.value.length, pane.value.length);
         }, 30);
      });
      effect(() => {
         const ref = this.richEditorRef();
         untracked(() => {
            if (ref && ref.nativeElement !== this.textEditing.richInitFor) {
               this.textEditing.richInitFor = ref.nativeElement;
               this.textEditing.initRichEditor(ref.nativeElement);
            } else if (!ref && this.textEditing.richInitFor) {
               this.textEditing.teardownRichEditor();
            }
         });
      });
      this.destroyRef.onDestroy(() => this.textEditing.teardownRichEditor());
      // Slides are locked together: moving one moves all of them (once the move settles).
      effect((onCleanup) => {
         this.store.slideFrames();
         // Not mid-drag: a pause would shift the rest early; the whole move is caught up on release.
         if (this.gestureActive()) return;
         const timer = setTimeout(() => this.placement.syncSlideMoves(), 160);
         onCleanup(() => clearTimeout(timer));
      });
      // A presentation stays selected as a whole only while its shown slide alone is selected.
      effect(() => {
         const ids = this.store.selectedElementIds();
         const shown = this.store.shownByPresentation();
         untracked(() => {
            const sets = this.selectedSlideSets();
            // Still selected while its shown frame is (a marquee can take it with other items).
            const kept = sets.filter((set) => ids.includes(shown.get(set) ?? ''));
            if (kept.length !== sets.length) {
               this.selectedSlideSets.set(kept);
            }
         });
      });
      // Things dropped or moved into the shown slide's frame become part of that slide.
      effect((onCleanup) => {
         this.store.elements();
         this.store.tables();
         this.store.sequenceDiagrams();
         this.store.lifelines();
         this.store.sequenceMessages();
         this.store.shownSlideIds();
         this.slideViews();
         // Never mid-drag: adopting re-maps items into a zoomed slide, which would jump them.
         if (this.gestureActive()) {
            return;
         }
         const timer = setTimeout(() => void this.placement.adoptIntoShownSlide(), 350);
         onCleanup(() => clearTimeout(timer));
      });
      // Selecting something on a presentation's slide makes that presentation the selected one.
      effect(() => {
         const id = this.store.selectedElementIds()[0];
         const frames = this.store.slideFrames();
         untracked(() => {
            const el = id ? this.store.elements().find((e) => e.id === id) : undefined;
            const frame = el?.type === 'frame' ? el : frames.find((f) => f.id === el?.slideId);
            if (frame?.slide) {
               this.store.selectPresentation(presentationOf(frame));
            }
         });
      });
      // Bring slides saved side by side onto their presentation's spot (once per such
      // slide), and give presentations that were stacked on one spot their own.
      effect(() => {
         this.store.slideFrames();
         this.store.elements();
         untracked(
            () => void this.placement.stackLegacySlides().then(() => this.placement.separateStackedPresentations())
         );
      });
      // Load the project: from a share token (anonymous) or a project id (owner).
      effect(() => {
         const token = this.shareToken();
         const id = this.projectId();
         if (token) {
            void this.store.loadShared(token);
         } else if (id) {
            void this.store.load(id);
         }
      });
      // Embedded editors: frame everything once per loaded project, clear of the tool dock.
      effect(() => {
         const id = this.store.projectId();
         if (!this.fitOnLoad() || !id || this.store.loading() || this.fittedProjectId === id) return;
         // The store is app-wide: only frame the project this editor was given.
         if (id !== (this.projectId() ?? id)) return;
         if (!this.minimapItems().length) return;
         this.fittedProjectId = id;
         setTimeout(() => {
            if (!this.destroyRef.destroyed && this.store.projectId() === id) this.viewport.fitContent();
         });
      });
      // Opening (or refreshing) a project starts at its home view, or origin/100%.
      effect(() => {
         const id = this.store.projectId();
         if (this.fitOnLoad() || !id || this.store.loading() || !this.store.schema()) return;
         if (this.homeAppliedFor === id) return;
         this.homeAppliedFor = id;
         untracked(() => {
            const home = this.store.home() ?? { x: 0, y: 0, zoom: 1 };
            this.store.setViewport(home.x, home.y, home.zoom);
         });
      });
      effect(() => {
         const id = this.store.projectId();
         const tool = this.initialTool();
         if (!tool || !id || this.store.loading() || this.toolAppliedFor === id) return;
         this.toolAppliedFor = id;
         setTimeout(() => this.onToolChange(tool));
      });
      // Join / re-join the realtime room whenever the loaded project changes.
      effect(() => {
         const id = this.store.projectId();
         // Guide sandboxes live only in this browser: no realtime room.
         if (id && !isSandboxId(id)) {
            this.realtime.connect(id);
         }
      });
      // Track the canvas size for the minimap's viewport rectangle.
      effect((onCleanup) => {
         const el = this.canvasRef().nativeElement;
         const update = (): void => this.viewport.canvasSize.set({ width: el.clientWidth, height: el.clientHeight });
         update();
         const ro = new ResizeObserver(update);
         ro.observe(el);
         onCleanup(() => ro.disconnect());
      });
      // Broadcast this participant's selection so others see what is being edited (only with
      // someone in the room; it re-sends when a peer joins).
      effect(() => {
         if (!this.realtime.hasPeers()) return;
         const tableIds = this.store.selectedTableIds();
         const relationshipIds = this.store.selectedRelationshipIds();
         this.realtime.sendSelection(tableIds, relationshipIds);
      });
      this.destroyRef.onDestroy(() => this.realtime.disconnect());
      // Expose Export/Share to the global top bar while this editor is mounted.
      this.editorActions.register({
         share: () => this.openShare(),
         exportSql: () => this.exporter.openSqlExport(),
         exportImage: (format) => void this.exporter.onExportImage(format),
         exportFramesPdf: () => void this.exporter.exportAllFramesPdf(),
         exportSlidesPdf: () => void this.exporter.exportAllSlidesPdf(),
         exportSelectionFile: () => void this.exporter.exportSelectionFile(),
         importFile: (file) => this.placement.importProjectFile(file),
         deleteSelection: () => this.shortcuts.deleteSelection(),
         focusDeck: (name) => this.deckFocus.focusDeck(name),
         enterDeckFocus: (name) => this.deckFocus.enterDeckFocus(name),
         exitDeckFocus: () => this.deckFocus.exitDeckFocus(),
         jumpToParticipant: (id) => this.follow.jumpToParticipant(id),
         followParticipant: (id) => this.follow.followingId.set(id),
         addFrameToPresentation: (id, deck) => void this.placement.addFrameToPresentation(id, deck),
         exportFrame: (id, format) => this.exporter.exportOneFrame(id, format),
         presentDeck: (name) => this.deckFocus.presentDeck(name),
         followPresenter: (id) => void this.slideshow.followPresenter(id),
         newDeck: () => this.onToolChange('slide'),
         setTool: (tool) => this.onToolChange(tool as EditorTool),
         resetView: () => this.viewport.resetView(),
         setHome: () => this.viewport.setHome(),
         canvasItems: () => this.paletteItems(),
         jumpTo: (item) => this.jumpToItem(item),
      });
      // Feed the top-right Presentations menu.
      // The transition screen shows its own preview: hide the canvas's floating toolbars.
      effect(() => {
         document.body.classList.toggle(
            'dd-focus-morph',
            !!this.deckFocus.focusedDeck() && this.deckFocus.focusScreen() === 'morph'
         );
      });
      // Floating islands fade while dragging or drawing (toolbar setting).
      effect(() => {
         const on = this.gestureActive() && this.toolbarPrefs.fadeWhileDragging();
         document.body.classList.toggle('dd-gesture', on);
      });
      // Focus mode keeps its slide fitted between the docks (screen, slide or window changes).
      effect(() => {
         if (!this.deckFocus.focusedDeck()) return;
         this.deckFocus.focusScreen();
         const f = this.deckFocus.focusShown();
         this.viewport.canvasSize();
         if (!f) return;
         void [f.x, f.y, f.width, f.height];
         untracked(() => this.deckFocus.fitFocus(true));
      });
      // Focus mode follows the deck: tell the app chrome, and end it when the deck is gone.
      effect(() => {
         const name = this.deckFocus.focusedDeck();
         if (name && !this.store.presentations().includes(name)) {
            untracked(() => this.deckFocus.focusedDeck.set(null));
         }
      });
      // The app chrome (top bar, Presentations menu, palette) reads this editor's state.
      this.editorActions.registerState({
         canExportSql: this.canExportSql$,
         hasTableSelection: this.hasTableSelection$,
         hasSelection: this.hasSelection$,
         presentationName: this.store.presentation,
         hasPlainFrames: this.hasPlainFrames$,
         decks: this.deckSummaries$,
         focusedDeck: this.deckFocus.focusedDeck,
         following: this.follow.followingId,
      });
      this.destroyRef.onDestroy(() => this.editorActions.clear());
      // An unpinned details panel belongs to one selection: fold it when that changes.
      let lastSelection: string | null = null;
      effect(() => {
         const key = this.selectionKey();
         if (lastSelection !== null && key !== lastSelection) {
            untracked(() => this.inspector.selectionChanged());
         }
         lastSelection = key;
      });
      effect(() => {
         const on = this.smartGuides();
         try {
            globalThis.localStorage?.setItem(SMART_GUIDES_KEY, on ? '1' : '0');
         } catch {
            // ignore storage errors
         }
      });
      // Persist the grid-snap toggle across refreshes.
      effect(() => {
         const on = this.gridSnap();
         try {
            globalThis.localStorage?.setItem(GRID_SNAP_KEY, on ? '1' : '0');
         } catch {
            // ignore storage errors
         }
      });
   }

   /** Open the owner share dialog (create/list/revoke VIEW/EDIT links). */
   protected openShare(): void {
      const projectId = this.store.projectId();
      if (!projectId || this.store.accessMode() !== 'OWNER') {
         return;
      }
      this.dialog.open(ShareDialogComponent, {
         width: '560px',
         maxWidth: '92vw',
         data: { projectId },
      });
   }

   /** Send our cursor position (world coords) to the room, throttled to ~25fps. */
   private broadcastCursor(event: PointerEvent): void {
      if (!this.realtime.hasPeers()) {
         return;
      }
      const now = Date.now();
      if (now - this.lastCursorSent < 40) {
         return;
      }
      this.lastCursorSent = now;
      const world = this.viewport.toWorld(event.clientX, event.clientY);
      this.realtime.sendCursor(world.x, world.y);
   }

   /** Snap a world coordinate to the grid when grid-snap is enabled, else pass through. */
   protected readonly snapWorld = (n: number): number => (this.gridSnap() ? snapToGrid(n) : n);

   private static additive(event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): boolean {
      return event.ctrlKey || event.metaKey || event.shiftKey;
   }

   // --- canvas pointer (pan / marquee) ---

   protected onCanvasPointerDown(event: PointerEvent): void {
      // Clicking away closes a grid cell editor even when the click does not move focus.
      if (this.grids.editingCell()) {
         this.grids.endEdit();
      }
      if (
         !this.deckFocus.focusedDeck() &&
         (event.button === 1 || (event.button === 0 && (this.spaceDown || this.activeTool() === 'hand')))
      ) {
         event.preventDefault();
         this.mode = 'pan';
         this.panning.set(true);
         this.startClientX = event.clientX;
         this.startClientY = event.clientY;
         const v = this.store.viewport();
         this.startViewportX = v.x;
         this.startViewportY = v.y;
         return;
      }
      if (event.button !== 0) {
         return;
      }
      const tool = this.activeTool();
      if (tool !== 'select' && tool !== 'hand' && tool !== 'laser' && this.store.canEdit() && this.store.projectId()) {
         event.preventDefault();
         if (tool === 'table') {
            this.addTableAt(event.clientX, event.clientY);
            this.afterPlace();
            return;
         }
         if (tool === 'sequence') {
            this.addSequenceAt(event.clientX, event.clientY);
            this.afterPlace();
            return;
         }
         if (tool === 'slide') {
            // A click adds a slide: the first where you click, later ones stacked on the shown one.
            void this.placement.addSlide(this.viewport.toWorld(event.clientX, event.clientY));
            this.afterPlace();
            return;
         }
         if (tool === 'freedraw' && this.penPrefs.eraser()) {
            this.beginErase(event);
            return;
         }
         this.beginDraw(tool, event);
         return;
      }
      // Grabbing a master or layout item drawn under a shown slide or layout gives that frame its own
      // copy, selected and (while the button is held) dragged like any item.
      if (tool === 'select' && this.store.canEdit() && !EditorComponent.additive(event)) {
         const inherited = this.inheritedMasterItemAt(this.viewport.toWorld(event.clientX, event.clientY));
         if (inherited) {
            event.preventDefault();
            void this.grabInherited(inherited.item, inherited.frame, event);
            return;
         }
      }
      this.marqueeAdditive = EditorComponent.additive(event);
      if (!this.marqueeAdditive) {
         this.store.clearSelection();
      }
      const p = this.viewport.screenPoint(event.clientX, event.clientY);
      this.marqueeStart.set(p);
      this.marqueeCurrent.set(p);
      this.mode = 'marquee';
   }

   // --- laser pointer (ephemeral: never persisted, undoable, or dirtying) ---

   /** Pointer id currently driving the laser, or null when it is not held. */
   private laserPointerId: number | null = null;
   private lastLaserSent = 0;

   protected onLaserPointerDown(event: PointerEvent): void {
      // Middle-button and space-drag fall through to the canvas so panning still works.
      if (event.button !== 0 || this.spaceDown) {
         return;
      }
      event.preventDefault();
      event.stopPropagation();
      try {
         (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      } catch {
         // synthetic/touch pointers can refuse capture; window listeners still see moves
      }
      this.laserPointerId = event.pointerId;
      this.addLaserSample(event, true);
   }

   protected onLaserPointerMove(event: PointerEvent): void {
      if (this.laserPointerId === event.pointerId) {
         this.addLaserSample(event, false);
      }
   }

   protected onLaserPointerUp(event: PointerEvent): void {
      if (this.laserPointerId !== event.pointerId) {
         return;
      }
      const world = this.viewport.toWorld(event.clientX, event.clientY);
      this.laserPointerId = null;
      this.laser.release(LOCAL_LASER);
      this.realtime.sendLaser(world.x, world.y, true);
   }

   private addLaserSample(event: PointerEvent, force: boolean): void {
      const world = this.viewport.toWorld(event.clientX, event.clientY);
      this.laser.add(LOCAL_LASER, world.x, world.y);
      const now = Date.now();
      if (!force && now - this.lastLaserSent < 33) {
         return;
      }
      this.lastLaserSent = now;
      if (this.realtime.hasPeers()) {
         this.realtime.sendLaser(world.x, world.y);
      }
   }

   // --- drawing new elements ---

   /** Default stroke color for new elements: the theme's text color, so it reads on either theme. */
   defaultStroke(): string {
      try {
         const c = getComputedStyle(this.canvasRef().nativeElement).getPropertyValue('--dd-text').trim();
         return c || DEFAULT_ELEMENT_STROKE;
      } catch {
         return DEFAULT_ELEMENT_STROKE;
      }
   }

   /** Read a theme CSS custom property from the canvas, or null if unavailable. */
   themeVar(name: string): string | null {
      try {
         return getComputedStyle(this.canvasRef().nativeElement).getPropertyValue(name).trim() || null;
      } catch {
         return null;
      }
   }

   /** Add an ERD table centered near the given screen point. */
   private addTableAt(clientX: number, clientY: number): void {
      const world = this.viewport.toWorld(clientX, clientY);
      let x = Math.round(world.x - NODE_WIDTH / 2);
      let y = Math.round(world.y - 12);
      if (this.gridSnap()) {
         x = snapToGrid(x);
         y = snapToGrid(y);
      }
      void this.store.addTable(x, y);
   }

   /** Drop a starter sequence diagram (header origin + two participants) at the pointer. */
   private addSequenceAt(clientX: number, clientY: number): void {
      const world = this.viewport.toWorld(clientX, clientY);
      let x = Math.round(world.x);
      let y = Math.round(world.y);
      if (this.gridSnap()) {
         x = snapToGrid(x);
         y = snapToGrid(y);
      }
      void this.store.addSequenceStarter(x, y);
   }

   /** Pen strokes cut by the current eraser drag: their state before the drag. */
   private erased = new Map<string, CanvasElementModel>();
   private lastErasePoint: { x: number; y: number } | null = null;

   private beginErase(event: PointerEvent): void {
      this.mode = 'erase';
      this.gestureActive.set(true);
      this.erased.clear();
      this.lastErasePoint = null;
      this.eraseAt(event.clientX, event.clientY);
   }

   /**
    * Cut the parts of pen strokes under the eraser (from the last sample to here).
    * Erased points become NaN gaps locally; pointer-up splits the stroke into pieces.
    */
   private eraseAt(clientX: number, clientY: number): void {
      const raw = this.viewport.toWorldRaw(clientX, clientY);
      const view = this.slideViews().find((v) => inBlock(v, raw));
      const p = view ? toInner(view, raw) : raw;
      const from = this.lastErasePoint ?? p;
      this.lastErasePoint = p;
      const r = this.penPrefs.eraserSize() / 2 / this.store.viewport().zoom;
      for (const el of this.store.elements()) {
         if (el.type !== 'freedraw') continue;
         const reach = r + el.strokeWidth;
         if (!hitTestElement(el, p, reach) && !hitTestElement(el, from, reach)) {
            // Cheap reject unless the eraser segment crosses the stroke's box.
            const b = elementBox(el);
            if (
               Math.max(p.x, from.x) < b.x0 - reach ||
               Math.min(p.x, from.x) > b.x1 + reach ||
               Math.max(p.y, from.y) < b.y0 - reach ||
               Math.min(p.y, from.y) > b.y1 + reach
            )
               continue;
         }
         if (!this.erased.has(el.id)) this.erased.set(el.id, el);
         // Subdivide only the segments the eraser touches, so a cut can land between
         // widely spaced samples. (Densifying the whole stroke would make the brush
         // read it as slow and draw it thicker.)
         const pts = densify(
            el.points ?? [],
            Math.max(1, r / 3),
            (a, b) => segDistance({ x: el.x + a.x, y: el.y + a.y }, { x: el.x + b.x, y: el.y + b.y }, from, p) <= reach
         );
         let changed = false;
         const next = pts.map((q) => {
            if (!Number.isFinite(q.x)) return q;
            const a = { x: el.x + q.x, y: el.y + q.y };
            if (distanceToSegment(a, from, p) <= reach) {
               changed = true;
               return { x: NaN, y: NaN };
            }
            return q;
         });
         if (changed) this.store.patchElementLocal(el.id, { points: next });
      }
   }

   /** Replace each cut stroke by its remaining pieces, as one undo step. */
   private commitErase(): void {
      const erased = [...this.erased];
      this.erased.clear();
      this.lastErasePoint = null;
      const work: { before: CanvasElementModel; pieces: { x: number; y: number }[][] }[] = [];
      for (const [id, before] of erased) {
         const now = this.store.elements().find((e) => e.id === id);
         if (!now) continue;
         const pieces = splitAtGaps(absolutePoints(now)).filter((run) => run.length > 1);
         // Restore the original first so undo re-creates the stroke as it was.
         this.store.patchElementLocal(id, { points: before.points });
         if (pieces.length === 1 && pieces[0].length === (now.points ?? []).length) continue;
         work.push({ before, pieces });
      }
      if (work.length === 0) return;
      void this.store.batchHistory(async () => {
         for (const { before, pieces } of work) {
            await this.store.deleteElement(before.id);
            for (const run of pieces) {
               const o = run[0];
               let x1 = o.x,
                  y1 = o.y,
                  x0 = o.x,
                  y0 = o.y;
               for (const q of run) {
                  x0 = Math.min(x0, q.x);
                  y0 = Math.min(y0, q.y);
                  x1 = Math.max(x1, q.x);
                  y1 = Math.max(y1, q.y);
               }
               const dto = elementToCreateDto({
                  ...before,
                  x: o.x,
                  y: o.y,
                  width: x1 - x0,
                  height: y1 - y0,
                  points: run.map((q) => ({ x: q.x - o.x, y: q.y - o.y })),
               });
               delete (dto as { id?: string }).id;
               await this.store.addElement(dto, false);
            }
         }
      });
   }

   /** Start drawing an element of the active tool at the pointer. */
   private beginDraw(
      tool: Exclude<EditorTool, 'select' | 'hand' | 'table' | 'sequence' | 'laser' | 'slide'>,
      event: PointerEvent
   ): void {
      const world = this.viewport.toWorld(event.clientX, event.clientY);
      const x = this.gridSnap() ? snapToGrid(world.x) : world.x;
      const y = this.gridSnap() ? snapToGrid(world.y) : world.y;
      const type = tool as ElementType;
      const sticky = this.store.elementStyle();
      // Frames keep their own quiet look; they don't inherit the last-used shape style.
      const style =
         type === 'code'
            ? {
                 // A code card: a hairline border, no fill override (it picks a theme-matched surface).
                 ...sticky,
                 strokeColor:
                    this.themeVar('--dd-border-strong') ?? this.themeVar('--dd-text-muted') ?? sticky.strokeColor,
                 backgroundColor: undefined,
                 fillStyle: 'none' as const,
                 strokeWidth: 1,
                 strokeStyle: 'solid' as const,
                 opacity: 100,
                 cornerRadius: 8,
                 fontFamily: 'code',
                 fontSize: CODE_FONT_SIZE,
              }
            : type === 'grid'
              ? {
                   // A table: opaque surface, hairline borders, readable body text.
                   ...sticky,
                   strokeColor: this.defaultStroke(),
                   backgroundColor: SURFACE_FILL,
                   fillStyle: 'solid' as const,
                   strokeWidth: 1,
                   strokeStyle: 'solid' as const,
                   opacity: 100,
                   cornerRadius: 4,
                }
              : type === 'frame'
                ? {
                     ...sticky,
                     strokeColor: this.themeVar('--dd-text-muted') ?? sticky.strokeColor,
                     backgroundColor: undefined,
                     fillStyle: 'none' as const,
                     strokeWidth: 1.5,
                     strokeStyle: 'solid' as const,
                     opacity: 100,
                     cornerRadius: 0,
                  }
                : sticky;
      const draft: CanvasElementModel = {
         id: `draft-${Date.now()}`,
         type,
         x,
         y,
         width: 0,
         height: 0,
         angle: 0,
         strokeColor: style.strokeColor ?? this.defaultStroke(),
         backgroundColor: style.backgroundColor,
         fillStyle: style.fillStyle,
         strokeWidth:
            type === 'freedraw'
               ? this.penPrefs.highlighter()
                  ? Math.max(this.penPrefs.width(), 2) * 4
                  : this.penPrefs.width()
               : style.strokeWidth,
         strokeStyle: style.strokeStyle,
         opacity: type === 'freedraw' && this.penPrefs.highlighter() ? 50 : style.opacity,
         zIndex: this.store.elements().length,
         cornerRadius: style.cornerRadius,
         startArrowhead: style.startArrowhead,
         endArrowhead: style.endArrowhead,
         ...(type === 'line' || type === 'arrow'
            ? {
                 points: [
                    { x: 0, y: 0 },
                    { x: 0, y: 0 },
                 ],
              }
            : {}),
         ...(type === 'freedraw' ? { points: [{ x: 0, y: 0 }] } : {}),
         ...(type === 'grid' ? { text: serializeGrid(defaultGrid()), fontSize: 14, fontFamily: 'normal' } : {}),
         ...(type === 'code'
            ? {
                 text: '',
                 fontSize: CODE_FONT_SIZE,
                 fontFamily: 'code',
                 language: this.textEditing.lastCodeLanguage(),
              }
            : {}),
         ...(type === 'text'
            ? {
                 text: '',
                 fontSize: style.fontSize,
                 fontFamily: style.fontFamily,
                 textAlign: 'left' as const,
                 width: 4,
                 height: style.fontSize,
              }
            : {}),
      };
      this.draft.set(draft);
      // Started inside a zoomed-out slide: the whole stroke is drawn in its coordinates.
      const raw = this.viewport.toWorldRaw(event.clientX, event.clientY);
      this.drawSlideId.set(this.slideViews().find((v) => inBlock(v, raw))?.frameId ?? null);
      this.drawAnchor = { x, y };
      this.lastDrawPointer = { x: event.clientX, y: event.clientY };
      this.startClientX = event.clientX;
      this.startClientY = event.clientY;
      if (type === 'text') {
         // Text is placed on click; commit immediately and open the inline editor.
         void this.commitDraft(true);
         this.mode = 'idle';
         return;
      }
      this.mode = 'draw';
      this.gestureActive.set(true);
   }

   updateDraw(clientX: number, clientY: number, shift: boolean, alt: boolean): void {
      const draft = this.draft();
      if (!draft) {
         return;
      }
      this.lastDrawPointer = { x: clientX, y: clientY };
      // Stay in the space the stroke started in, even when the pointer crosses a block edge.
      const view = this.slideViews().find((v) => v.frameId === this.drawSlideId());
      const raw = this.viewport.toWorldRaw(clientX, clientY);
      const world = view ? toInner(view, raw) : raw;
      const snap = this.gridSnap();
      if (draft.type === 'freedraw') {
         const pt = toRelative(draft, world);
         this.draft.set({ ...draft, points: [...(draft.points ?? []), pt] });
         return;
      }
      if (draft.type === 'line' || draft.type === 'arrow') {
         // Highlight the shape/table the free end would bind to; binding beats snapping.
         const bindBox = this.bindingTargetAt(world, draft.id)?.box ?? null;
         this.bindHighlight.set(bindBox);
         const space = { ctx: this.drawSlideId() ?? null, view };
         const spanOf = (px: number, py: number) => ({
            x0: Math.min(px, draft.x),
            y0: Math.min(py, draft.y),
            x1: Math.max(px, draft.x),
            y1: Math.max(py, draft.y),
         });
         let end: { x: number; y: number };
         if (shift) {
            // Lock to 45° steps from the start point, keeping the cursor's distance along it,
            // then slide along that direction to line up with nearby items.
            const vx = world.x - draft.x;
            const vy = world.y - draft.y;
            const step = Math.PI / 4;
            const ang = Math.round(Math.atan2(vy, vx) / step) * step;
            const ux = Math.cos(ang);
            const uy = Math.sin(ang);
            let len = vx * ux + vy * uy;
            const px = draft.x + ux * len;
            const py = draft.y + uy * len;
            const smart = bindBox
               ? null
               : this.smartEdges(
                    draft.id,
                    spanOf(px, py),
                    Math.abs(ux) > 1e-6 ? [px] : [],
                    Math.abs(uy) > 1e-6 ? [py] : [],
                    space
                 );
            const lx = smart?.snappedX ? (px + smart.ox - draft.x) / ux : null;
            const ly = smart?.snappedY ? (py + smart.oy - draft.y) / uy : null;
            const pick = [lx, ly]
               .filter((v): v is number => v !== null)
               .sort((a, b) => Math.abs(a - len) - Math.abs(b - len))[0];
            if (pick !== undefined && smart) {
               len = pick;
               if (pick !== lx)
                  Object.assign(smart, { snappedX: false, guides: smart.guides.filter((q) => q.axis === 'y') });
               if (pick !== ly)
                  Object.assign(smart, { snappedY: false, guides: smart.guides.filter((q) => q.axis === 'x') });
               this.smartSnapState.set(smart.guides.length ? { snap: smart, view: this.smartBase?.view } : null);
            } else {
               if (bindBox) this.smartSnapState.set(null);
               if (snap) len = snapToGrid(len);
            }
            end = { x: Math.round(ux * len), y: Math.round(uy * len) };
         } else {
            const smart = bindBox
               ? null
               : this.smartEdges(draft.id, spanOf(world.x, world.y), [world.x], [world.y], space);
            if (bindBox) this.smartSnapState.set(null);
            const ex = smart?.snappedX ? world.x + smart.ox : snap ? snapToGrid(world.x) : world.x;
            const ey = smart?.snappedY ? world.y + smart.oy : snap ? snapToGrid(world.y) : world.y;
            end = { x: ex - draft.x, y: ey - draft.y };
         }
         this.draft.set({ ...draft, points: [{ x: 0, y: 0 }, end] });
         return;
      }
      // Rectangle / ellipse / diamond: grow the box from the anchor. Shift forces a
      // square (circle for an ellipse); Alt makes the anchor the center.
      const ex = snap ? snapToGrid(world.x) : world.x;
      const ey = snap ? snapToGrid(world.y) : world.y;
      const { x: ax, y: ay } = this.drawAnchor;
      let dx = ex - ax;
      let dy = ey - ay;
      if (draft.type === 'frame') {
         // A preset frame is locked to its page ratio: width follows the pointer, height follows width.
         const ratio = framePreset(this.framePresetId()).ratio;
         if (ratio) {
            dy = (dy < 0 ? -1 : 1) * (Math.abs(dx) / ratio);
         }
      } else if (shift) {
         const size = Math.max(Math.abs(dx), Math.abs(dy));
         dx = (dx < 0 ? -1 : 1) * size;
         dy = (dy < 0 ? -1 : 1) * size;
      }
      if (alt) {
         this.draft.set({
            ...draft,
            x: ax - Math.abs(dx),
            y: ay - Math.abs(dy),
            width: Math.abs(dx) * 2,
            height: Math.abs(dy) * 2,
         });
         return;
      }
      this.draft.set({
         ...draft,
         x: Math.min(ax, ax + dx),
         y: Math.min(ay, ay + dy),
         width: Math.abs(dx),
         height: Math.abs(dy),
      });
   }

   /**
    * Persist the draft as a real element. Tiny click-only shapes get a sensible
    * default size so a single click still produces a visible element.
    */
   private async commitDraft(selectAfter: boolean): Promise<void> {
      const draft = this.draft();
      this.draft.set(null);
      const drawSlide = this.drawSlideId();
      this.drawSlideId.set(null);
      if (!draft) {
         return;
      }
      const dto = this.draftToDto(draft);
      if (drawSlide && draft.type !== 'frame') {
         dto.slideId = drawSlide;
      }
      // Auto-bind an arrow/line whose endpoint was drawn on top of a shape or table,
      // so it behaves as a flowchart connector and re-routes when the target moves.
      if ((draft.type === 'arrow' || draft.type === 'line') && draft.points?.length) {
         const pts = absolutePoints(draft);
         const start = this.bindingTargetAt(pts[0], draft.id);
         const end = this.bindingTargetAt(pts[pts.length - 1], draft.id);
         if (start) {
            dto.startBinding = start.binding;
         }
         if (end) {
            dto.endBinding = end.binding;
         }
      }
      // Freehand strokes keep the pen active (draw several in a row) and are not
      // selected, so no bounds/toolbar pop up between strokes. Shapes and text
      // revert to the select tool; the shape is selected for immediate styling and
      // text jumps into its inline editor.
      const isPen = draft.type === 'freedraw';
      const created = await this.store.addElement(dto, !isPen);
      if (!isPen && (draft.type === 'text' || !this.toolbarPrefs.stayOnTool())) {
         this.activeTool.set('select');
         if (created && selectAfter && created.type === 'text') {
            this.textEditing.editingTextId.set(created.id);
         }
         if (created && created.type === 'grid') {
            // A fresh table opens its first cell for typing.
            this.grids.beginEdit({ id: created.id, row: 0, col: 0 });
         }
         if (created && created.type === 'code') {
            // A fresh code card opens straight into its editor.
            this.textEditing.editingTextId.set(created.id);
         }
      }
   }

   private draftToDto(draft: CanvasElementModel): CreateElementDto {
      const { x, y, points } = draft;
      let { width, height } = draft;
      let text = draft.text;
      if (draft.type === 'rectangle' || draft.type === 'ellipse' || draft.type === 'diamond') {
         if (width < 4 && height < 4) {
            width = 120;
            height = 80;
         }
      }
      if (draft.type === 'grid' && (width < 40 || height < 24)) {
         const g = parseGrid(draft.text);
         width = g.cols.reduce((a, b) => a + b, 0);
         height = g.rows.reduce((a, b) => a + b, 0);
      }
      let fontSize = draft.fontSize;
      if (draft.type === 'grid') {
         // A table drawn bigger than the default starts with proportionally bigger
         // text (the same diagonal measure a resize uses), so it reads as drawn.
         const g = parseGrid(draft.text);
         const w0 = g.cols.reduce((a, b) => a + b, 0);
         const h0 = g.rows.reduce((a, b) => a + b, 0);
         const k = (width * w0 + height * h0) / (w0 * w0 + h0 * h0);
         fontSize = Math.round(Math.min(96, Math.max(10, (draft.fontSize ?? 14) * k)) * 2) / 2;
      }
      if (draft.type === 'code' && (width < 40 || height < 40)) {
         width = 360;
         height = 160;
      }
      if (draft.type === 'frame') {
         const preset = framePreset(this.framePresetId());
         if (width < 40 || height < 40) {
            width = preset.width;
            height = preset.height;
         }
         const count = this.store.elements().filter((e) => e.type === 'frame').length;
         text = text || `Frame ${count + 1}`;
      }
      return {
         type: draft.type,
         x,
         y,
         width,
         height,
         angle: 0,
         strokeColor: draft.strokeColor,
         backgroundColor: draft.backgroundColor,
         fillStyle: draft.fillStyle,
         strokeWidth: draft.strokeWidth,
         strokeStyle: draft.strokeStyle,
         opacity: draft.opacity,
         zIndex: draft.zIndex,
         cornerRadius: draft.cornerRadius,
         points,
         text,
         fontSize,
         fontFamily: draft.fontFamily,
         textAlign: draft.textAlign,
         startArrowhead: draft.startArrowhead,
         endArrowhead: draft.endArrowhead,
         curvature: draft.curvature,
         language: draft.language,
         fileName: draft.fileName,
      };
   }

   // --- canvas element pointer (select / move / resize / rotate / endpoint) ---

   /**
    * Unfilled shapes are grabbable anywhere inside, so a click can land on several
    * stacked outlines. Pick the innermost (smallest) of the unfilled shapes at the
    * point, down to the first opaque element, instead of whichever was drawn last.
    */
   private pickInnermostAt(clicked: CanvasElementModel, event: PointerEvent): CanvasElementModel {
      const unfilled = (e: CanvasElementModel): boolean =>
         (e.type === 'rectangle' || e.type === 'ellipse' || e.type === 'diamond') &&
         (e.fillStyle === 'none' || !e.backgroundColor);
      if (!unfilled(clicked)) {
         return clicked;
      }
      const world = this.viewport.toWorld(event.clientX, event.clientY);
      const hits = this.shownElements()
         .filter((e) => e.type !== 'frame' && hitTestElement(e, world))
         .reverse();
      let best = clicked;
      let bestArea = Infinity;
      for (const e of hits) {
         const b = elementBox(e);
         const area = (b.x1 - b.x0) * (b.y1 - b.y0);
         if (area < bestArea) {
            best = e;
            bestArea = area;
         }
         if (!unfilled(e)) {
            break;
         }
      }
      return best;
   }

   protected onElementPointerDown(payload: ShapePointerEvent): void {
      if (this.grids.editingCell()) {
         this.grids.endEdit();
      }
      const clicked = this.store.elements().find((e) => e.id === payload.id);
      if (!clicked) {
         this.selectedSlideSets.set([]);
         return;
      }
      const el = this.pickInnermostAt(clicked, payload.event);
      // A click inside an already-selected table works on its cells: click selects a
      // cell, Shift+click or a drag extends the selection (the table does not move).
      const sel = this.store.selectedElementIds();
      const ev = payload.event;
      if (
         el.type === 'grid' &&
         sel.length === 1 &&
         sel[0] === el.id &&
         !ev.ctrlKey &&
         !ev.metaKey &&
         !this.store.groupIdOf(el.id)
      ) {
         const cell = gridCellAt(el, this.viewport.toWorld(ev.clientX, ev.clientY));
         if (cell) {
            this.grids.selectCell({ id: el.id, ...cell }, ev.shiftKey);
            this.beginCellDragSelect(el.id);
            return;
         }
      }
      // Dragging part of the selection keeps whole-selected presentations selected.
      if (EditorComponent.additive(payload.event) || !this.store.selectedElementIds().includes(el.id)) {
         this.selectedSlideSets.set([]);
      }
      if (EditorComponent.additive(payload.event)) {
         this.store.selectElement(el.id, true);
         return;
      }
      if (!this.store.selectedElementIds().includes(el.id)) {
         this.store.selectElement(el.id, false);
      }
      if (el.type === 'grid') {
         // First click selects the whole table (styling applies to all of it).
         this.grids.clearCellSelection();
      }
      if (!this.store.canEdit()) {
         return;
      }
      this.startClientX = payload.event.clientX;
      this.startClientY = payload.event.clientY;
      this.gestureScale = this.itemScale(payload.id);
      this.gestureActive.set(true);
      this.dragCopied = false;
      this.beginElementDrag(el);
      if (payload.event.altKey) {
         void this.duplicateAndDrag();
      }
   }

   /** Extend a grid's cell selection to whatever cell the pointer is dragged over. */
   private beginCellDragSelect(id: string): void {
      const move = (e: PointerEvent): void => {
         const el = this.store.elements().find((x) => x.id === id);
         const cell = el ? gridCellAt(el, this.viewport.toWorld(e.clientX, e.clientY)) : null;
         if (cell) {
            this.grids.selectCell({ id, ...cell }, true);
         }
      };
      const up = (): void => {
         window.removeEventListener('pointermove', move);
         window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
   }

   /** Start moving the current element selection, grabbed by `el`. */
   private beginElementDrag(el: CanvasElementModel): void {
      this.mode = 'element';
      this.gestureActive.set(true);
      const others = new Map<string, { x: number; y: number }>();
      for (const id of this.store.selectedElementIds()) {
         const e = this.store.elements().find((x) => x.id === id);
         if (e) {
            others.set(id, { x: e.x, y: e.y });
         }
      }
      const carried = this.dragCopied
         ? null
         : this.carriedByFrames(others, {
              tableIds: new Set(this.store.selectedTableIds()),
              diagramIds: new Set(this.store.selectedDiagramIds()),
           });
      if (carried) {
         for (const [id, pos] of carried.elements) {
            others.set(id, pos);
         }
      }
      this.elementGesture = {
         id: el.id,
         start: { x: el.x, y: el.y, width: el.width, height: el.height, angle: el.angle },
         snapshot: el,
         others,
         tables: carried?.tables,
         waypoints: carried?.waypoints,
         sequences: carried?.sequences,
      };
   }

   /**
    * Everything fully inside any frame being moved (nested frames included) rides
    * along with it: elements, tables, and the manual routes between carried tables.
    * `extra` adds selected tables / diagrams (members of a mixed-kind group) that
    * move rigidly with the grabbed element. Null when nothing rides along.
    */
   private carriedByFrames(
      moving: { has(id: string): boolean },
      extra?: { tableIds: ReadonlySet<string>; diagramIds: ReadonlySet<string> }
   ): {
      elements: Map<string, { x: number; y: number }>;
      tables: Map<string, { x: number; y: number }>;
      waypoints: Map<string, { x: number; y: number }[]>;
      sequences: Map<string, SequenceStart>;
   } | null {
      const all = this.store.elements();
      const hasFrame = all.some((e) => e.type === 'frame' && moving.has(e.id));
      if (!hasFrame && !extra?.tableIds.size && !extra?.diagramIds.size) {
         return null;
      }
      const inner = hasFrame
         ? frameContents(
              { has: (id) => moving.has(id) } as ReadonlySet<string>,
              all,
              this.store.tables(),
              this.store.sequenceDiagrams(),
              this.store.lifelines(),
              this.store.sequenceMessages(),
              this.store.shownSlideIds()
           )
         : {
              elementIds: new Set<string>(),
              tableIds: new Set<string>(),
              diagramIds: new Set<string>(),
           };
      // Selected tables / diagrams (a group of mixed kinds) travel with the element.
      extra?.tableIds.forEach((id) => inner.tableIds.add(id));
      extra?.diagramIds.forEach((id) => inner.diagramIds.add(id));
      const elements = new Map<string, { x: number; y: number }>();
      for (const e of all) {
         if (inner.elementIds.has(e.id)) {
            elements.set(e.id, { x: e.x, y: e.y });
         }
      }
      const tables = new Map<string, { x: number; y: number }>();
      for (const t of this.store.tables()) {
         if (inner.tableIds.has(t.id)) {
            tables.set(t.id, { x: t.x, y: t.y });
         }
      }
      const waypoints = new Map<string, { x: number; y: number }[]>();
      if (tables.size) {
         const locs = this.columnLocations();
         for (const rel of this.store.relationships()) {
            const st = locs.get(rel.sourceColumnId)?.table.id;
            const tt = locs.get(rel.targetColumnId)?.table.id;
            if (st && tt && tables.has(st) && tables.has(tt) && rel.waypoints?.length) {
               waypoints.set(
                  rel.id,
                  rel.waypoints.map((w) => ({ ...w }))
               );
            }
         }
      }
      const sequences = new Map<string, SequenceStart>();
      for (const id of inner.diagramIds) {
         const start = this.sequenceStart(id);
         if (start) {
            sequences.set(id, start);
         }
      }
      return { elements, tables, waypoints, sequences };
   }

   /** Add freshly created copies (inside a duplicated frame) to the running drag. */
   private attachCarried(elementIds: string[], tableIds: string[], diagramIds: string[]): void {
      const g = this.elementGesture;
      if (!g?.others) {
         return;
      }
      for (const id of elementIds) {
         const e = this.store.elements().find((x) => x.id === id);
         if (e) {
            g.others.set(id, { x: e.x, y: e.y });
         }
      }
      g.tables = new Map(
         this.store
            .tables()
            .filter((t) => tableIds.includes(t.id))
            .map((t) => [t.id, { x: t.x, y: t.y }])
      );
      g.sequences = new Map(
         diagramIds
            .map((id) => [id, this.sequenceStart(id)] as const)
            .filter((e): e is readonly [string, SequenceStart] => !!e[1])
      );
   }

   /** A sequence diagram's current layout, captured so it can be shifted rigidly. */
   sequenceStart(diagramId: string): SequenceStart | null {
      const d = this.store.sequenceDiagrams().find((x) => x.id === diagramId);
      if (!d) {
         return null;
      }
      const hb = d.originY + d.headerHeight;
      const rowOf = (y: number): number => Math.max(1, Math.round((y - hb) / d.rowSpacing));
      return {
         xs: new Map(
            this.store
               .lifelines()
               .filter((l) => l.diagramId === diagramId)
               .map((l) => [l.id, l.x])
         ),
         originY: d.originY,
         rows: new Map(
            this.store
               .sequenceMessages()
               .filter((m) => m.diagramId === diagramId)
               .map((m) => [m.id, rowOf(m.y)])
         ),
      };
   }

   private groupResize: GroupResize | null = null;

   /**
    * Start resizing the whole multi-selection from one item's handle. Returns false
    * (leaving the caller to do a single-item resize) when fewer than two items are
    * selected. Handed to sequence diagrams too, which run their own pointer handling.
    */
   protected readonly startGroupResize = (handle: string, event: PointerEvent, scaleId?: string): boolean => {
      if (!this.store.canEdit()) {
         return false;
      }
      const elIds = new Set(this.store.selectedElementIds());
      const diagIds = new Set(this.store.selectedDiagramIds());
      const elements = this.store.elements().filter((e) => elIds.has(e.id) && e.type !== 'frame');
      const diagrams = this.store.sequenceDiagrams().filter((d) => diagIds.has(d.id));
      if (elements.length + diagrams.length < 2) {
         return false;
      }
      const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      const grow = (x0: number, y0: number, x1: number, y1: number): void => {
         box.x0 = Math.min(box.x0, x0);
         box.y0 = Math.min(box.y0, y0);
         box.x1 = Math.max(box.x1, x1);
         box.y1 = Math.max(box.y1, y1);
      };
      for (const e of elements) {
         const b = elementBox(e);
         grow(b.x0, b.y0, b.x1, b.y1);
      }
      const seqs: GroupResize['diagrams'] = [];
      for (const d of diagrams) {
         const b = this.diagramBox(d);
         const start = this.sequenceStart(d.id);
         if (!b || !start) continue;
         grow(b.minX, b.minY, b.maxX, b.maxY);
         seqs.push({ id: d.id, start, rowSpacing: d.rowSpacing, before: this.layoutSnapshot(d.id) });
      }
      if (!Number.isFinite(box.x0)) {
         return false;
      }
      this.mode = 'group-resize';
      this.gestureActive.set(true);
      this.startClientX = event.clientX;
      this.startClientY = event.clientY;
      this.gestureScale = scaleId ? this.itemScale(scaleId) : 1;
      this.groupResize = { handle, box, elements, diagrams: seqs };
      return true;
   };

   /**
    * Scale every item of a group resize about the group's box: the opposite edge
    * (or, with Alt, the centre) stays put, Shift keeps proportions, and items keep
    * their relative placement. Each item resizes the way it does on its own (text
    * and grids rescale their font, diagrams re-spread spines and rows).
    */
   private groupResizeMove(ev: PointerEvent): void {
      const g = this.groupResize;
      if (!g) {
         return;
      }
      const b = g.box;
      const zoom = this.store.viewport().zoom * this.gestureScale;
      const dx = (ev.clientX - this.startClientX) / zoom;
      const dy = (ev.clientY - this.startClientY) / zoom;
      const h = g.handle;
      const left = h.includes('w');
      const right = h.includes('e');
      const top = h.includes('n');
      const bottom = h.includes('s');
      const horiz = left || right;
      const vert = top || bottom;
      const W = Math.max(1, b.x1 - b.x0);
      const H = Math.max(1, b.y1 - b.y0);
      const f = ev.altKey ? 2 : 1;
      const gx = (left ? -dx : dx) * f;
      const gy = (top ? -dy : dy) * f;
      let sx = horiz ? (W + gx) / W : 1;
      let sy = vert ? (H + gy) / H : 1;
      if (ev.shiftKey) {
         if (horiz && vert) {
            // Project onto the box diagonal so the corner tracks the cursor smoothly.
            sx = sy = 1 + (gx * W + gy * H) / (W * W + H * H);
         } else if (horiz) {
            sy = sx;
         } else {
            sx = sy;
         }
      } else if (this.gridSnap() && !ev.altKey) {
         // Land the dragged edge(s) on the grid.
         if (horiz) {
            sx = right ? (snapToGrid(b.x0 + W * sx) - b.x0) / W : (b.x1 - snapToGrid(b.x1 - W * sx)) / W;
         }
         if (vert) {
            sy = bottom ? (snapToGrid(b.y0 + H * sy) - b.y0) / H : (b.y1 - snapToGrid(b.y1 - H * sy)) / H;
         }
      }
      sx = Math.max(0.05, sx);
      sy = Math.max(0.05, sy);
      const ax = ev.altKey ? (b.x0 + b.x1) / 2 : left ? b.x1 : b.x0;
      const ay = ev.altKey ? (b.y0 + b.y1) / 2 : top ? b.y1 : b.y0;
      const mx = (x: number): number => ax + (x - ax) * sx;
      const my = (y: number): number => ay + (y - ay) * sy;

      for (const e of g.elements) {
         if (e.type === 'line' || e.type === 'arrow' || e.type === 'freedraw') {
            const pts = absolutePoints(e).map((p) => ({ x: mx(p.x), y: my(p.y) }));
            const o = pts[0];
            this.store.patchElementLocal(e.id, {
               x: o.x,
               y: o.y,
               points: pts.map((p) => ({ x: p.x - o.x, y: p.y - o.y })),
            });
            continue;
         }
         const x = mx(e.x);
         const y = my(e.y);
         const w = Math.max(8, e.width * sx);
         const hh = Math.max(8, e.height * sy);
         // Where an item whose size is content-driven sits inside its scaled slot:
         // pinned the same way the group is (opposite edge, or centre with Alt).
         const place = (cw: number, ch: number): { x: number; y: number } => ({
            x: ev.altKey || !horiz ? x + (w - cw) / 2 : left ? x + w - cw : x,
            y: ev.altKey || !vert ? y + (hh - ch) / 2 : top ? y + hh - ch : y,
         });
         if (e.type === 'text') {
            const startFont = e.fontSize ?? DEFAULT_FONT_SIZE;
            const diag = e.width * e.width + e.height * e.height;
            const k = diag > 0 ? (w * e.width + hh * e.height) / diag : 1;
            let fontSize = Math.min(TEXT_MAX_FONT_SIZE, Math.max(TEXT_MIN_FONT_SIZE, startFont * k));
            fontSize = Math.round(fontSize * 2) / 2;
            const size = fitTextElement(e, {
               fontSize,
               width: e.wrap ? e.width * (fontSize / startFont) : undefined,
            });
            const p = place(size.width, size.height);
            this.store.patchElementLocal(e.id, {
               x: Math.round(p.x),
               y: Math.round(p.y),
               width: size.width,
               height: size.height,
               fontSize,
            });
         } else if (e.type === 'grid') {
            const r = this.gridResize(e, w, hh);
            const p = place(r.width, r.height);
            this.store.patchElementLocal(e.id, { ...r, x: p.x, y: p.y });
         } else {
            this.store.patchElementLocal(e.id, { x, y, width: w, height: hh });
         }
      }

      for (const d of g.diagrams) {
         const rowSpacing = Math.max(20, d.rowSpacing * sy);
         this.store.resizeSequenceTo(d.id, d.start.xs, ax, sx, rowSpacing, my(d.start.originY), d.start.rows);
      }
   }

   /**
    * When 2+ selected elements sit in one row or column with equal gaps, a handle
    * in the middle of each gap: dragging it respaces every gap at once.
    */
   private readonly evenSpacing = computed<{
      axis: 'x' | 'y';
      gap: number;
      items: { el: CanvasElementModel; box: { x0: number; y0: number; x1: number; y1: number } }[];
   } | null>(() => {
      if (!this.store.canEdit()) return null;
      const ids = new Set(this.store.selectedElementIds());
      if (ids.size < 2 || this.store.selectedTableIds().length || this.store.selectedDiagramIds().length) return null;
      const items = this.store
         .elements()
         .filter((e) => ids.has(e.id) && e.type !== 'frame')
         .map((el) => ({ el, box: elementBox(el) }));
      if (items.length < 2 || items.length !== ids.size) return null;
      for (const axis of ['x', 'y'] as const) {
         const lo = axis === 'x' ? 'x0' : 'y0';
         const hi = axis === 'x' ? 'x1' : 'y1';
         const sorted = [...items].sort((a, b) => a.box[lo] - b.box[lo]);
         const gaps = sorted.slice(1).map((it, i) => it.box[lo] - sorted[i].box[hi]);
         if (gaps.some((g) => g < 0)) continue;
         if (Math.max(...gaps) - Math.min(...gaps) > 1.5) continue;
         return { axis, gap: gaps.reduce((s, g) => s + g, 0) / gaps.length, items: sorted };
      }
      return null;
   });

   /** True while a gap handle is being dragged (keeps the guides on screen). */
   private readonly spacingActive = signal(false);

   /**
    * Screen-space gap marks for {@link evenSpacing}, drawn like the smart-guide
    * gap marks (line, end ticks, distance label) with a grab area on each line.
    */
   protected readonly spacingHandles = computed(() => {
      const s = this.evenSpacing();
      if (!s || (this.gestureActive() && !this.spacingActive())) return null;
      const v = this.store.viewport();
      const sx = (x: number): number => x * v.zoom + v.x;
      const sy = (y: number): number => y * v.zoom + v.y;
      const T = 3;
      return s.items.slice(1).map((it, k) => {
         const a = s.items[k].box;
         const b = it.box;
         const label = String(Math.round(s.axis === 'x' ? b.x0 - a.x1 : b.y0 - a.y1));
         if (s.axis === 'x') {
            const y = sy((Math.max(a.y0, b.y0) + Math.min(a.y1, b.y1)) / 2);
            const x1 = sx(a.x1);
            const x2 = sx(b.x0);
            return {
               vertical: true,
               line: { x1, y1: y, x2, y2: y },
               ticks: [
                  { x1, y1: y - T, x2: x1, y2: y + T },
                  { x1: x2, y1: y - T, x2, y2: y + T },
               ],
               label,
               lx: (x1 + x2) / 2,
               ly: y - 9,
               left: (x1 + x2) / 2,
               top: y,
               span: Math.max(12, x2 - x1),
            };
         }
         const x = sx((Math.max(a.x0, b.x0) + Math.min(a.x1, b.x1)) / 2);
         const y1 = sy(a.y1);
         const y2 = sy(b.y0);
         return {
            vertical: false,
            line: { x1: x, y1, x2: x, y2 },
            ticks: [
               { x1: x - T, y1, x2: x + T, y2: y1 },
               { x1: x - T, y1: y2, x2: x + T, y2 },
            ],
            label,
            lx: x + 6 + label.length * 3,
            ly: (y1 + y2) / 2,
            left: x,
            top: (y1 + y2) / 2,
            span: Math.max(12, y2 - y1),
         };
      });
   });

   private spacingDrag: {
      axis: 'x' | 'y';
      gap: number;
      items: { el: CanvasElementModel; box: { x0: number; y0: number; x1: number; y1: number } }[];
   } | null = null;

   protected startSpacingDrag(event: PointerEvent): void {
      const s = this.evenSpacing();
      if (!s || event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      this.spacingDrag = s;
      this.mode = 'spacing';
      this.spacingActive.set(true);
      this.gestureActive.set(true);
      this.startClientX = event.clientX;
      this.startClientY = event.clientY;
      (event.target as Element).setPointerCapture?.(event.pointerId);
   }

   private spacingMove(ev: PointerEvent): void {
      const g = this.spacingDrag;
      if (!g) return;
      const zoom = this.store.viewport().zoom;
      const delta = (g.axis === 'x' ? ev.clientX - this.startClientX : ev.clientY - this.startClientY) / zoom;
      let gap = Math.max(0, g.gap + delta);
      if (!ev.altKey) gap = Math.round(gap);
      let cursor = g.items[0].box[g.axis === 'x' ? 'x1' : 'y1'];
      g.items.forEach((it, i) => {
         if (i === 0) return;
         const start = it.box[g.axis === 'x' ? 'x0' : 'y0'];
         const target = cursor + gap;
         const shift = target - start;
         cursor = target + (g.axis === 'x' ? it.box.x1 - it.box.x0 : it.box.y1 - it.box.y0);
         this.store.patchElementLocal(it.el.id, g.axis === 'x' ? { x: it.el.x + shift } : { y: it.el.y + shift });
      });
   }

   private commitSpacingDrag(): void {
      const g = this.spacingDrag;
      this.spacingDrag = null;
      this.spacingActive.set(false);
      if (!g) return;
      const now = new Map(this.store.elements().map((e) => [e.id, e] as const));
      void this.store.batchHistory(async () => {
         await Promise.all(
            g.items.slice(1).map(({ el }) => {
               const cur = now.get(el.id);
               if (!cur || (cur.x === el.x && cur.y === el.y)) return null;
               return this.store.commitElementGeometry(el.id, { x: el.x, y: el.y }, { x: cur.x, y: cur.y });
            })
         );
      });
   }

   /** Persist a finished group resize as one undo step. */
   private commitGroupResize(): void {
      const g = this.groupResize;
      this.groupResize = null;
      if (!g) {
         return;
      }
      const now = new Map(this.store.elements().map((e) => [e.id, e] as const));
      const pick = (e: CanvasElementModel): UpdateElementDto =>
         e.type === 'line' || e.type === 'arrow' || e.type === 'freedraw'
            ? { x: e.x, y: e.y, points: e.points }
            : {
                 x: e.x,
                 y: e.y,
                 width: e.width,
                 height: e.height,
                 ...(e.type === 'text' ? { fontSize: e.fontSize, wrap: e.wrap ?? false } : {}),
                 ...(e.type === 'grid' ? { text: e.text ?? '', fontSize: e.fontSize } : {}),
              };
      void this.store.batchHistory(async () => {
         await Promise.all(
            g.elements.map((snap) => {
               const el = now.get(snap.id);
               return el ? this.store.commitElementGeometry(snap.id, pick(snap), pick(el)) : null;
            })
         );
         for (const d of g.diagrams) {
            const after = this.layoutSnapshot(d.id);
            for (const [lid, x] of after.lifelineXs) this.store.moveLifeline(lid, x);
            for (const [mid, y] of after.messageYs) this.store.moveMessage(mid, y);
            void this.store.updateSequenceConfig(d.id, {
               rowSpacing: after.rowSpacing,
               originY: after.originY,
            });
            this.store.recordSequenceLayout(d.id, d.before, after);
         }
      });
   }

   /**
    * A grid table resized to (about) `width` x `height`: columns share the width,
    * rows scale but never below what their text needs, and the font follows the
    * drag projected onto the box diagonal.
    */
   private gridResize(
      snapshot: CanvasElementModel,
      width: number,
      height: number
   ): { width: number; height: number; text: string; fontSize: number } {
      const start = gridInPixels(snapshot);
      const sw = snapshot.width;
      const sh = snapshot.height;
      const sx = width / Math.max(1, sw);
      const sy = height / Math.max(1, sh);
      const cols = start.cols.map((c) => Math.max(GRID_MIN_CELL, c * sx));
      const startFont = snapshot.fontSize ?? 14;
      const diag = sw * sw + sh * sh;
      const k = diag > 0 ? (width * sw + height * sh) / diag : 1;
      const fontSize = Math.round(Math.min(96, Math.max(6, startFont * k)) * 2) / 2;
      const needs = gridRowNeeds({ ...snapshot, fontSize }, start, cols);
      const rows = start.rows.map((r, i) => Math.max(GRID_MIN_CELL, needs[i], r * sy));
      return {
         width: cols.reduce((a, b) => a + b, 0),
         height: rows.reduce((a, b) => a + b, 0),
         text: serializeGrid({ ...start, cols, rows }),
         fontSize,
      };
   }

   protected onElementResizeDown(payload: ResizeDownEvent): void {
      const el = this.store.elements().find((e) => e.id === payload.id);
      if (!el || !this.store.canEdit()) {
         return;
      }
      if (this.startGroupResize(payload.handle, payload.event, payload.id)) {
         return;
      }
      this.mode = 'element-resize';
      this.gestureActive.set(true);
      this.startClientX = payload.event.clientX;
      this.startClientY = payload.event.clientY;
      this.gestureScale = this.itemScale(el.id);
      // A pen stroke's x/y is its first point, not its bounds: resize from the drawn box.
      const pb = el.type === 'freedraw' ? elementBox(el) : null;
      this.elementGesture = {
         id: el.id,
         handle: payload.handle,
         start: pb
            ? {
                 x: pb.x0,
                 y: pb.y0,
                 width: Math.max(1, pb.x1 - pb.x0),
                 height: Math.max(1, pb.y1 - pb.y0),
                 angle: el.angle,
              }
            : { x: el.x, y: el.y, width: el.width, height: el.height, angle: el.angle },
         snapshot: el,
      };
   }

   protected onElementRotateDown(payload: ShapePointerEvent): void {
      const el = this.store.elements().find((e) => e.id === payload.id);
      if (!el || !this.store.canEdit()) {
         return;
      }
      this.mode = 'element-rotate';
      this.gestureActive.set(true);
      this.elementGesture = {
         id: el.id,
         start: { x: el.x, y: el.y, width: el.width, height: el.height, angle: el.angle },
         snapshot: el,
      };
   }

   protected onElementEndpointDown(payload: ShapeEndpointEvent): void {
      const el = this.store.elements().find((e) => e.id === payload.id);
      if (!el || !this.store.canEdit()) {
         return;
      }
      this.mode = 'arrow-endpoint';
      this.gestureActive.set(true);
      this.elementGesture = {
         id: el.id,
         which: payload.which,
         start: { x: el.x, y: el.y, width: el.width, height: el.height, angle: el.angle },
         snapshot: el,
         points: absolutePoints(el),
      };
   }

   protected onElementBendDown(payload: ShapeBendEvent): void {
      const el = this.store.elements().find((e) => e.id === payload.id);
      if (!el || !this.store.canEdit()) {
         return;
      }
      this.mode = 'arrow-bend';
      this.gestureActive.set(true);
      this.elementGesture = {
         id: el.id,
         start: { x: el.x, y: el.y, width: el.width, height: el.height, angle: el.angle },
         snapshot: el,
      };
   }

   /** Drag the bend handle: curvature is the pointer's signed distance from the chord. */
   private moveBend(clientX: number, clientY: number): void {
      const g = this.elementGesture;
      const ends = g ? this.shapeViews().find((s) => s.id === g.id)?.ends : undefined;
      if (!g || !ends) {
         return;
      }
      const n = chordNormal(ends.start, ends.end);
      if (!n) {
         return;
      }
      const world = this.viewport.toWorld(clientX, clientY);
      const mid = { x: (ends.start.x + ends.end.x) / 2, y: (ends.start.y + ends.end.y) / 2 };
      let curvature = (world.x - mid.x) * n.x + (world.y - mid.y) * n.y;
      // Snap back to a straight line when the handle is dragged close to the chord.
      if (Math.abs(curvature) < 6) {
         curvature = 0;
      }
      this.store.patchElementLocal(g.id, { curvature });
   }

   /** After a move drag, record the net displacement of each element for undo. */
   private recordMoveGesture(): void {
      const g = this.elementGesture;
      if (!g?.others) {
         return;
      }
      const moves: { id: string; from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
      for (const [id, from] of g.others) {
         const el = this.store.elements().find((e) => e.id === id);
         if (el && (el.x !== from.x || el.y !== from.y)) {
            moves.push({ id, from, to: { x: el.x, y: el.y } });
         }
      }
      this.store.recordElementMove(moves);
      this.persistSequences(g.sequences?.keys() ?? []);
   }

   /** Persist sequence diagrams that were shifted live (the live shift is local-only). */
   private persistSequences(ids: Iterable<string>): void {
      for (const id of ids) {
         for (const l of this.store.lifelines().filter((x) => x.diagramId === id)) {
            this.store.moveLifeline(l.id, l.x);
         }
         for (const m of this.store.sequenceMessages().filter((x) => x.diagramId === id)) {
            this.store.moveMessage(m.id, m.y);
         }
         const cfg = this.store.sequenceDiagrams().find((x) => x.id === id);
         if (cfg) {
            void this.store.updateSequenceConfig(id, {
               rowSpacing: cfg.rowSpacing,
               originY: cfg.originY,
            });
         }
      }
   }

   /** After a table-grabbed drag, record/persist the elements and diagrams that rode along. */
   private settleNodeExtras(): void {
      const ex = this.nodeExtras;
      if (!ex) {
         return;
      }
      const moves: { id: string; from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
      for (const [id, from] of ex.elements) {
         const el = this.store.elements().find((e) => e.id === id);
         if (el && (el.x !== from.x || el.y !== from.y)) {
            moves.push({ id, from, to: { x: el.x, y: el.y } });
         }
      }
      this.store.recordElementMove(moves);
      this.persistSequences(ex.sequences.keys());
   }

   /** Where the elements/diagrams riding with a grabbed table go when it has moved (mx, my). */
   private nodeExtrasMoves(mx: number, my: number): Pick<ItemMoves, 'elements' | 'sequences'> {
      const ex = this.nodeExtras;
      if (!ex) {
         return {};
      }
      return {
         elements: new Map([...ex.elements].map(([id, p]) => [id, { x: p.x + mx, y: p.y + my }])),
         sequences: [...ex.sequences].map(([id, seq]) => ({
            diagramId: id,
            startXs: seq.xs,
            dx: mx,
            startOriginY: seq.originY,
            dy: my,
            startRows: seq.rows,
         })),
      };
   }

   private moveElements(clientX: number, clientY: number): void {
      const g = this.elementGesture;
      if (!g?.others) {
         return;
      }
      // Don't snap an unaligned item to the grid on a plain click.
      if (this.belowDragThreshold(clientX, clientY)) {
         return;
      }
      this.movingItems.set(true);
      let { dx, dy } = this.dragDelta(clientX, clientY);
      const smart = this.smartDelta(g.id, g.others.keys(), g.tables?.keys() ?? [], dx, dy, g.sequences?.keys() ?? []);
      dx += smart?.ox ?? 0;
      dy += smart?.oy ?? 0;
      const grid = this.gridSnap();
      const elements = new Map<string, { x: number; y: number }>();
      for (const [id, start] of g.others) {
         const nx = grid && !smart?.snappedX ? snapToGrid(start.x + dx) : Math.round(start.x + dx);
         const ny = grid && !smart?.snappedY ? snapToGrid(start.y + dy) : Math.round(start.y + dy);
         elements.set(id, { x: nx, y: ny });
      }
      const moves: ItemMoves = { elements };
      // Carry a frame's tables with it by the same (snapped) displacement as the frame.
      const grabbed = g.others.get(g.id);
      const to = elements.get(g.id);
      if (grabbed && to && (g.tables?.size || g.waypoints?.size || g.sequences?.size)) {
         const mx = to.x - grabbed.x;
         const my = to.y - grabbed.y;
         moves.tables = new Map([...(g.tables ?? [])].map(([id, start]) => [id, { x: start.x + mx, y: start.y + my }]));
         moves.waypoints = new Map(
            [...(g.waypoints ?? [])].map(([relId, wp]) => [
               relId,
               wp.map((w) => ({ x: Math.round(w.x + mx), y: Math.round(w.y + my) })),
            ])
         );
         moves.sequences = [...(g.sequences ?? [])].map(([id, seq]) => ({
            diagramId: id,
            startXs: seq.xs,
            dx: mx,
            startOriginY: seq.originY,
            dy: my,
            startRows: seq.rows,
         }));
      }
      // One state write per frame for the whole selection.
      this.store.moveItemsLocal(moves);
   }

   /**
    * Resize a shape by a corner handle. Shift keeps proportions, Alt resizes about
    * the center, and grid snap (when on) snaps the dimensions.
    */
   private resizeElement(ev: PointerEvent): void {
      const g = this.elementGesture;
      if (!g?.handle) {
         return;
      }
      const s = g.start;
      const zoom = this.store.viewport().zoom * this.gestureScale;
      const dx = (ev.clientX - this.startClientX) / zoom;
      const dy = (ev.clientY - this.startClientY) / zoom;
      const left = g.handle === 'nw' || g.handle === 'sw' || g.handle === 'w';
      const top = g.handle === 'nw' || g.handle === 'ne';
      const cx = s.x + s.width / 2;
      const cy = s.y + s.height / 2;
      const factor = ev.altKey ? 2 : 1;

      const resized = this.store.elements().find((e) => e.id === g.id);
      if (g.handle === 'e' || g.handle === 'w') {
         // A side handle on text fixes its width: it wraps and the height follows the text.
         if (resized?.type !== 'text') {
            return;
         }
         let width = Math.max(24, s.width + (left ? -dx : dx) * factor);
         if (this.gridSnap()) {
            width = Math.max(24, snapToGrid(width));
         }
         const wrapped: CanvasElementModel = { ...resized, wrap: true };
         const size = fitTextElement(wrapped, { width });
         const nx = ev.altKey ? cx - width / 2 : left ? s.x + s.width - width : s.x;
         this.store.patchElementLocal(g.id, {
            x: Math.round(nx),
            width,
            height: size.height,
            wrap: true,
         });
         return;
      }
      // Pictures keep their proportions by default; Shift frees them (inverse of shapes).
      const keepProportions = resized?.type === 'image' ? !ev.shiftKey : ev.shiftKey;

      const grow = (left ? -dx : dx) * factor;
      const growY = (top ? -dy : dy) * factor;
      let width: number;
      let height: number;
      if (keepProportions && s.width > 0 && s.height > 0) {
         // Project the drag onto the box's diagonal so the corner tracks the cursor
         // smoothly instead of jumping between the two axes.
         const diag = s.width * s.width + s.height * s.height;
         const frameMinH = this.store.slideFrames().some((f) => f.id === g.id)
            ? EditorComponent.PANEL_MIN_H / s.height
            : 0;
         const minScale = Math.max(8 / Math.min(s.width, s.height), frameMinH);
         let scale = Math.max(minScale, 1 + (grow * s.width + growY * s.height) / diag);
         const smart =
            ev.altKey || resized?.type === 'text'
               ? null
               : this.resizeSnap(g.id, s, left, top, s.width * scale, s.height * scale);
         if (smart?.snappedX || smart?.snappedY) {
            const w = s.width * scale + (smart.snappedX ? (left ? -smart.ox : smart.ox) : 0);
            const h = s.height * scale + (smart.snappedY ? (top ? -smart.oy : smart.oy) : 0);
            // Follow whichever edge snapped (X wins when both did).
            scale = Math.max(minScale, smart.snappedX ? w / s.width : h / s.height);
         } else if (this.gridSnap()) {
            // Snap one dimension and derive the other so the ratio survives snapping.
            scale = Math.max(minScale, snapToGrid(s.width * scale) / s.width);
         }
         width = s.width * scale;
         height = s.height * scale;
      } else {
         // A slide frame is never shorter than the panels pinned to it.
         const minH = this.store.slideFrames().some((f) => f.id === g.id) ? EditorComponent.PANEL_MIN_H : 8;
         width = Math.max(8, s.width + grow);
         height = Math.max(minH, s.height + growY);
         const smart =
            ev.altKey || resized?.type === 'text' ? null : this.resizeSnap(g.id, s, left, top, width, height);
         if (smart?.snappedX) width = Math.max(8, width + (left ? -smart.ox : smart.ox));
         else if (this.gridSnap()) width = Math.max(8, snapToGrid(width));
         if (smart?.snappedY) height = Math.max(minH, height + (top ? -smart.oy : smart.oy));
         else if (this.gridSnap()) height = Math.max(minH, snapToGrid(height));
      }

      let x: number;
      let y: number;
      if (ev.altKey) {
         x = cx - width / 2;
         y = cy - height / 2;
      } else {
         x = left ? s.x + s.width - width : s.x;
         y = top ? s.y + s.height - height : s.y;
      }

      // Resizing a TEXT element scales its font (like Excalidraw): the handles
      // never change where the text wraps, only how big it is. The dragged corner
      // projects onto the box diagonal, and the opposite corner stays anchored.
      const el = this.store.elements().find((e) => e.id === g.id);
      if (el?.type === 'text') {
         const startFont = g.snapshot.fontSize ?? DEFAULT_FONT_SIZE;
         const diag = s.width * s.width + s.height * s.height;
         const raw = diag > 0 ? 1 + (grow * s.width + growY * s.height) / diag : 1;
         let fontSize = startFont * Math.max(0.05, raw);
         fontSize = Math.min(TEXT_MAX_FONT_SIZE, Math.max(TEXT_MIN_FONT_SIZE, fontSize));
         fontSize = Math.round(fontSize * 2) / 2;
         // A fixed-width block scales its width with the font so its wrapping is unchanged.
         const size = fitTextElement(el, {
            fontSize,
            width: el.wrap ? s.width * (fontSize / startFont) : undefined,
         });
         const tx = ev.altKey ? cx - size.width / 2 : left ? s.x + s.width - size.width : s.x;
         const ty = ev.altKey ? cy - size.height / 2 : top ? s.y + s.height - size.height : s.y;
         this.store.patchElementLocal(g.id, {
            x: Math.round(tx),
            y: Math.round(ty),
            width: size.width,
            height: size.height,
            fontSize,
         });
         return;
      }

      if (el?.type === 'grid') {
         // Columns share the new width proportionally; rows scale too but never
         // shrink below what their text needs, so cell content is never clipped.
         // Text scales with the table like a text box does: by the drag projected onto
         // the box diagonal, so a corner drag in any direction grows/shrinks it evenly.
         const r = this.gridResize(g.snapshot, width, height);
         const w = r.width;
         const h = r.height;
         this.store.patchElementLocal(g.id, {
            ...r,
            x: ev.altKey ? cx - w / 2 : left ? s.x + s.width - w : s.x,
            y: ev.altKey ? cy - h / 2 : top ? s.y + s.height - h : s.y,
         });
         return;
      }

      if (el?.type === 'freedraw') {
         // Scale the stroke's points from the start box into the new one.
         const sx = width / s.width;
         const sy = height / s.height;
         const pts = absolutePoints(g.snapshot).map((p) => ({ x: x + (p.x - s.x) * sx, y: y + (p.y - s.y) * sy }));
         const o = pts[0] ?? { x, y };
         this.store.patchElementLocal(g.id, {
            x: o.x,
            y: o.y,
            width,
            height,
            points: pts.map((p) => ({ x: p.x - o.x, y: p.y - o.y })),
         });
         return;
      }

      this.store.patchElementLocal(g.id, { x, y, width, height });
   }

   /** Smart-guide snap of the dragged corner's edges for a resize to (width, height). */
   private resizeSnap(
      id: string,
      s: { x: number; y: number; width: number; height: number; angle?: number | null },
      left: boolean,
      top: boolean,
      width: number,
      height: number
   ): SmartSnap | null {
      // Rotated boxes have no axis-aligned edges to line up.
      if (s.angle) return null;
      const x0 = left ? s.x + s.width - width : s.x;
      const y0 = top ? s.y + s.height - height : s.y;
      const box = { x0, y0, x1: x0 + width, y1: y0 + height };
      return this.smartEdges(id, box, [left ? box.x0 : box.x1], [top ? box.y0 : box.y1]);
   }

   private rotateElement(ev: PointerEvent): void {
      const g = this.elementGesture;
      if (!g) {
         return;
      }
      const cx = g.start.x + g.start.width / 2;
      const cy = g.start.y + g.start.height / 2;
      const world = this.viewport.toWorld(ev.clientX, ev.clientY);
      // Handle sits above the top edge, so offset by +90deg to make "up" = 0.
      let angle = Math.atan2(world.y - cy, world.x - cx) + Math.PI / 2;
      if (ev.shiftKey) {
         const step = Math.PI / 12; // snap to 15 degrees
         angle = Math.round(angle / step) * step;
      }
      this.store.patchElementLocal(g.id, { angle });
   }

   /** Drag a line/arrow endpoint, binding to a table/element under the cursor. */
   private moveEndpoint(clientX: number, clientY: number): void {
      const g = this.elementGesture;
      if (!g?.points || !g.which) {
         return;
      }
      const el = this.store.elements().find((e) => e.id === g.id);
      if (!el) {
         return;
      }
      let world = this.viewport.toWorld(clientX, clientY);
      const target = this.bindingTargetAt(world, g.id);
      this.bindHighlight.set(target?.box ?? null);
      const binding = target?.binding ?? null;
      const pts = g.points.map((p) => ({ ...p }));
      const idx = g.which === 'start' ? 0 : pts.length - 1;
      if (!binding) {
         // The neighbouring point anchors the Shift angle lock.
         const anchor = pts[g.which === 'start' ? 1 : pts.length - 2] ?? pts[idx];
         if (this.shiftHeld) {
            // Lock to 45° steps around the anchor, keeping the cursor's distance along it.
            const vx = world.x - anchor.x;
            const vy = world.y - anchor.y;
            const step = Math.PI / 4;
            const ang = Math.round(Math.atan2(vy, vx) / step) * step;
            const ux = Math.cos(ang);
            const uy = Math.sin(ang);
            let len = vx * ux + vy * uy;
            const px = anchor.x + ux * len;
            const py = anchor.y + uy * len;
            const box = {
               x0: Math.min(px, anchor.x),
               y0: Math.min(py, anchor.y),
               x1: Math.max(px, anchor.x),
               y1: Math.max(py, anchor.y),
            };
            // Snap along the locked direction: slide the point until its x or y hits a guide.
            const smart = this.smartEdges(g.id, box, Math.abs(ux) > 1e-6 ? [px] : [], Math.abs(uy) > 1e-6 ? [py] : []);
            const lx = smart?.snappedX ? (px + smart.ox - anchor.x) / ux : null;
            const ly = smart?.snappedY ? (py + smart.oy - anchor.y) / uy : null;
            const pick = [lx, ly]
               .filter((v): v is number => v !== null)
               .sort((a, b) => Math.abs(a - len) - Math.abs(b - len))[0];
            if (pick !== undefined) {
               len = pick;
               if (smart && pick !== lx)
                  Object.assign(smart, { snappedX: false, guides: smart.guides.filter((q) => q.axis === 'y') });
               if (smart && pick !== ly)
                  Object.assign(smart, { snappedY: false, guides: smart.guides.filter((q) => q.axis === 'x') });
               this.smartSnapState.set(smart?.guides.length ? { snap: smart, view: this.smartBase?.view } : null);
            } else if (this.gridSnap()) {
               len = snapToGrid(len);
            }
            world = { x: Math.round(anchor.x + ux * len), y: Math.round(anchor.y + uy * len) };
         } else {
            const box = {
               x0: Math.min(world.x, anchor.x),
               y0: Math.min(world.y, anchor.y),
               x1: Math.max(world.x, anchor.x),
               y1: Math.max(world.y, anchor.y),
            };
            const smart = this.smartEdges(g.id, box, [world.x], [world.y]);
            const grid = this.gridSnap();
            world = {
               x: smart?.snappedX ? world.x + smart.ox : grid ? snapToGrid(world.x) : Math.round(world.x),
               y: smart?.snappedY ? world.y + smart.oy : grid ? snapToGrid(world.y) : Math.round(world.y),
            };
         }
      } else {
         this.smartSnapState.set(null);
      }
      pts[idx] = world;
      // Points are stored relative to the element origin (its first point).
      const origin = pts[0];
      const relative = pts.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y }));
      this.store.patchElementLocal(g.id, {
         x: origin.x,
         y: origin.y,
         points: relative,
         ...(g.which === 'start' ? { startBinding: binding } : { endBinding: binding }),
      });
   }

   /** The table or element under a world point that a bound endpoint can attach to. */
   private bindingTargetAt(
      world: { x: number; y: number },
      excludeElementId: string
   ): {
      binding: { targetKind: 'element' | 'table' | 'message'; targetId: string };
      box: { x: number; y: number; width: number; height: number };
   } | null {
      const toRect = (b: Box) => ({ x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 });
      // Sequence message labels are small and sit on top of everything: check first.
      for (const [id, box] of this.messageBoxes()) {
         if (this.pointInBox(world, box)) {
            return { binding: { targetKind: 'message', targetId: id }, box: toRect(box) };
         }
      }
      for (const table of this.store.tables()) {
         const box = tableBox(table);
         if (this.pointInBox(world, box)) {
            return { binding: { targetKind: 'table', targetId: table.id }, box: toRect(box) };
         }
      }
      // Topmost element first (elements render in ascending zIndex order).
      const elements = this.shownElements().reverse();
      for (const el of elements) {
         if (el.id === excludeElementId || el.type === 'line' || el.type === 'arrow' || el.type === 'frame') {
            continue;
         }
         const box = elementBox(el);
         if (this.pointInBox(world, box)) {
            return { binding: { targetKind: 'element', targetId: el.id }, box: toRect(box) };
         }
      }
      return null;
   }

   private pointInBox(p: { x: number; y: number }, box: Box): boolean {
      return p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1;
   }

   /** Persist the element geometry changed by the just-finished gesture (with undo). */
   private commitElementGesture(): void {
      const g = this.elementGesture;
      if (!g) {
         return;
      }
      const el = this.store.elements().find((e) => e.id === g.id);
      if (!el) {
         return;
      }
      const snap = g.snapshot;
      if (this.mode === 'element-resize') {
         const scaled = el.type === 'text';
         void this.store.commitElementGeometry(
            g.id,
            {
               x: snap.x,
               y: snap.y,
               width: snap.width,
               height: snap.height,
               ...(scaled ? { fontSize: snap.fontSize, wrap: snap.wrap ?? false } : {}),
               ...(el.type === 'grid' ? { text: snap.text ?? '', fontSize: snap.fontSize } : {}),
               ...(el.type === 'freedraw' ? { points: snap.points } : {}),
            },
            {
               x: el.x,
               y: el.y,
               width: el.width,
               height: el.height,
               ...(scaled ? { fontSize: el.fontSize, wrap: el.wrap ?? false } : {}),
               ...(el.type === 'grid' ? { text: el.text ?? '', fontSize: el.fontSize } : {}),
               ...(el.type === 'freedraw' ? { points: el.points } : {}),
            }
         );
      } else if (this.mode === 'element-rotate') {
         void this.store.commitElementGeometry(g.id, { angle: snap.angle }, { angle: el.angle });
      } else if (this.mode === 'arrow-bend') {
         void this.store.commitElementGeometry(
            g.id,
            { curvature: snap.curvature ?? 0 },
            { curvature: el.curvature ?? 0 }
         );
      } else if (this.mode === 'arrow-endpoint') {
         void this.store.commitElementGeometry(
            g.id,
            {
               x: snap.x,
               y: snap.y,
               points: snap.points,
               startBinding: snap.startBinding ?? null,
               endBinding: snap.endBinding ?? null,
            },
            {
               x: el.x,
               y: el.y,
               points: el.points,
               startBinding: el.startBinding ?? null,
               endBinding: el.endBinding ?? null,
            }
         );
      }
   }

   // --- rich text editing (contenteditable) ---

   readonly gridCellArea = viewChild<ElementRef<HTMLTextAreaElement>>('gridCellArea');
   readonly richEditorRef = viewChild<ElementRef<HTMLDivElement>>('richEditor');

   // --- node pointer (select / drag) ---

   protected onNodePointerDown(event: PointerEvent, table: TableModel): void {
      if (event.button !== 0) {
         return;
      }
      event.stopPropagation();
      if (EditorComponent.additive(event)) {
         this.store.selectTable(table.id, true);
         return;
      }
      if (!this.store.selectedTableIds().includes(table.id)) {
         this.store.selectTable(table.id, false);
      }
      if (!this.store.canEdit()) {
         return;
      }
      this.startClientX = event.clientX;
      this.startClientY = event.clientY;
      this.gestureScale = this.itemScale(table.id);
      this.dragCopied = false;
      this.beginNodeDrag(table.id);
      if (event.altKey) {
         void this.duplicateAndDrag();
      }
   }

   /**
    * Switch an in-progress move (element or table drag) into a duplicate-drag: put
    * the originals back where the drag began, clone the selection in place, and
    * carry on dragging the copies from the same pointer origin. Works when Alt is
    * held at pointer-down or pressed part-way through the drag.
    */
   async duplicateAndDrag(): Promise<void> {
      const kind = this.mode;
      if (this.dragCopied || (kind !== 'element' && kind !== 'node') || !this.store.canEdit()) {
         return;
      }
      this.dragCopied = true;
      const grabbedElement = this.elementGesture?.id ?? null;
      const grabbedTable = this.dragTableId;
      if (kind === 'element') {
         const g = this.elementGesture;
         this.store.moveItemsLocal({
            elements: g?.others,
            tables: g?.tables,
            waypoints: g?.waypoints,
            sequences: [...(g?.sequences ?? [])].map(([id, seq]) => ({
               diagramId: id,
               startXs: seq.xs,
               dx: 0,
               startOriginY: seq.originY,
               dy: 0,
               startRows: seq.rows,
            })),
         });
      } else {
         this.store.moveItemsLocal({
            tables: this.multiDragStart,
            waypoints: new Map([...this.waypointDragStart].map(([relId, start]) => [relId, start.wp])),
            ...this.nodeExtrasMoves(0, 0),
         });
      }
      this.mode = 'duplicating';
      let resume: (() => void) | null = null;
      let created: string[] = [];
      const selectedIds = this.store.selectedElementIds();
      const slideNames =
         kind === 'element'
            ? [
                 ...new Set(
                    this.store
                       .slideFrames()
                       .filter((f) => selectedIds.includes(f.id))
                       .map((f) => presentationOf(f))
                 ),
              ]
            : [];
      if (slideNames.length) {
         // Alt-dragging presentations' slides copies each whole presentation: every slide
         // with its contents, under a new name, dragged off as one set. Anything else
         // selected is copied alongside.
         // The originals were put back above; bring their other (hidden) slides back with
         // them now, before copies exist that the catch-up could mistake for their own slides.
         this.placement.syncSlideMoves();
         const copied = new Set<string>();
         const allCopies = new Map<string, CanvasElementModel>();
         const tableCopies: string[] = [];
         const sequenceCopies: string[] = [];
         const selectedCopies: string[] = [];
         const names: string[] = [];
         for (const presentation of slideNames) {
            const frames = presentationSlides(this.store.slideFrames(), presentation);
            const frameIds = new Set(frames.map((f) => f.id));
            const inner = frameContents(
               frameIds,
               this.store.elements(),
               this.store.tables(),
               this.store.sequenceDiagrams(),
               this.store.lifelines(),
               this.store.sequenceMessages(),
               this.store.shownSlideIds()
            );
            const name = this.placement.newPresentationName();
            names.push(name);
            const sources = this.store.elements().filter((e) => frameIds.has(e.id) || inner.elementIds.has(e.id));
            sources.forEach((e) => copied.add(e.id));
            // One optimistic clone per presentation: the copies show at once.
            const cloned = this.store.cloneItems(inner.tableIds, inner.diagramIds, sources, 0, 0, {
               presentation: name,
            });
            cloned.copies.forEach((c, id) => allCopies.set(id, c));
            tableCopies.push(...cloned.tables.values());
            sequenceCopies.push(...cloned.diagrams.values());
            const shown = frames.find((f) => selectedIds.includes(f.id));
            const shownCopy = shown && cloned.copies.get(shown.id);
            if (shownCopy) {
               this.store.setActiveSlide(shownCopy.id);
               selectedCopies.push(shownCopy.id);
            }
         }
         // The rest of the selection (not part of a copied presentation) is copied too.
         const rest = new Set(selectedIds.filter((id) => !copied.has(id)));
         if (rest.size) {
            const inner = this.carriedByFrames(rest);
            const sources = this.store.elements().filter((e) => rest.has(e.id) || inner?.elements.has(e.id));
            const cloned = this.store.cloneItems(
               new Set(inner?.tables.keys() ?? []),
               new Set(inner?.sequences.keys() ?? []),
               sources,
               0,
               0
            );
            cloned.copies.forEach((c, id) => allCopies.set(id, c));
            tableCopies.push(...cloned.tables.values());
            sequenceCopies.push(...cloned.diagrams.values());
            for (const id of rest) {
               const c = cloned.copies.get(id);
               if (c) selectedCopies.push(c.id);
            }
         }
         created = [...allCopies.values()].map((c) => c.id);
         const grabbed =
            (grabbedElement && allCopies.get(grabbedElement)) ||
            allCopies.get(selectedIds.find((id) => allCopies.has(id)) ?? '');
         if (grabbed) {
            resume = () => {
               this.store.setSelection([], [], selectedCopies);
               // Record where the copied slides start, so the release catches the hidden ones up
               // (as in a plain slide drag) instead of moving every slide on each pointer move.
               for (const c of allCopies.values()) {
                  if (c.type === 'frame' && c.slide) {
                     this.placement.slideBounds.set(c.id, { x: c.x, y: c.y, w: c.width, h: c.height });
                  }
               }
               this.beginElementDrag(grabbed);
               // Only what's on the shown slides (and the rest of the selection) rides along.
               const g = this.elementGesture;
               const carried = g?.others && this.carriedByFrames(g.others);
               if (g?.others && carried) {
                  for (const [id, pos] of carried.elements) g.others.set(id, pos);
                  g.tables = carried.tables;
                  g.waypoints = carried.waypoints;
                  g.sequences = carried.sequences;
               }
               this.selectedSlideSets.set(names);
            };
         }
      } else if (kind === 'element') {
         const selected = new Set(this.store.selectedElementIds());
         // Duplicating a frame duplicates what's inside it too (tables, sequence
         // diagrams, and elements), and the copies travel with the copied frame.
         const inner = this.carriedByFrames(selected);
         // One optimistic clone of selected + inner items: shows at once, one undo step,
         // bindings between copies remap and a copied slide's contents follow its copy.
         const sources = this.store.elements().filter((e) => selected.has(e.id) || inner?.elements.has(e.id));
         const cloned = this.store.cloneItems(
            new Set(inner?.tables.keys() ?? []),
            new Set(inner?.sequences.keys() ?? []),
            sources,
            0,
            0
         );
         const copies = cloned.copies;
         const tableCopies = [...cloned.tables.values()];
         const sequenceCopies = [...cloned.diagrams.values()];
         created = [...copies.values()].map((c) => c.id);
         // An Alt-dragged slide becomes the one shown (only one slide is on the canvas).
         const slideCopy = [...copies.values()].find((c) => c.type === 'frame' && c.slide);
         if (slideCopy) {
            this.store.setActiveSlide(slideCopy.id);
         }
         const grabbed = (grabbedElement && copies.get(grabbedElement)) || [...copies.values()][0];
         if (grabbed) {
            const innerElementCopies = [...(inner?.elements.keys() ?? [])]
               .map((id) => copies.get(id)?.id)
               .filter((id): id is string => !!id);
            resume = () => {
               // Select only what was selected; the inner copies ride along as carried content.
               const selectedCopies = [...selected].map((id) => copies.get(id)?.id).filter((id): id is string => !!id);
               this.store.setSelection([], [], selectedCopies);
               this.beginElementDrag(grabbed);
               this.attachCarried(innerElementCopies, tableCopies, sequenceCopies);
            };
         }
      } else {
         const cloned = this.store.cloneItems(
            new Set(this.store.selectedTableIds()),
            new Set(),
            [],
            0,
            0,
            // Only selected relationships between the copied tables are copied.
            { relationshipIds: new Set(this.store.selectedRelationshipIds()) }
         );
         const ids = cloned.tables;
         created = [...ids.values()];
         const relCopies = cloned.relationships;
         this.store.setSelection(created, relCopies, []);
         const grabbed = (grabbedTable && ids.get(grabbedTable)) || created[0];
         if (grabbed) {
            resume = () => this.beginNodeDrag(grabbed);
         }
      }
      if (this.mode !== 'duplicating' || !resume) {
         // Nothing was copied (or the gesture was cancelled meanwhile).
         this.releasedWhileDuplicating = false;
         if (this.mode === 'duplicating') {
            this.mode = 'idle';
            this.gestureActive.set(false);
         }
         return;
      }
      resume();
      if (this.lastPointer) {
         this.handlePointerMove(this.lastPointer);
      }
      if (this.releasedWhileDuplicating) {
         // The button was let go before the copies existed: land them where it was dropped.
         this.releasedWhileDuplicating = false;
         this.onPointerUp();
      }
   }

   /**
    * Pointer displacement (world units) of a move drag. While Shift is held (moving
    * or Alt-duplicating), movement locks to the dominant axis relative to the start.
    */
   /** True while the pointer is still within click-jitter range of where the drag began. */
   private belowDragThreshold(clientX: number, clientY: number): boolean {
      return Math.hypot(clientX - this.startClientX, clientY - this.startClientY) < 3;
   }

   /**
    * Screen px -> world units factor of the current move/resize beyond the canvas zoom:
    * the slide zoom of the slide the grabbed item is drawn in (1 on the plain canvas).
    */
   private gestureScale = 1;

   private dragDelta(clientX: number, clientY: number): { dx: number; dy: number } {
      const zoom = this.store.viewport().zoom * this.gestureScale;
      let dx = (clientX - this.startClientX) / zoom;
      let dy = (clientY - this.startClientY) / zoom;
      if (this.shiftHeld) {
         if (Math.abs(dx) > Math.abs(dy)) {
            dy = 0;
         } else {
            dx = 0;
         }
      }
      return { dx, dy };
   }

   /** Start moving the current table selection, grabbed by `tableId`. */
   private beginNodeDrag(tableId: string): void {
      this.mode = 'node';
      this.dragTableId = tableId;
      this.multiDragStart = new Map(
         this.store
            .tables()
            .filter((t) => this.store.selectedTableIds().includes(t.id))
            .map((t) => [t.id, { x: t.x, y: t.y }])
      );

      const elementIds = new Set(this.store.selectedElementIds());
      const diagramIds = this.store.selectedDiagramIds();
      this.nodeExtras =
         elementIds.size || diagramIds.length
            ? {
                 elements: new Map(
                    this.store
                       .elements()
                       .filter((e) => elementIds.has(e.id))
                       .map((e) => [e.id, { x: e.x, y: e.y }] as const)
                 ),
                 sequences: new Map(
                    diagramIds
                       .map((id) => [id, this.sequenceStart(id)] as const)
                       .filter((e): e is readonly [string, SequenceStart] => !!e[1])
                 ),
              }
            : null;

      const moved = new Set(this.store.selectedTableIds());
      const locs = this.columnLocations();
      this.waypointDragStart = new Map();
      for (const rel of this.store.relationships()) {
         const st = locs.get(rel.sourceColumnId)?.table.id;
         const tt = locs.get(rel.targetColumnId)?.table.id;
         const srcMoved = !!st && moved.has(st);
         const tgtMoved = !!tt && moved.has(tt);
         if (srcMoved || tgtMoved) {
            this.waypointDragStart.set(rel.id, {
               wp: (rel.waypoints ?? []).map((w) => ({ ...w })),
               both: srcMoved && tgtMoved,
               sourceMoved: srcMoved,
            });
         }
      }
   }

   protected onConnectorSelect(payload: { id: string; event: PointerEvent }): void {
      this.store.selectRelationship(payload.id, EditorComponent.additive(payload.event));
   }

   // --- relationship linking / re-pointing ---

   protected onHandleDown(payload: HandleEvent): void {
      if (!this.store.canEdit()) {
         return;
      }
      payload.event.preventDefault();
      this.relinkState.set(null);
      this.linkSourceColumnId.set(payload.columnId);
      this.linkSourceSide.set(payload.side);
      const loc = this.columnLocations().get(payload.columnId);
      if (loc) {
         const a = columnAnchor(loc.table, loc.index, payload.side);
         this.linkCursor.set({ x: a.x, y: a.y });
      }
   }

   protected onEndpointDown(payload: EndpointDownEvent): void {
      if (!this.store.canEdit()) {
         return;
      }
      this.linkSourceColumnId.set(null);
      this.relinkState.set({ relationshipId: payload.relationshipId, which: payload.which });
      this.linkCursor.set(this.viewport.toWorld(payload.event.clientX, payload.event.clientY));
   }

   protected onHandleUp(payload: HandleEvent): void {
      const relink = this.relinkState();
      if (relink) {
         payload.event.stopPropagation();
         const rel = this.store.relationships().find((r) => r.id === relink.relationshipId);
         const opposite = relink.which === 'source' ? rel?.targetColumnId : rel?.sourceColumnId;
         if (payload.columnId !== opposite) {
            this.repoint(relink, payload.columnId, payload.side);
         }
      } else {
         const sourceId = this.linkSourceColumnId();
         if (sourceId && sourceId !== payload.columnId) {
            payload.event.stopPropagation();
            void this.store.addRelationship(sourceId, payload.columnId, undefined, {
               sourceSide: this.linkSourceSide(),
               targetSide: payload.side,
               autoRoute: false,
            });
         }
      }
      this.clearLinking();
   }

   private clearLinking(): void {
      this.linkSourceColumnId.set(null);
      this.relinkState.set(null);
      this.linkCursor.set(null);
   }

   /** Released off a handle but near a table: attach to the snapped row. */
   private commitLinkSnap(): void {
      const snap = this.linkSnap();
      if (!snap) {
         return;
      }
      const relink = this.relinkState();
      if (relink) {
         this.repoint(relink, snap.columnId, snap.side);
         return;
      }
      const sourceId = this.linkSourceColumnId();
      if (sourceId && sourceId !== snap.columnId) {
         void this.store.addRelationship(sourceId, snap.columnId, undefined, {
            sourceSide: this.linkSourceSide(),
            targetSide: snap.side,
            autoRoute: false,
         });
      }
   }

   /**
    * Re-point one end of a line to a column + side. Dropping an end is an explicit
    * routing choice, so the line switches to manual with both sides pinned (the
    * other end keeps the side it currently uses) and its old bends are dropped.
    */
   private repoint(relink: RelinkState, columnId: string, side: Side): void {
      const rel = this.store.relationships().find((r) => r.id === relink.relationshipId);
      const connector = this.connectors().find((c) => c.id === relink.relationshipId);
      if (!rel) {
         return;
      }
      const source = relink.which === 'source';
      const sameColumn = (source ? rel.sourceColumnId : rel.targetColumnId) === columnId;
      void this.store.updateRelationship(rel.id, {
         ...(sameColumn ? {} : source ? { sourceColumnId: columnId } : { targetColumnId: columnId }),
         sourceSide: source ? side : (connector?.sourceSide ?? rel.sourceSide),
         targetSide: source ? (connector?.targetSide ?? rel.targetSide) : side,
         autoRoute: false,
         waypoints: [],
      });
   }

   // --- relationship segment dragging (Miro-style manual routing) ---

   protected onSegmentDown(payload: SegmentDownEvent): void {
      if (!this.store.canEdit()) {
         return;
      }
      const connector = this.connectors().find((c) => c.id === payload.relationshipId);
      if (!connector) {
         return;
      }
      // Hand-shaping a line takes it off auto: pin the sides it uses right now.
      if (connector.autoRoute) {
         void this.store.updateRelationship(connector.id, {
            autoRoute: false,
            sourceSide: connector.sourceSide,
            targetSide: connector.targetSide,
         });
      }
      this.activeSegment.set({
         relationshipId: payload.relationshipId,
         segIndex: payload.segmentIndex,
         a: { x: connector.ax, y: connector.ay },
         b: { x: connector.bx, y: connector.by },
         route: connector.routePoints,
      });
   }

   /** Reset route: drop every bend and hand the line back to best-path routing. */
   protected onResetRoute(relationshipId: string): void {
      if (this.store.canEdit()) {
         void this.store.updateRelationship(relationshipId, { autoRoute: true, waypoints: [] });
      }
   }

   /**
    * After a segment drag, store any side the line flipped to (the renderer flips
    * it live once a bend crosses past the far edge of its table), so the side
    * sticks even if the bends are later cleared.
    */
   private persistFlippedSides(): void {
      const active = this.activeSegment();
      if (!active) {
         return;
      }
      const rel = this.store.relationships().find((r) => r.id === active.relationshipId);
      const c = this.connectors().find((x) => x.id === active.relationshipId);
      if (rel && c && (c.sourceSide !== rel.sourceSide || c.targetSide !== rel.targetSide)) {
         void this.store.updateRelationship(rel.id, { sourceSide: c.sourceSide, targetSide: c.targetSide });
      }
   }

   /** Double-clicking a line hands it back to best-path routing. */
   protected onAutoRoute(relationshipId: string): void {
      if (this.store.canEdit()) {
         void this.store.updateRelationship(relationshipId, { autoRoute: true, waypoints: [] });
      }
   }

   private moveActiveSegment(clientX: number, clientY: number): void {
      const active = this.activeSegment();
      if (!active) {
         return;
      }
      // Connector routing never snaps to the grid, even in snap mode: column
      // anchors sit at row centers (off grid), so grid-snapped waypoints would not
      // line up with them and the line would jump around as tables move.
      const cursor = this.viewport.toWorld(clientX, clientY);
      const waypoints = segmentDrag(active.a, active.b, active.route, active.segIndex, cursor);
      this.store.setWaypoints(active.relationshipId, waypoints);
   }

   // --- global pointer + keyboard ---

   /**
    * Items on the canvas are moved by our own pointer handling. A native HTML drag
    * (selected text in a code block, an <img>) would draw the browser's translucent
    * drag image at the item's old spot and swallow the pointer moves, so block it.
    */
   @HostListener('window:dragstart', ['$event'])
   protected onNativeDragStart(event: DragEvent): void {
      const target = event.target as Node | null;
      const el = target instanceof HTMLElement ? target : target?.parentElement;
      if (el?.closest('input, textarea, [contenteditable="true"]')) return;
      if (el && this.canvasRef().nativeElement.contains(el)) {
         event.preventDefault();
      }
   }

   @HostListener('window:pointermove', ['$event'])
   protected onPointerMove(event: PointerEvent): void {
      this.lastPointer = event;
      this.shiftHeld = event.shiftKey;
      this.handlePointerMove(event);
   }

   handlePointerMove(event: PointerEvent): void {
      if (this.mode === 'duplicating') {
         return; // copies are still being created; the drag resumes from lastPointer
      }
      this.broadcastCursor(event);
      if (this.linkSourceColumnId() || this.relinkState()) {
         this.linkCursor.set(this.viewport.toWorld(event.clientX, event.clientY));
         return;
      }
      if (this.activeSegment()) {
         this.moveActiveSegment(event.clientX, event.clientY);
         return;
      }
      if (this.mode === 'draw') {
         this.updateDraw(event.clientX, event.clientY, event.shiftKey, event.altKey);
         return;
      }
      if (this.mode === 'erase') {
         this.eraseAt(event.clientX, event.clientY);
         return;
      }
      if (this.mode === 'element') {
         this.moveElements(event.clientX, event.clientY);
         return;
      }
      if (this.mode === 'element-resize') {
         this.resizeElement(event);
         return;
      }
      if (this.mode === 'group-resize') {
         this.groupResizeMove(event);
         return;
      }
      if (this.mode === 'spacing') {
         this.spacingMove(event);
         return;
      }
      if (this.mode === 'element-rotate') {
         this.rotateElement(event);
         return;
      }
      if (this.mode === 'arrow-endpoint') {
         this.moveEndpoint(event.clientX, event.clientY);
         return;
      }
      if (this.mode === 'arrow-bend') {
         this.moveBend(event.clientX, event.clientY);
         return;
      }
      if (this.mode === 'pan') {
         const dx = event.clientX - this.startClientX;
         const dy = event.clientY - this.startClientY;
         const v = this.store.viewport();
         this.store.setViewport(this.startViewportX + dx, this.startViewportY + dy, v.zoom);
      } else if (this.mode === 'node' && this.dragTableId) {
         if (this.belowDragThreshold(event.clientX, event.clientY)) {
            return;
         }
         this.movingItems.set(true);
         let { dx, dy } = this.dragDelta(event.clientX, event.clientY);
         const smart = this.smartDelta(
            this.dragTableId,
            this.nodeExtras?.elements.keys() ?? [],
            this.multiDragStart.keys(),
            dx,
            dy,
            this.nodeExtras?.sequences.keys() ?? []
         );
         dx += smart?.ox ?? 0;
         dy += smart?.oy ?? 0;
         const grid = this.gridSnap();
         // The tables' actual (snapped) move, so routes carried with them stay attached.
         let moved: { x: number; y: number } | null = null;
         const tables = new Map<string, { x: number; y: number }>();
         for (const [id, start] of this.multiDragStart) {
            const nx = grid && !smart?.snappedX ? snapToGrid(start.x + dx) : Math.round(start.x + dx);
            const ny = grid && !smart?.snappedY ? snapToGrid(start.y + dy) : Math.round(start.y + dy);
            tables.set(id, { x: nx, y: ny });
            if (id === this.dragTableId || !moved) moved = { x: nx - start.x, y: ny - start.y };
         }
         const mx = moved?.x ?? dx;
         const my = moved?.y ?? dy;
         const waypoints = new Map<string, { x: number; y: number }[]>();
         // Keep manual routes attached as their tables move. Both endpoints moving
         // together: translate the whole route rigidly. A single endpoint moving:
         // the waypoint nearest that anchor follows it in y (its horizontal run
         // stays parallel, the vertical run to it shrinks or grows); its x is
         // absorbed by the horizontal run, and every other waypoint stays put.
         for (const [relId, start] of this.waypointDragStart) {
            if (!start.wp.length) {
               continue;
            }
            if (start.both) {
               waypoints.set(
                  relId,
                  start.wp.map((w) => ({ x: Math.round(w.x + mx), y: Math.round(w.y + my) }))
               );
               continue;
            }
            const near = start.sourceMoved ? 0 : start.wp.length - 1;
            waypoints.set(
               relId,
               start.wp.map((w, i) => ({
                  x: Math.round(w.x),
                  y: Math.round(i === near ? w.y + my : w.y),
               }))
            );
         }
         // Tables, their routes and the items riding along: one state write per frame.
         this.store.moveItemsLocal({ tables, waypoints, ...this.nodeExtrasMoves(mx, my) });
      } else if (this.mode === 'marquee') {
         this.marqueeCurrent.set(this.viewport.screenPoint(event.clientX, event.clientY));
      }
   }

   @HostListener('window:pointerup')
   protected onPointerUp(): void {
      if (this.mode === 'duplicating') {
         // The copies are still being created; finish the drop once they exist.
         this.releasedWhileDuplicating = true;
         return;
      }
      this.commitLinkSnap();
      const edgeGesture = this.mode === 'element-resize' || this.mode === 'arrow-endpoint' || this.mode === 'draw';
      const moved =
         this.mode === 'element' || this.mode === 'node'
            ? { elements: [...this.store.selectedElementIds()], tables: [...this.store.selectedTableIds()] }
            : null;
      if (this.mode === 'marquee') {
         this.commitMarquee();
      } else if (this.mode === 'draw') {
         void this.commitDraft(false);
      } else if (this.mode === 'erase') {
         this.commitErase();
      } else if (this.mode === 'element') {
         this.recordMoveGesture();
      } else if (this.mode === 'node') {
         this.settleNodeExtras();
      } else if (this.mode === 'group-resize') {
         this.commitGroupResize();
      } else if (this.mode === 'spacing') {
         this.commitSpacingDrag();
      } else if (
         this.mode === 'element-resize' ||
         this.mode === 'element-rotate' ||
         this.mode === 'arrow-endpoint' ||
         this.mode === 'arrow-bend'
      ) {
         this.commitElementGesture();
      }
      this.mode = 'idle';
      this.panning.set(false);
      this.dragTableId = null;
      this.nodeExtras = null;
      this.elementGesture = null;
      this.gestureActive.set(false);
      this.movingItems.set(false);
      this.bindHighlight.set(null);
      this.multiDragStart.clear();
      this.waypointDragStart.clear();
      this.marqueeStart.set(null);
      this.marqueeCurrent.set(null);
      this.persistFlippedSides();
      this.activeSegment.set(null);
      this.clearLinking();
      this.gestureScale = 1;
      // Sequence diagrams run their own drags and clear this after their final shift.
      if (moved || edgeGesture) this.smartDragEnd();
      if (moved) {
         this.placement.releaseDroppedOutOfSlides(moved);
      }
   }

   private commitMarquee(): void {
      const s = this.marqueeStart();
      const c = this.marqueeCurrent();
      if (!s || !c) {
         return;
      }
      const v = this.store.viewport();
      const toW = (p: { x: number; y: number }) => ({
         x: (p.x - v.x) / v.zoom,
         y: (p.y - v.y) / v.zoom,
      });
      const a = toW(s);
      const b = toW(c);
      const rect: Rect = {
         minX: Math.min(a.x, b.x),
         minY: Math.min(a.y, b.y),
         maxX: Math.max(a.x, b.x),
         maxY: Math.max(a.y, b.y),
      };

      // A slide's items are seen only through its block (scaled when zoomed out, clipped at
      // its edge): test them against the part of the marquee over the block, in the
      // slide's own coordinates. Items hidden past the edge cannot be picked.
      const rectIn = (id: string): Rect | null => {
         const view = this.viewOf(id);
         return view ? this.rectThrough(view, rect) : rect;
      };
      const tableIds = this.visibleTables()
         .filter((t) => {
            const r = rectIn(t.id);
            return !!r && this.boxIntersects(t, r);
         })
         .map((t) => t.id);
      const zoomedRels = this.zoomedConnectorIds();
      const relIds = this.connectors()
         .filter((con) => {
            const view = zoomedRels.get(con.id);
            const r = view ? this.rectThrough(view, rect) : rect;
            return !!r && con.mx >= r.minX && con.mx <= r.maxX && con.my >= r.minY && con.my <= r.maxY;
         })
         .map((con) => con.id);
      const elementIds = this.shownElements()
         .filter((e) => {
            const r = rectIn(e.id);
            return !!r && elementIntersectsRect(e, r);
         })
         .map((e) => e.id);

      // Sequence parts of a slide's diagrams are tested through that slide's block.
      const viewedDiagrams = this.zoomedItems().diagrams;
      const diagramRect = (diagramId: string): Rect | null => {
         const view = viewedDiagrams.get(diagramId);
         return view ? this.rectThrough(view, rect) : rect;
      };
      const sequenceHits = (find: (r: Rect) => string[], diagramOf: (id: string) => string | undefined): string[] => {
         const out = find(rect).filter((id) => !viewedDiagrams.has(diagramOf(id) ?? ''));
         for (const view of new Set(viewedDiagrams.values())) {
            const r = this.rectThrough(view, rect);
            if (r) out.push(...find(r).filter((id) => viewedDiagrams.get(diagramOf(id) ?? '') === view));
         }
         return out;
      };
      const messageIds = sequenceHits(
         (r) => this.messagesInRect(r),
         (id) => this.store.sequenceMessages().find((m) => m.id === id)?.diagramId
      );
      const lifelineIds = this.store
         .lifelines()
         .filter((l) => {
            const d = this.store.sequenceDiagrams().find((x) => x.id === l.diagramId);
            const r = diagramRect(l.diagramId);
            if (!d || !r) return false;
            const left = l.x - l.width / 2;
            return (
               left <= r.maxX && left + l.width >= r.minX && d.originY <= r.maxY && d.originY + d.headerHeight >= r.minY
            );
         })
         .map((l) => l.id);

      const diagramIds = sequenceHits(
         (r) => this.diagramsInRect(r),
         (id) => id
      );
      // A diagram swept up whole is selected as a unit; its parts needn't be listed too.
      const hit = new Set(diagramIds);
      const looseMessages = messageIds.filter(
         (id) => !hit.has(this.store.sequenceMessages().find((m) => m.id === id)?.diagramId ?? '')
      );
      const looseLifelines = lifelineIds.filter(
         (id) => !hit.has(this.store.lifelines().find((l) => l.id === id)?.diagramId ?? '')
      );

      // A marquee that fully encloses a presentation's outline selects that presentation
      // as a whole (like grabbing its border): its shown frame stands in for everything
      // inside the outline, and whatever else the marquee caught stays selected too.
      const sx0 = Math.min(s.x, c.x);
      const sy0 = Math.min(s.y, c.y);
      const sx1 = Math.max(s.x, c.x);
      const sy1 = Math.max(s.y, c.y);
      const enclosed = this.slideSets().filter(
         (set) =>
            set.outline.left >= sx0 &&
            set.outline.top >= sy0 &&
            set.outline.left + set.outline.width <= sx1 &&
            set.outline.top + set.outline.height <= sy1
      );
      let tableSel = tableIds;
      let elementSel = elementIds;
      if (enclosed.length) {
         const boxes = enclosed.map((set) => {
            const o = toW({ x: set.outline.left, y: set.outline.top });
            return {
               x0: o.x,
               y0: o.y,
               x1: o.x + set.outline.width / v.zoom,
               y1: o.y + set.outline.height / v.zoom,
            };
         });
         const inside = (b: { x0: number; y0: number; x1: number; y1: number }) =>
            boxes.some((o) => b.x0 >= o.x0 && b.y0 >= o.y0 && b.x1 <= o.x1 && b.y1 <= o.y1);
         const frameIds = enclosed.map((set) => set.frameId);
         tableSel = this.visibleTables()
            .filter(
               (t) =>
                  tableIds.includes(t.id) &&
                  !inside({ x0: t.x, y0: t.y, x1: t.x + tableWidth(t), y1: t.y + tableHeight(t) })
            )
            .map((t) => t.id);
         elementSel = [
            ...frameIds,
            ...this.shownElements()
               .filter((e) => elementIds.includes(e.id) && !frameIds.includes(e.id) && !inside(elementBox(e)))
               .map((e) => e.id),
         ];
         this.store.selectPresentation(enclosed[0].name);
      }

      if (this.marqueeAdditive) {
         const nextTables = new Set([...this.store.selectedTableIds(), ...tableSel]);
         const nextRels = new Set([...this.store.selectedRelationshipIds(), ...relIds]);
         const nextEls = new Set([...this.store.selectedElementIds(), ...elementSel]);
         const nextMsgs = new Set([...this.store.selectedMessageIds(), ...looseMessages]);
         const nextLls = new Set([...this.store.selectedLifelineIds(), ...looseLifelines]);
         const nextDiagrams = new Set([...this.store.selectedDiagramIds(), ...diagramIds]);
         this.store.setSelection(
            [...nextTables],
            [...nextRels],
            [...nextEls],
            [...nextMsgs],
            [...nextLls],
            [...nextDiagrams]
         );
      } else {
         this.store.setSelection(tableSel, relIds, elementSel, looseMessages, looseLifelines, diagramIds);
      }
      const names = enclosed.map((set) => set.name);
      this.selectedSlideSets.set(this.marqueeAdditive ? [...new Set([...this.selectedSlideSets(), ...names])] : names);
   }

   /** Sequence messages whose snapped row line crosses the marquee rect. */
   private messagesInRect(rect: Rect): string[] {
      const lifelines = this.store.lifelines();
      const out: string[] = [];
      for (const d of this.store.sequenceDiagrams()) {
         const lls = lifelines.filter((l) => l.diagramId === d.id);
         if (!lls.length) continue;
         const byId = new Map(lls.map((l) => [l.id, l.x] as const));
         const minX = Math.min(...lls.map((l) => l.x));
         const maxX = Math.max(...lls.map((l) => l.x));
         const hb = d.originY + d.headerHeight;
         for (const m of this.store.sequenceMessages()) {
            if (m.diagramId !== d.id) continue;
            const isBreak = m.style === 'break';
            const fx = byId.get(m.fromLifelineId);
            const tx = byId.get(m.toLifelineId);
            if (!isBreak && (fx === undefined || tx === undefined)) continue;
            const left = isBreak ? minX : Math.min(fx!, tx!);
            const right = isBreak ? maxX : Math.max(fx!, tx!);
            const y = hb + d.rowSpacing * Math.max(1, Math.round((m.y - hb) / d.rowSpacing));
            if (left <= rect.maxX && right >= rect.minX && y >= rect.minY && y <= rect.maxY) {
               out.push(m.id);
            }
         }
      }
      return out;
   }

   /** A sequence diagram's bounding box as drawn (header, spines and padding). */
   diagramBox(d: SequenceDiagramModel): Rect | null {
      const pad = 26;
      const lls = this.store.lifelines().filter((l) => l.diagramId === d.id);
      if (!lls.length) return null;
      const hb = d.originY + d.headerHeight;
      const maxRow = this.store
         .sequenceMessages()
         .filter((m) => m.diagramId === d.id)
         .reduce((mx, m) => Math.max(mx, Math.round((m.y - hb) / d.rowSpacing)), 0);
      return {
         minX: Math.min(...lls.map((l) => l.x - l.width / 2)) - pad,
         maxX: Math.max(...lls.map((l) => l.x + l.width / 2)) + pad,
         minY: d.originY - pad,
         maxY: hb + d.rowSpacing * (Math.max(1, maxRow) + 1) + pad,
      };
   }

   /** Sequence diagrams whose bounding box (as drawn) lies entirely inside the marquee rect. */
   private diagramsInRect(rect: Rect): string[] {
      const out: string[] = [];
      for (const d of this.store.sequenceDiagrams()) {
         const b = this.diagramBox(d);
         // Only a diagram the marquee fully encloses is picked as a unit; a partial sweep
         // selects just the messages/participants it touches.
         if (b && b.minX >= rect.minX && b.maxX <= rect.maxX && b.minY >= rect.minY && b.maxY <= rect.maxY) {
            out.push(d.id);
         }
      }
      return out;
   }

   private boxIntersects(table: TableModel, rect: Rect): boolean {
      const left = table.x;
      const right = table.x + tableWidth(table);
      const top = table.y;
      const bottom = table.y + tableHeight(table);
      return left <= rect.maxX && right >= rect.minX && top <= rect.maxY && bottom >= rect.minY;
   }

   // --- slides / presentation mode ---

   deletePresentation(name: string): void {
      this.onSlidesCommand({ kind: 'deletePresentation' }, name);
   }

   onSlidesCommand(cmd: SlidesCommand, presentation: string): void {
      // Everything below acts on the selected presentation: the one whose panel was used.
      this.store.selectPresentation(presentation);
      switch (cmd.kind) {
         case 'close':
            this.store.setSelection([], [], []);
            break;
         case 'screen':
            // From the canvas: open the focus screen on its own; leaving it comes back here.
            this.deckFocus.enterDeckFocus(presentation, cmd.screen === 'design' ? 'main' : cmd.screen);
            if (cmd.screen === 'design') this.deckFocus.openFocusDesign();
            // The first slide has no transition into it: show the one into slide 2.
            if (cmd.screen !== 'design' && this.deckFocus.focusSlide()?.index === 1) this.deckFocus.goToTransition(2);
            this.deckFocus.focusFromCanvas.set(true);
            break;
         case 'fold':
            this.deckFocus.settingsFolded.update((v) => !v);
            break;
         case 'present':
            void this.slideshow.startPresentation(cmd.from);
            break;
         case 'preview':
            void this.slideshow.previewTransition(cmd.id);
            break;
         case 'focus':
            this.slideshow.focusFrame(cmd.id);
            break;
         case 'add':
            void this.placement.addSlide(undefined, cmd.layout, cmd.layoutId);
            break;
         case 'deletePresentation': {
            // Its layouts go with it.
            const ids = this.store
               .slideFrames()
               .filter((f) => presentationOf(f) === presentation)
               .map((f) => f.id);
            if (ids.length) {
               this.store.setSelection([], [], ids);
               this.shortcuts.deleteSelection();
            }
            break;
         }
         case 'duplicate':
            void this.placement.duplicateSlides(cmd.ids?.length ? cmd.ids : [cmd.id], cmd.toIndex);
            break;
         case 'delete':
            this.store.setSelection([], [], [cmd.id]);
            this.shortcuts.deleteSelection();
            break;
      }
   }

   /** Canvas items the command palette can search and jump to. */
   private paletteItems(): CanvasItemRef[] {
      const items: CanvasItemRef[] = this.store.tables().map((t) => ({ kind: 'table', id: t.id, label: t.name }));
      for (const e of this.store.elements()) {
         if (e.type === 'code') {
            const first = (e.text ?? '').split(/\r?\n/).find((l) => l.trim()) ?? '';
            items.push({ kind: 'code', id: e.id, label: e.fileName || first.trim().slice(0, 60) || 'Code block' });
         } else if (e.type === 'text' && e.text?.trim()) {
            items.push({ kind: 'text', id: e.id, label: e.text.trim().split(/\r?\n/)[0].slice(0, 60) });
         } else if (e.type === 'frame' && !e.slide && e.text?.trim()) {
            items.push({ kind: 'frame', id: e.id, label: e.text.trim() });
         }
      }
      for (const d of this.store.sequenceDiagrams()) {
         items.push({ kind: 'sequence', id: d.id, label: d.title || 'Sequence diagram' });
      }
      return items;
   }

   /** Select a palette item and centre it in view. */
   private jumpToItem(item: CanvasItemRef): void {
      if (item.kind === 'table') {
         const t = this.store.tables().find((x) => x.id === item.id);
         if (!t) return;
         this.store.setSelection([t.id], [], []);
         this.viewport.panToWorld({ x: t.x + 120, y: t.y + 60 });
      } else if (item.kind === 'sequence') {
         const d = this.store.sequenceDiagrams().find((x) => x.id === item.id);
         if (!d) return;
         const xs = this.store
            .lifelines()
            .filter((l) => l.diagramId === d.id)
            .map((l) => l.x);
         this.store.setSelection([], [], [], [], [], [d.id]);
         if (xs.length) {
            this.viewport.panToWorld({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: d.originY + 160 });
         }
      } else {
         const e = this.store.elements().find((x) => x.id === item.id);
         if (!e) return;
         this.store.setSelection([], [], [e.id]);
         this.viewport.panToWorld({ x: e.x + e.width / 2, y: e.y + e.height / 2 });
      }
   }

   /** Every presentation with its slide count and current presenter (top-right Presentations menu). */
   private readonly deckSummaries$ = computed<DeckSummary[]>(() => {
      const frames = this.store.slideFrames();
      const presenters = this.slideshow.presenters();
      return this.store.presentations().map((name) => {
         const p = presenters.find((x) => {
            const f = frames.find((fr) => fr.id === x.presenting?.frameId);
            return !!f && presentationOf(f) === name;
         });
         return {
            name,
            slides: presentationSlides(frames, name).length,
            presenter: p ? { id: p.id, name: p.name, color: p.color } : null,
         };
      });
   });
   private readonly hasTableSelection$ = computed(() => this.store.selectedTableIds().length > 0);
   /** SQL needs unique table names within the exported scope (selection or whole diagram). */
   private readonly canExportSql$ = computed(() => {
      const selected = this.store.selectedTableIds();
      const tables = this.store.tables();
      const scope = selected.length ? tables.filter((t) => selected.includes(t.id)) : tables;
      const names = scope.map((t) => t.name.trim().toLowerCase());
      return new Set(names).size === names.length;
   });
   /** The export menu offers plain frames apart from the selected presentation's slides. */
   private readonly hasPlainFrames$ = computed(() => this.store.elements().some((e) => e.type === 'frame' && !e.slide));
   private readonly hasSelection$ = computed(
      () =>
         this.store.selectedTableIds().length > 0 ||
         this.store.selectedElementIds().length > 0 ||
         this.store.selectedMessageIds().length > 0 ||
         this.store.selectedLifelineIds().length > 0 ||
         this.store.selectedDiagramIds().length > 0
   );

   /** After placing something: back to Select, unless the toolbar is set to stay on the tool. */
   private afterPlace(): void {
      if (!this.toolbarPrefs.stayOnTool()) this.activeTool.set('select');
   }

   protected onToolChange(tool: EditorTool): void {
      if (tool === 'freedraw') this.penPrefs.eraser.set(false);
      this.activeTool.set(tool);
   }

   // --- copy / paste ---

   /** Ctrl/Cmd+V: a system-clipboard picture becomes an image element, else the in-app clipboard pastes. */
   @HostListener('window:keydown', ['$event'])
   protected onKeyDown(event: KeyboardEvent): void {
      this.shortcuts.onKeyDown(event);
   }

   @HostListener('window:keyup', ['$event'])
   protected onKeyUp(event: KeyboardEvent): void {
      this.shortcuts.onKeyUp(event);
   }

   private readonly mediaActions = inject(MediaActionsService);

   @HostListener('window:paste', ['$event'])
   protected onPaste(event: ClipboardEvent): void {
      this.clipboard.onPaste(event);
   }

   // --- ports: calls the editor's services make into sibling sub-features ---

   readonly presentation = this.slideshow.presentation;
   readonly focusedDeck = this.deckFocus.focusedDeck;
   readonly focusScreen = this.deckFocus.focusScreen;
   readonly followingId = this.follow.followingId;
   readonly focusFrame = (id: string): void => this.slideshow.focusFrame(id);
   readonly selectedPresentationName = (): string | null => this.slideshow.selectedPresentationName();
   readonly startPresentation = (from: 'start' | 'current'): Promise<void> => this.slideshow.startPresentation(from);
   readonly enterDeckFocus = (name: string): void => this.deckFocus.enterDeckFocus(name);
   readonly exitDeckFocus = (): void => this.deckFocus.exitDeckFocus();
   readonly closeFocusDesign = (name: string): void => this.deckFocus.closeFocusDesign(name);
   readonly leaveFocusScreen = (): void => this.deckFocus.leaveFocusScreen();
   readonly stepTransition = (delta: number): void => this.deckFocus.stepTransition(delta);
   readonly importProjectFile = (file: unknown, at?: { x: number; y: number }): Promise<number> =>
      this.placement.importProjectFile(file, at);
   readonly duplicateSlides = (ids: readonly string[]): Promise<void> => this.placement.duplicateSlides(ids);
   readonly freeFrameOffset = (frame: CanvasElementModel, step?: number): number =>
      this.placement.freeFrameOffset(frame, step);
   readonly cloneItems: SlidePlacementService['cloneItems'] = (...args) => this.placement.cloneItems(...args);
   readonly orderSlideCopies = (copies: readonly CanvasElementModel[], deck: string, afterId: string | null) =>
      this.placement.orderSlideCopies(copies, deck, afterId);
   readonly copySelection = (): void => this.clipboard.copySelection();

   // --- embed API (home showcase) ---

   showTransitionScreen(...args: Parameters<DeckFocusService['showTransitionScreen']>): void {
      this.deckFocus.showTransitionScreen(...args);
   }

   leaveDeckFocus(): void {
      this.deckFocus.leaveDeckFocus();
   }
   readonly insertImages = (files: File[]): Promise<void> => this.mediaDrop.insertImages(files);

   // --- toolbar: add / zoom / grid / align ---

   /** When our own double-click detector last fired (the native event that follows is ignored). */
   private lastOwnDblClick = -Infinity;
   private replayingDblClick = false;
   /** Canvas layers that handle double-clicks themselves via (dblclick) bindings. */
   private static readonly SELF_DBLCLICK =
      'dd-table-node, dd-canvas-sequence, dd-sequence-diagram, dd-canvas-connectors';

   protected onCanvasDblClick(event: MouseEvent): void {
      if (performance.now() - this.lastOwnDblClick < 600) {
         return;
      }
      this.handleDoubleClick(event.target as Element | null, event.currentTarget, event.clientX, event.clientY);
   }

   private handleDoubleClick(
      target: Element | null,
      canvas: EventTarget | null,
      clientX: number,
      clientY: number
   ): void {
      // Toolbars, panels, the minimap and the inline editor are children of the
      // canvas element, so their double-clicks bubble up here. Only a double-click
      // on the drawing surface itself (the canvas or the world layer) is ours.
      const onSurface =
         !!target &&
         (target === canvas || !!target.closest('.world')) &&
         !target.closest('.text-editor, [contenteditable="true"], textarea, input');
      if (!onSurface || this.textEditing.editingTextId()) {
         return;
      }
      // Layers with their own (dblclick) handlers — ERD tables (rename table / edit
      // column), sequence diagrams (title, participants, messages), connectors (reset
      // route). The native dblclick can be swallowed when the first click re-renders
      // the item, so replay it on the node under the pointer; it bubbles to whichever
      // handler owns that spot. The native one that may follow is suppressed (see
      // the capture listener in the constructor) so it doesn't run twice.
      if (target.closest(EditorComponent.SELF_DBLCLICK)) {
         this.replayingDblClick = true;
         try {
            target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX, clientY }));
         } finally {
            this.replayingDblClick = false;
         }
         return;
      }
      const world = this.viewport.toWorld(clientX, clientY);
      const hits = this.shownElements()
         .reverse()
         .filter((e) => hitTestElement(e, world));
      // What is under the pointer, in order of intent: the item just clicked (selected),
      // then text (slide text often sits over a card or picture), then the topmost item.
      const selected = new Set(this.store.selectedElementIds());
      const isTexty = (e: CanvasElementModel): boolean => e.type === 'text' || e.type === 'code' || e.type === 'grid';
      const hit = hits.find((e) => selected.has(e.id) && e.type !== 'frame') ?? hits.find(isTexty) ?? hits[0];
      // Double-clicking a member of a group steps into it (selecting just that
      // member); once inside, the usual double-click behaviour applies.
      const locked = (id: string): boolean => {
         const gid = this.store.groupIdOf(id);
         return !!gid && gid !== this.store.enteredGroupId();
      };
      const diagram = this.store.sequenceDiagrams().find((d) => {
         const b = this.diagramBox(d);
         return !!b && world.x >= b.minX && world.x <= b.maxX && world.y >= b.minY && world.y <= b.maxY;
      });
      if (diagram && locked(diagram.id)) {
         this.store.enterGroup('diagram', diagram.id);
         return;
      }
      if (hit && locked(hit.id)) {
         this.store.enterGroup('element', hit.id);
         return;
      }
      if (!this.store.canEdit() || !this.store.projectId()) {
         return;
      }
      // Double-clicking a picture crops it inline.
      if (hit?.type === 'image') {
         this.store.selectElement(hit.id);
         this.mediaActions.startCrop(hit.id);
         return;
      }
      // Double-clicking a master item drawn under a shown slide or layout gives that frame
      // its own copy to edit (reset to master deletes it again).
      if (!hit) {
         const inherited = this.inheritedMasterItemAt(world);
         if (inherited) {
            void this.editInherited(inherited.item, inherited.frame);
            return;
         }
      }
      // Double-clicking a grid table edits the cell under the pointer.
      if (hit?.type === 'grid') {
         const cell = gridCellAt(hit, world);
         if (cell) {
            this.store.selectElement(hit.id);
            this.grids.beginEdit({ id: hit.id, ...cell });
         }
         return;
      }
      // Double-clicking a code block's file-name bar edits the name, not the code.
      if (hit?.type === 'code') {
         const header = codeHeaderHeight(hit.fontSize ?? CODE_FONT_SIZE);
         if (world.y < hit.y + header) {
            // Double-clicks on the window dots are not an edit gesture.
            if (world.x >= hit.x + CODE_DOTS_WIDTH) {
               this.codeActions.editFileName(hit.id);
            }
            return;
         }
      }
      // Double-clicking a text element edits it; double-clicking a shape edits its
      // centered label; double-clicking empty canvas creates a text block.
      if (hit) {
         if (
            hit.type === 'text' ||
            hit.type === 'code' ||
            hit.type === 'frame' ||
            hit.type === 'rectangle' ||
            hit.type === 'ellipse' ||
            hit.type === 'diamond' ||
            hit.type === 'arrow' ||
            hit.type === 'line'
         ) {
            this.store.selectElement(hit.id);
            // Older text boxes may have been resized narrower so they wrapped; text
            // no longer wraps, so refit the box to its content before editing.
            if (hit.type === 'text') {
               const lineH = (hit.fontSize ?? DEFAULT_FONT_SIZE) * (hit.lineHeight ?? 1.25);
               const explicit = (hit.text ?? '').split('\n').length;
               const looksWrapped = hit.height > explicit * lineH + 4 + lineH * 0.5;
               if (hit.wrap === undefined && looksWrapped) {
                  // Legacy narrow text becomes an explicit fixed-width block.
                  this.store.patchElementLocal(hit.id, { wrap: true });
                  void this.store.updateElement(hit.id, { wrap: true });
               } else if (!hit.wrap) {
                  this.store.patchElementLocal(hit.id, this.textEditing.fitTextSize(hit, hit.text ?? ''));
               }
            }
            if (hit.type === 'text') {
               this.textEditing.editClickPoint = { x: clientX, y: clientY };
            }
            if (hit.type === 'code') {
               // Both diff sides open for editing; the caret starts in the pane clicked.
               this.codeActions.diffEditSide.set(
                  codeDiffActive(hit) && world.x >= hit.x + hit.width * codeDiffSplit(hit) ? 'modified' : 'original'
               );
            }
            this.textEditing.editingTextId.set(hit.id);
         }
         return;
      }
      this.createTextAt(world);
   }

   /**
    * The topmost master or layout item drawn locked under a shown slide or layout at a
    * world point, with the shown frame it is under.
    */
   private inheritedMasterItemAt(world: {
      x: number;
      y: number;
   }): { item: CanvasElementModel; frame: CanvasElementModel } | null {
      const locked = this.store.layoutItemIds();
      const masters = this.store.masterItemIds();
      const hide = this.focusHidden();
      const frames = this.store.slideFrames();
      const shown = frames.filter((f) => this.store.shownSlideIds().has(f.id));
      const items = this.store
         .elements()
         .filter((e) => locked.has(e.id) && !hide?.elementIds.has(e.id))
         .sort((a, b) => (masters.has(a.id) ? 0 : 1) - (masters.has(b.id) ? 0 : 1) || a.zIndex - b.zIndex)
         .reverse();
      for (const item of items) {
         if (!hitTestElement(item, world)) continue;
         const frame = shown.find(
            (f) => masterOf(f, frames)?.id === item.slideId || layoutOf(f, frames)?.id === item.slideId
         );
         const raw = this.store.elements().find((e) => e.id === item.id);
         if (frame && raw) return { item: raw, frame };
      }
      return null;
   }

   /** Copies made by grabbing a master item, as made: dropped again if left unchanged. */
   private readonly pristineStandIns = new Map<string, string>();

   private async grabInherited(
      item: CanvasElementModel,
      frame: CanvasElementModel,
      event: PointerEvent
   ): Promise<void> {
      let held = true;
      const up = (): void => {
         held = false;
         window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointerup', up);
      const copy = await standInFor(this.store, item, frame, true);
      if (!copy) return;
      this.pristineStandIns.set(copy.id, this.standInLook(copy));
      this.store.selectElement(copy.id, false);
      if (!held) return;
      window.removeEventListener('pointerup', up);
      this.startClientX = event.clientX;
      this.startClientY = event.clientY;
      this.gestureScale = this.itemScale(copy.id);
      this.dragCopied = false;
      this.beginElementDrag(copy);
   }

   private standInLook(e: CanvasElementModel): string {
      const { zIndex: _z, ...rest } = e;
      return JSON.stringify(rest);
   }

   /** A grabbed master item's copy that was never changed goes once it is deselected. */
   private readonly prunePristine = effect(() => {
      const selected = new Set(this.store.selectedElementIds());
      const editing = this.textEditing.editingTextId();
      untracked(() => {
         for (const [id, look] of [...this.pristineStandIns]) {
            if (selected.has(id) || editing === id) continue;
            this.pristineStandIns.delete(id);
            const el = this.store.elements().find((e) => e.id === id);
            if (el && this.standInLook(el) === look) void this.store.deleteElementSilently(id);
         }
      });
   });

   private async editInherited(item: CanvasElementModel, frame: CanvasElementModel): Promise<void> {
      const copy = await standInFor(this.store, item, frame);
      if (!copy) return;
      this.store.selectElement(copy.id);
      if (['text', 'rectangle', 'ellipse', 'diamond', 'code'].includes(copy.type))
         this.textEditing.editingTextId.set(copy.id);
   }

   /** Create an empty text block at a world point and open its inline editor. */
   private createTextAt(world: { x: number; y: number }): void {
      const style = this.store.elementStyle();
      const draft: CanvasElementModel = {
         id: `draft-${Date.now()}`,
         type: 'text',
         x: Math.round(world.x),
         y: Math.round(world.y),
         width: 4,
         height: style.fontSize,
         angle: 0,
         strokeColor: style.strokeColor ?? this.defaultStroke(),
         fillStyle: style.fillStyle,
         strokeWidth: style.strokeWidth,
         strokeStyle: style.strokeStyle,
         opacity: style.opacity,
         zIndex: this.store.elements().length,
         text: '',
         fontSize: style.fontSize,
         fontFamily: style.fontFamily,
         textAlign: 'left',
      };
      this.draft.set(draft);
      void this.commitDraft(true);
   }

   protected addTableCentered(): void {
      const rect = this.viewport.canvasRect();
      const v = this.store.viewport();
      let x = Math.round((rect.width / 2 - v.x) / v.zoom - NODE_WIDTH / 2);
      let y = Math.round((rect.height / 2 - v.y) / v.zoom - 40);
      if (this.gridSnap()) {
         x = snapToGrid(x);
         y = snapToGrid(y);
      }
      void this.store.addTable(x, y);
   }

   /** Simplified world-space footprint of every element, for the minimap. */
   readonly minimapItems = computed<MinimapItem[]>(() => {
      const items: MinimapItem[] = [];
      // Items of a shown slide are placed as drawn (through its zoom); the ones the block
      // does not show (staged outside its view) are left out, as on the canvas.
      const add = (id: string, item: MinimapItem): void => {
         const view = this.viewOf(id);
         if (!view) {
            items.push(item);
            return;
         }
         const b = boxToOuter(view, item);
         const k = view.block;
         if (b.x1 < k.x0 || b.x0 > k.x1 || b.y1 < k.y0 || b.y0 > k.y1) return;
         items.push({ ...item, ...b, points: item.points?.map((p) => toOuter(view, p)) });
      };
      for (const t of this.store.tables()) {
         add(t.id, {
            kind: 'table',
            x0: t.x,
            y0: t.y,
            x1: t.x + tableWidth(t),
            y1: t.y + tableHeight(t),
         });
      }
      for (const d of this.store.sequenceDiagrams()) {
         const b = this.diagramBox(d);
         if (b) {
            add(d.id, { kind: 'sequence', x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY });
         }
      }
      for (const el of this.store.elements()) {
         const b = elementBox(el);
         const kind: MinimapItem['kind'] =
            el.type === 'text'
               ? 'text'
               : el.type === 'line' || el.type === 'arrow' || el.type === 'freedraw'
                 ? 'line'
                 : el.type === 'frame'
                   ? 'frame'
                   : el.type === 'code'
                     ? 'text'
                     : 'shape';
         add(el.id, {
            kind,
            ...b,
            points: kind === 'line' ? absolutePoints(el) : undefined,
         });
      }
      return items;
   });

   /** The visible canvas area in world coordinates (re-evaluated as the viewport changes). */
   protected readonly minimapView = computed(() => {
      const v = this.store.viewport();
      const rect = this.viewport.canvasSize();
      return {
         x0: -v.x / v.zoom,
         y0: -v.y / v.zoom,
         x1: (rect.width - v.x) / v.zoom,
         y1: (rect.height - v.y) / v.zoom,
      };
   });

   protected toggleGrid(): void {
      this.gridSnap.update((v) => !v);
   }

   /** Element types a "fill / stroke for all" applies to. */
   private static readonly FILLABLE = new Set(['rectangle', 'ellipse', 'diamond']);
   private static readonly STROKABLE = new Set(['rectangle', 'ellipse', 'diamond', 'arrow', 'line', 'freedraw']);

   /** Some selected elements take a fill or stroke. */
   protected readonly selectionStylable = computed(() => {
      const ids = new Set(this.store.selectedElementIds());
      return this.store.elements().some((e) => ids.has(e.id) && EditorComponent.STROKABLE.has(e.type));
   });

   /** Fill / stroke every selected shape (one undo step). */
   protected styleSelection(kind: 'fill' | 'stroke', color: string): void {
      if (!this.store.canEdit()) return;
      const ids = new Set(this.store.selectedElementIds());
      const allowed = kind === 'fill' ? EditorComponent.FILLABLE : EditorComponent.STROKABLE;
      const targets = this.store.elements().filter((e) => ids.has(e.id) && allowed.has(e.type));
      if (!targets.length) return;
      void this.store.batchHistory(async () => {
         for (const e of targets) {
            if (kind === 'fill') {
               await this.store.updateElement(
                  e.id,
                  color === 'transparent' ? { fillStyle: 'none' } : { backgroundColor: color, fillStyle: 'solid' }
               );
            } else {
               await this.store.updateElement(e.id, { strokeColor: color });
            }
         }
      });
   }

   /** Smart-guide hooks handed to sequence diagrams, which run their own drags. */
   protected readonly smartDrag = (
      diagramId: string,
      items: { diagrams: Iterable<string>; elements: Iterable<string>; tables: Iterable<string> },
      dx: number,
      dy: number
   ): SmartSnap | null => this.smartDelta(diagramId, items.elements, items.tables, dx, dy, items.diagrams);

   protected readonly smartDragEnd = (): void => {
      this.smartBase = null;
      this.smartSnapState.set(null);
   };

   protected toggleSmartGuides(): void {
      this.smartGuides.update((v) => !v);
   }

   /**
    * Smart-guide correction for a drag by (dx, dy) of the given items, grabbed by
    * `grabbedId`. Targets are the visible items nearest the selection in the same
    * space (the canvas, or the grabbed item's slide, whose frame counts too).
    */
   private smartDelta(
      grabbedId: string,
      elementIds: Iterable<string>,
      tableIds: Iterable<string>,
      dx: number,
      dy: number,
      diagramIds: Iterable<string> = []
   ): SmartSnap | null {
      if (!this.smartGuides()) {
         this.smartSnapState.set(null);
         return null;
      }
      const base = this.ensureSmartBase(grabbedId, elementIds, tableIds, diagramIds);
      if (!base) return null;
      const moved = { x0: base.box.x0 + dx, y0: base.box.y0 + dy, x1: base.box.x1 + dx, y1: base.box.y1 + dy };
      const parts = base.parts.map((b) => ({ x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy }));
      const snap = smartSnap(moved, base.targets, this.store.viewport().zoom * this.itemScale(grabbedId), parts);
      // Shift constrains the drag to one axis; don't let a snap pull it off.
      if (this.shiftHeld && dx === 0) Object.assign(snap, { ox: 0, snappedX: false });
      if (this.shiftHeld && dy === 0) Object.assign(snap, { oy: 0, snappedY: false });
      this.smartSnapState.set(snap.guides.length || snap.gaps.length ? { snap, view: base.view } : null);
      return snap;
   }

   /**
    * Smart-guide correction for a resize / endpoint drag of one element: only the
    * moving edge positions `xs` / `ys` (world coords) snap. `box` spans the guides.
    */
   private smartEdges(
      id: string,
      box: Box,
      xs: number[],
      ys: number[],
      draft?: { ctx: string | null; view?: SlideView }
   ): SmartSnap | null {
      if (!this.smartGuides()) {
         this.smartSnapState.set(null);
         return null;
      }
      const base = this.ensureSmartBase(id, [id], [], [], draft ? { ...draft, box } : undefined);
      if (!base) return null;
      const scale = draft ? (draft.view?.scale ?? 1) : this.itemScale(id);
      const snap = smartSnapEdges(box, xs, ys, base.targets, this.store.viewport().zoom * scale);
      this.smartSnapState.set(snap.guides.length ? { snap, view: base.view } : null);
      return snap;
   }

   /** Snap targets for a gesture on the given items, built once per gesture. */
   private ensureSmartBase(
      grabbedId: string,
      elementIds: Iterable<string>,
      tableIds: Iterable<string>,
      diagramIds: Iterable<string> = [],
      draft?: { box: Box; ctx: string | null; view?: SlideView }
   ): { box: Box; parts: Box[]; targets: Box[]; view?: SlideView } | null {
      if (!this.smartBase) {
         const moving = new Set([...elementIds, ...tableIds, ...diagramIds]);
         const els = this.store.elements();
         const tables = this.store.tables();
         const diagrams = this.store.sequenceDiagrams();
         const lifelines = this.store.lifelines();
         const messages = this.store.sequenceMessages();
         const grabbed =
            els.find((e) => e.id === grabbedId) ??
            tables.find((t) => t.id === grabbedId) ??
            diagrams.find((d) => d.id === grabbedId);
         // A shape being drawn isn't in the store yet: it brings its own box and space.
         const ctx = draft ? draft.ctx : (grabbed?.slideId ?? null);
         const boxes: Box[] = draft ? [draft.box] : [];
         for (const e of els) if (moving.has(e.id)) boxes.push(elementBox(e));
         for (const t of tables) if (moving.has(t.id)) boxes.push(tableBox(t));
         const diagramBoxes = new Map<string, Box>();
         for (const d of diagrams) {
            const b = sequenceDiagramBox(d, lifelines, messages);
            if (b) diagramBoxes.set(d.id, b);
            if (b && moving.has(d.id)) boxes.push(b);
         }
         if (!boxes.length) return null;
         const box = {
            x0: Math.min(...boxes.map((b) => b.x0)),
            y0: Math.min(...boxes.map((b) => b.y0)),
            x1: Math.max(...boxes.map((b) => b.x1)),
            y1: Math.max(...boxes.map((b) => b.y1)),
         };
         const all: Box[] = [];
         for (const e of els) {
            // Lines/arrows count (their box edges are their ends); freehand strokes don't.
            if (moving.has(e.id) || (isPathElement(e.type) && e.type !== 'line' && e.type !== 'arrow')) continue;
            if ((e.slideId ?? null) === ctx || e.id === ctx) all.push(elementBox(e));
         }
         for (const t of tables) {
            if (!moving.has(t.id) && (t.slideId ?? null) === ctx) all.push(tableBox(t));
         }
         for (const d of diagrams) {
            const b = diagramBoxes.get(d.id);
            if (b && !moving.has(d.id) && (d.slideId ?? null) === ctx) all.push(b);
         }
         // A presentation's dashed outline (around its panels and frame) is a snap target too.
         for (const p of this.presentationOutlineBoxes()) {
            if (ctx === null || p.frameId === ctx) all.push(p.box);
         }
         const view = draft
            ? draft.view && draft.view.scale !== 1
               ? draft.view
               : undefined
            : this.itemScale(grabbedId) !== 1
              ? this.viewOf(grabbedId)
              : undefined;
         this.smartBase = { box, parts: boxes, targets: snapTargets(box, all, ctx ? null : this.minimapView()), view };
      }
      return this.smartBase;
   }

   // --- relationship inline toolbar ---

   protected onSetRelType(type: RelationshipType): void {
      const rel = this.store.selectedRelationship();
      if (rel && this.store.canEdit()) {
         void this.store.updateRelationship(rel.id, { type });
      }
   }

   /**
    * Toggle best-path routing for every selected line (the toolbar's state is the
    * primary selection's). Turning it on drops manual bends; turning it off pins
    * the sides each line uses now so nothing jumps.
    */
   protected onToggleAutoRoute(): void {
      const primary = this.store.selectedRelationship();
      if (!primary || !this.store.canEdit()) {
         return;
      }
      const enable = primary.autoRoute === false;
      const ids = new Set(this.store.selectedRelationshipIds());
      for (const c of this.connectors()) {
         if (!ids.has(c.id)) {
            continue;
         }
         void this.store.updateRelationship(
            c.id,
            enable
               ? { autoRoute: true, waypoints: [] }
               : { autoRoute: false, sourceSide: c.sourceSide, targetSide: c.targetSide }
         );
      }
   }

   protected onDeleteRel(): void {
      const rel = this.store.selectedRelationship();
      if (rel && this.store.canEdit()) {
         void this.store.deleteRelationship(rel.id);
      }
   }

   // --- alignment ---

   protected onAlign(action: AlignAction): void {
      if (!this.store.canEdit()) {
         return;
      }
      // While cropping, the panel lines the clip shape up within its picture.
      if (this.croppingElement()) {
         this.mediaActions.requestCropAlign(action);
         return;
      }
      // Tables, canvas elements (text, shapes, lines...) and sequence diagrams align
      // together by their bounding boxes. A whole group is ONE item: its box is the
      // union of its members, and placing it shifts every member by the same amount.
      interface Member {
         gid: string | null;
         x: number;
         y: number;
         w: number;
         h: number;
         shift: (dx: number, dy: number) => void;
      }
      interface Item {
         x: number;
         y: number;
         w: number;
         h: number;
         place: (x: number, y: number) => void;
      }
      const byItem = this.store.groupByItem();
      const entered = this.store.enteredGroupId();
      const gidOf = (id: string): string | null => {
         const g = byItem.get(id);
         return g && g !== entered ? g : null;
      };
      const members: Member[] = [];
      const tableIds = this.store.selectedTableIds();
      const tableStart = new Map(this.store.tables().map((t) => [t.id, { x: t.x, y: t.y }]));
      for (const t of this.store.tables()) {
         if (tableIds.includes(t.id)) {
            members.push({
               gid: gidOf(t.id),
               x: t.x,
               y: t.y,
               w: tableWidth(t),
               h: tableHeight(t),
               shift: (dx, dy) => this.store.moveTable(t.id, Math.round(t.x + dx), Math.round(t.y + dy)),
            });
         }
      }
      const elementIds = this.store.selectedElementIds();
      const moves: { id: string; from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
      for (const e of this.store.elements()) {
         if (elementIds.includes(e.id)) {
            const b = elementBox(e);
            members.push({
               gid: gidOf(e.id),
               x: b.x0,
               y: b.y0,
               w: b.x1 - b.x0,
               h: b.y1 - b.y0,
               shift: (dx, dy) => {
                  const nx = Math.round(e.x + dx);
                  const ny = Math.round(e.y + dy);
                  if (nx !== e.x || ny !== e.y) {
                     moves.push({ id: e.id, from: { x: e.x, y: e.y }, to: { x: nx, y: ny } });
                     this.store.moveElement(e.id, nx, ny);
                  }
               },
            });
         }
      }
      // Moving a sequence diagram shifts every participant and message with it (rows
      // kept), then persists + records undo.
      const seqMoves: { id: string; before: SequenceLayoutSnapshot }[] = [];
      for (const d of this.store.sequenceDiagrams()) {
         if (!this.store.selectedDiagramIds().includes(d.id)) continue;
         const b = this.diagramBox(d);
         const snap = this.store.sequenceDiagramSnapshot(d.id);
         if (!b || !snap) continue;
         members.push({
            gid: gidOf(d.id),
            x: b.minX,
            y: b.minY,
            w: b.maxX - b.minX,
            h: b.maxY - b.minY,
            shift: (dx, dy) => {
               const rx = Math.round(dx);
               const ry = Math.round(dy);
               if (!rx && !ry) return;
               seqMoves.push({ id: d.id, before: this.layoutSnapshot(d.id) });
               this.store.shiftSequence(d.id, snap.startXs, rx, snap.startOriginY, ry, snap.startRows);
            },
         });
      }
      const items: Item[] = [];
      const grouped = new Map<string, Member[]>();
      for (const m of members) {
         if (m.gid) {
            grouped.set(m.gid, [...(grouped.get(m.gid) ?? []), m]);
         } else {
            items.push({
               x: m.x,
               y: m.y,
               w: m.w,
               h: m.h,
               place: (x, y) => m.shift(x - m.x, y - m.y),
            });
         }
      }
      for (const parts of grouped.values()) {
         const gx = Math.min(...parts.map((m) => m.x));
         const gy = Math.min(...parts.map((m) => m.y));
         items.push({
            x: gx,
            y: gy,
            w: Math.max(...parts.map((m) => m.x + m.w)) - gx,
            h: Math.max(...parts.map((m) => m.y + m.h)) - gy,
            place: (x, y) => parts.forEach((m) => m.shift(x - gx, y - gy)),
         });
      }
      // A lone unit aligns to the frame / shape it sits inside.
      const container = items.length === 1 ? this.alignContainer() : null;
      if (items.length < 2 && !container) {
         return;
      }
      const minX = container ? container.x0 : Math.min(...items.map((i) => i.x));
      const maxRight = container ? container.x1 : Math.max(...items.map((i) => i.x + i.w));
      const minY = container ? container.y0 : Math.min(...items.map((i) => i.y));
      const maxBottom = container ? container.y1 : Math.max(...items.map((i) => i.y + i.h));

      switch (action) {
         case 'left':
            items.forEach((i) => i.place(minX, i.y));
            break;
         case 'right':
            items.forEach((i) => i.place(maxRight - i.w, i.y));
            break;
         case 'hcenter': {
            const center = (minX + maxRight) / 2;
            items.forEach((i) => i.place(center - i.w / 2, i.y));
            break;
         }
         case 'top':
            items.forEach((i) => i.place(i.x, minY));
            break;
         case 'bottom':
            items.forEach((i) => i.place(i.x, maxBottom - i.h));
            break;
         case 'vcenter': {
            const center = (minY + maxBottom) / 2;
            items.forEach((i) => i.place(i.x, center - i.h / 2));
            break;
         }
         case 'dist-h': {
            if (items.length < 2) break;
            const sorted = [...items].sort((p, q) => p.x - q.x);
            const first = sorted[0].x;
            const last = sorted[sorted.length - 1].x;
            const step = (last - first) / (sorted.length - 1);
            sorted.forEach((i, n) => i.place(first + step * n, i.y));
            break;
         }
         case 'dist-v': {
            if (items.length < 2) break;
            const sorted = [...items].sort((p, q) => p.y - q.y);
            const first = sorted[0].y;
            const last = sorted[sorted.length - 1].y;
            const step = (last - first) / (sorted.length - 1);
            sorted.forEach((i, n) => i.place(i.x, first + step * n));
            break;
         }
         case 'gaps-h':
         case 'gaps-v': {
            // Tidy: same 40px gap between neighbours, starting from the first one.
            if (items.length < 2) break;
            const gap = 40;
            const horizontal = action === 'gaps-h';
            const sorted = [...items].sort((p, q) => (horizontal ? p.x - q.x : p.y - q.y));
            let at = horizontal ? sorted[0].x : sorted[0].y;
            for (const i of sorted) {
               if (horizontal) i.place(at, i.y);
               else i.place(i.x, at);
               at += (horizontal ? i.w : i.h) + gap;
            }
            break;
         }
      }
      this.followRoutes(tableStart);
      this.store.recordElementMove(moves);
      for (const { id, before } of seqMoves) {
         const after = this.layoutSnapshot(id);
         for (const [lid, x] of after.lifelineXs) this.store.moveLifeline(lid, x);
         for (const [mid, y] of after.messageYs) this.store.moveMessage(mid, y);
         void this.store.updateSequenceConfig(id, {
            rowSpacing: after.rowSpacing,
            originY: after.originY,
         });
         this.store.recordSequenceLayout(id, before, after);
      }
   }

   /**
    * Keep manual relationship routes in place relative to their tables after the
    * tables moved from `start`. Both ends moved alike: the route translates rigidly.
    * Otherwise each waypoint takes a blend of the two ends' moves (nearer end
    * weighs more), and waypoint pairs that shared an x or y keep sharing it so the
    * route stays orthogonal.
    */
   private followRoutes(start: Map<string, { x: number; y: number }>): void {
      const now = new Map(this.store.tables().map((t) => [t.id, t] as const));
      const delta = (id: string | undefined): { x: number; y: number } => {
         const a = id ? start.get(id) : undefined;
         const b = id ? now.get(id) : undefined;
         return a && b ? { x: b.x - a.x, y: b.y - a.y } : { x: 0, y: 0 };
      };
      const locs = this.columnLocations();
      for (const rel of this.store.relationships()) {
         const wp = rel.waypoints;
         if (!wp?.length) continue;
         const ds = delta(locs.get(rel.sourceColumnId)?.table.id);
         const dt = delta(locs.get(rel.targetColumnId)?.table.id);
         if (!ds.x && !ds.y && !dt.x && !dt.y) continue;
         const n = wp.length;
         const next = wp.map((w, i) => {
            const f = (i + 1) / (n + 1);
            return { x: w.x + ds.x + (dt.x - ds.x) * f, y: w.y + ds.y + (dt.y - ds.y) * f };
         });
         for (let i = 0; i + 1 < n; i++) {
            if (Math.abs(wp[i].x - wp[i + 1].x) < 0.5) {
               next[i].x = next[i + 1].x = (next[i].x + next[i + 1].x) / 2;
            }
            if (Math.abs(wp[i].y - wp[i + 1].y) < 0.5) {
               next[i].y = next[i + 1].y = (next[i].y + next[i + 1].y) / 2;
            }
         }
         this.store.setWaypoints(
            rel.id,
            next.map((w) => ({ x: Math.round(w.x), y: Math.round(w.y) }))
         );
      }
   }

   private layoutSnapshot(diagramId: string): SequenceLayoutSnapshot {
      const cfg = this.store.sequenceDiagrams().find((x) => x.id === diagramId);
      return {
         lifelineXs: new Map(
            this.store
               .lifelines()
               .filter((l) => l.diagramId === diagramId)
               .map((l) => [l.id, l.x])
         ),
         messageYs: new Map(
            this.store
               .sequenceMessages()
               .filter((m) => m.diagramId === diagramId)
               .map((m) => [m.id, m.y])
         ),
         originY: cfg?.originY ?? 0,
         rowSpacing: cfg?.rowSpacing ?? 48,
      };
   }
}

/** Resample a polyline so consecutive points are at most `step` apart. */
function densify(
   pts: readonly { x: number; y: number }[],
   step: number,
   near: (a: { x: number; y: number }, b: { x: number; y: number }) => boolean
): { x: number; y: number }[] {
   const out: { x: number; y: number }[] = [];
   for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      out.push(a);
      const b = pts[i + 1];
      if (!b) break;
      if (!Number.isFinite(a.x) || !Number.isFinite(b.x) || !near(a, b)) continue;
      const n = Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / step);
      for (let k = 1; k < n; k += 1) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
   }
   return out;
}

function distanceToSegment(
   p: { x: number; y: number },
   a: { x: number; y: number },
   b: { x: number; y: number }
): number {
   const dx = b.x - a.x;
   const dy = b.y - a.y;
   const len = dx * dx + dy * dy;
   const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
   return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Shortest distance between segments ab and cd. */
function segDistance(
   a: { x: number; y: number },
   b: { x: number; y: number },
   c: { x: number; y: number },
   d: { x: number; y: number }
): number {
   const cross = (o: { x: number; y: number }, p: { x: number; y: number }, q: { x: number; y: number }) =>
      (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
   const d1 = cross(c, d, a);
   const d2 = cross(c, d, b);
   const d3 = cross(a, b, c);
   const d4 = cross(a, b, d);
   if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
   return Math.min(
      distanceToSegment(a, c, d),
      distanceToSegment(b, c, d),
      distanceToSegment(c, a, b),
      distanceToSegment(d, a, b)
   );
}
