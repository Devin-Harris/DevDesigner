import { DeckPanelsService } from './features/slides/services/deck-panels.service';
import { DrawToolService } from './features/elements/services/draw-tool.service';
import { ElementGestureService } from './features/elements/services/element-gesture.service';
import { LaserInputService } from './features/collaboration/services/laser-input.service';
import { GroupTransformService } from './features/elements/services/group-transform.service';
import { CanvasSnapService } from './services/canvas-snap.service';
import type { SequenceDiagramModel } from '@devdesigner/shared';
import { CanvasViewService } from './services/canvas-view.service';
import { EditorToolService } from './services/editor-tool.service';
import { TableDragService } from './features/erd/services/table-drag.service';
import { RelationshipLinkService } from './features/erd/services/relationship-link.service';
import { PointerGestureService } from './services/pointer-gesture.service';
import { TextEditingService } from './features/elements/services/text-editing.service';
import { CellEditorsService } from './features/elements/services/cell-editors.service';
import { DEFAULT_FONT_SIZE } from './helpers/render/text-layout';
import { SlidePlacementService } from './features/slides/services/slide-placement.service';
import { DeckFocusService } from './features/slides/services/deck-focus.service';
import { SlideshowService } from './features/slides/services/slideshow.service';
import { FollowService } from './features/collaboration/services/follow.service';
import { EditorViewportService } from './services/editor-viewport.service';
import { MediaDropService } from './features/elements/services/media-drop.service';
import { ClipboardService } from './features/canvas/services/clipboard.service';
import { EditorExportService } from './features/export/services/editor-export.service';
import { EditorShortcutsService } from './services/editor-shortcuts.service';
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
import { ToolbarPrefsService } from './services/toolbar-prefs.service';
import { PenOptionsBarComponent } from './features/toolbar/components/pen-options-bar/pen-options-bar.component';
import { PenPrefsService } from './services/pen-prefs.service';
import { InspectorPanelService } from './services/inspector-panel.service';
import type { CanvasItemRef } from '../../core/editor-bridge/editor-actions.service';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { IconComponent } from '../../shared/ui/components/icon/icon.component';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { CanvasElementModel, TableModel } from '@devdesigner/shared';
import { presentationOf, presentationSlides, layoutOf, sequenceDiagramRect, masterOf } from '@devdesigner/shared';
import { LaserService } from '../../core/realtime/laser.service';
import { RealtimeService } from '../../core/realtime/realtime.service';
import { type DeckSummary, EditorActionsService } from '../../core/editor-bridge/editor-actions.service';
import { FontMetricsService } from './services/font-metrics.service';
import { ProjectFileService } from '../../shared/services/project-file.service';
import { isSandboxId } from '../../core/sandbox/sandbox-backend.service';
import { MediaActionsService } from './services/media-actions.service';
import { ImageCropOverlayComponent } from './features/elements/components/image-crop-overlay/image-crop-overlay.component';
import { ProjectsStore } from '../../shared/state/projects/projects.store';
import { ThemeService } from '../../core/theme/theme.service';
import { ProjectStore, type SequenceLayoutSnapshot } from './state/project/project.store';
import { AutofocusDirective } from '../../shared/ui/directives/autofocus.directive';
import { CodeActionsService } from './services/code-actions.service';
import { GridTableService } from './services/grid-table.service';
import { gridCellAt } from './helpers/grid-table.helper';
import { CanvasConnectorsComponent } from './features/canvas/components/canvas-connectors/canvas-connectors.component';
import { CanvasShapesComponent } from './features/canvas/components/canvas-shapes/canvas-shapes.component';
import { type AlignAction } from './models/toolbar-actions';
import { standInFor } from './helpers/layout-placeholders';
import { MinimapComponent } from './features/minimap/minimap.component';
import { NODE_WIDTH, SVG_OFFSET } from './shared/constants/canvas.constants';
import { sequenceDiagramBox } from './helpers/frame-contents.helper';
import { framePreset } from './shared/constants/frame-presets';
import { elementBox, elementIntersectsRect, hitTestElement, tableBox } from './helpers/element-geometry.helper';
import { tableHeight, snapToGrid, tableWidth } from './helpers/node-metrics.helper';
import { CODE_FONT_SIZE, codeDiffActive, codeDiffSplit, CODE_DOTS_WIDTH, codeHeaderHeight } from './helpers/render';
import type { Box, Rect } from './models/geometry.model';
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
import { TableNodeComponent } from './features/erd/components/table-node/table-node.component';
import { DEFAULT_ELEMENT_STROKE } from './shared/constants/canvas.constants';
import type { RelinkPreview } from './services/canvas-view.service';
/** Element kinds that can contain other items (a lone selection aligns to these). */
const CONTAINER_TYPES: ReadonlySet<string> = new Set(['frame', 'rectangle', 'ellipse', 'diamond']);

function readFlag(key: string, fallback: boolean): boolean {
   try {
      const v = globalThis.localStorage?.getItem(key);
      return v == null ? fallback : v === '1';
   } catch {
      return fallback;
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
   ],
   templateUrl: './editor.component.html',
   styleUrl: './editor.component.scss',
})
export class EditorComponent {
   protected readonly deckPanels = inject(DeckPanelsService);
   protected readonly drawTool = inject(DrawToolService);
   readonly elementGestures = inject(ElementGestureService);
   protected readonly groupTransform = inject(GroupTransformService);
   protected readonly laserInput = inject(LaserInputService);
   protected readonly snap = inject(CanvasSnapService);
   protected readonly canvasView = inject(CanvasViewService);
   protected readonly tools = inject(EditorToolService);
   protected readonly relLink = inject(RelationshipLinkService);
   protected readonly tableDrag = inject(TableDragService);
   protected readonly gesture = inject(PointerGestureService);
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

   /** Placement + representative element for the floating context toolbar. */
   protected readonly elementToolbar = computed(() => {
      // Shown whenever element(s) are selected and no gesture/text-edit is active,
      // even while a draw tool stays active (drawing a shape selects it).
      const editingId = this.textEditing.editingTextId();
      const richEditing = !!editingId && this.store.elements().find((e) => e.id === editingId)?.type === 'text';
      if ((editingId && !richEditing) || this.gesture.gestureActive()) {
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
         const b = this.canvasView.drawnBox(e.id, elementBox(e));
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
      if (this.gesture.gestureActive() || !this.store.canEdit() || this.textEditing.editingTextId()) {
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
      for (const e of this.store.elements())
         if (selected.has(e.id)) grow(this.canvasView.drawnBox(e.id, elementBox(e)));
      for (const d of this.store.sequenceDiagrams()) {
         const b = selected.has(d.id) ? this.canvasView.diagramBox(d) : null;
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
      if (this.gesture.gestureActive()) {
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

   /**
    * The frame / shape a lone selected unit sits fully inside, if any. A single
    * selection aligns to this container, so no second selection is needed. Once
    * several units are selected they align to each other instead (which already
    * covers the "item + its container" case).
    */
   private readonly alignContainer = computed<Box | null>(() => {
      if (this.canvasView.alignUnitCount() !== 1) {
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
         const b = selected.has(d.id) ? this.canvasView.diagramBox(d) : null;
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
      () => this.store.canEdit() && (this.canvasView.alignUnitCount() >= 2 || !!this.alignContainer())
   );
   protected readonly canDistribute = computed(() => this.store.canEdit() && this.canvasView.alignUnitCount() >= 3);
   /** True when an align action would target the surrounding container. */
   protected readonly alignToContainer = computed(
      () => this.canvasView.alignUnitCount() === 1 && !!this.alignContainer()
   );

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

   private readonly codeActions = inject(CodeActionsService);
   protected readonly grids = inject(GridTableService);

   /** Every presentation gets a theme and a default layout; every slide a layout. */
   private readonly deckDefaults = effect(() => {
      this.store.slideFrames();
      if (!this.store.canEdit()) return;
      untracked(
         () =>
            void ensureDeckDefaults(this.store, this.canvasView.themeVar('--dd-text-muted') ?? DEFAULT_ELEMENT_STROKE)
      );
   });

   /** Typing into an empty placeholder: it takes its slot's current size and style first. */
   private readonly adoptSlotLook = effect(() => {
      const id = this.textEditing.editingTextId();
      const look = id ? untracked(() => this.canvasView.emptyCopyLooks().get(id)) : undefined;
      if (!id || !look || !this.store.canEdit()) return;
      const el = untracked(() => this.store.elements().find((e) => e.id === id));
      const stale =
         el && Object.entries(look.patch).some(([k, v]) => (el as unknown as Record<string, unknown>)[k] !== v);
      if (stale) void this.store.patchElementSilently(id, look.patch);
   });

   /** Slide blocks stop clipping while anything is carried, so it stays visible past the block. */
   protected readonly slideUnclipped = computed(() => {
      if (this.relLink.dragging()) return true;
      if (!this.gesture.movingItems()) return false;
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

   private marqueeAdditive = false;

   constructor() {
      this.deckPanels.connect(this);
      this.elementGestures.connect(this);
      this.snap.connect(this);
      this.canvasView.connect(this);
      this.tableDrag.connect(this);
      this.cellEditors.connect(this);
      this.textEditing.connect(this);
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
         if (this.gesture.gestureActive()) return;
         const timer = setTimeout(() => this.placement.syncSlideMoves(), 160);
         onCleanup(() => clearTimeout(timer));
      });
      // A presentation stays selected as a whole only while its shown slide alone is selected.
      effect(() => {
         const ids = this.store.selectedElementIds();
         const shown = this.store.shownByPresentation();
         untracked(() => {
            const sets = this.deckPanels.selectedSlideSets();
            // Still selected while its shown frame is (a marquee can take it with other items).
            const kept = sets.filter((set) => ids.includes(shown.get(set) ?? ''));
            if (kept.length !== sets.length) {
               this.deckPanels.selectedSlideSets.set(kept);
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
         this.canvasView.slideViews();
         // Never mid-drag: adopting re-maps items into a zoomed slide, which would jump them.
         if (this.gesture.gestureActive()) {
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
         if (!this.canvasView.minimapItems().length) return;
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
         setTimeout(() => this.tools.onToolChange(tool));
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
         newDeck: () => this.tools.onToolChange('slide'),
         setTool: (tool) => this.tools.onToolChange(tool as EditorTool),
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
         const on = this.gesture.gestureActive() && this.toolbarPrefs.fadeWhileDragging();
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

   // --- canvas pointer (pan / marquee) ---

   protected onCanvasPointerDown(event: PointerEvent): void {
      // Clicking away closes a grid cell editor even when the click does not move focus.
      if (this.grids.editingCell()) {
         this.grids.endEdit();
      }
      if (
         !this.deckFocus.focusedDeck() &&
         (event.button === 1 || (event.button === 0 && (this.gesture.spaceDown || this.tools.activeTool() === 'hand')))
      ) {
         event.preventDefault();
         this.gesture.mode = 'pan';
         this.tools.panning.set(true);
         this.gesture.startClientX = event.clientX;
         this.gesture.startClientY = event.clientY;
         const v = this.store.viewport();
         this.gesture.startViewportX = v.x;
         this.gesture.startViewportY = v.y;
         return;
      }
      if (event.button !== 0) {
         return;
      }
      const tool = this.tools.activeTool();
      if (tool !== 'select' && tool !== 'hand' && tool !== 'laser' && this.store.canEdit() && this.store.projectId()) {
         event.preventDefault();
         if (tool === 'table') {
            this.drawTool.addTableAt(event.clientX, event.clientY);
            this.tools.afterPlace();
            return;
         }
         if (tool === 'sequence') {
            this.drawTool.addSequenceAt(event.clientX, event.clientY);
            this.tools.afterPlace();
            return;
         }
         if (tool === 'slide') {
            // A click adds a slide: the first where you click, later ones stacked on the shown one.
            void this.placement.addSlide(this.viewport.toWorld(event.clientX, event.clientY));
            this.tools.afterPlace();
            return;
         }
         if (tool === 'freedraw' && this.penPrefs.eraser()) {
            this.drawTool.beginErase(event);
            return;
         }
         this.drawTool.beginDraw(tool, event);
         return;
      }
      // Grabbing a master or layout item drawn under a shown slide or layout gives that frame its own
      // copy, selected and (while the button is held) dragged like any item.
      if (tool === 'select' && this.store.canEdit() && !PointerGestureService.additive(event)) {
         const inherited = this.inheritedMasterItemAt(this.viewport.toWorld(event.clientX, event.clientY));
         if (inherited) {
            event.preventDefault();
            void this.grabInherited(inherited.item, inherited.frame, event);
            return;
         }
      }
      this.marqueeAdditive = PointerGestureService.additive(event);
      if (!this.marqueeAdditive) {
         this.store.clearSelection();
      }
      const p = this.viewport.screenPoint(event.clientX, event.clientY);
      this.marqueeStart.set(p);
      this.marqueeCurrent.set(p);
      this.gesture.mode = 'marquee';
   }

   // --- rich text editing (contenteditable) ---

   readonly gridCellArea = viewChild<ElementRef<HTMLTextAreaElement>>('gridCellArea');
   readonly richEditorRef = viewChild<ElementRef<HTMLDivElement>>('richEditor');

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
      this.gesture.lastPointer = event;
      this.gesture.shiftHeld = event.shiftKey;
      this.handlePointerMove(event);
   }

   handlePointerMove(event: PointerEvent): void {
      if (this.gesture.mode === 'duplicating') {
         return; // copies are still being created; the drag resumes from lastPointer
      }
      this.gesture.broadcastCursor(event);
      if (this.relLink.linkSourceColumnId() || this.relLink.relinkState()) {
         this.relLink.linkCursor.set(this.viewport.toWorld(event.clientX, event.clientY));
         return;
      }
      if (this.relLink.activeSegment()) {
         this.relLink.moveActiveSegment(event.clientX, event.clientY);
         return;
      }
      if (this.gesture.mode === 'draw') {
         this.drawTool.updateDraw(event.clientX, event.clientY, event.shiftKey, event.altKey);
         return;
      }
      if (this.gesture.mode === 'erase') {
         this.drawTool.eraseAt(event.clientX, event.clientY);
         return;
      }
      if (this.gesture.mode === 'element') {
         this.elementGestures.moveElements(event.clientX, event.clientY);
         return;
      }
      if (this.gesture.mode === 'element-resize') {
         this.elementGestures.resizeElement(event);
         return;
      }
      if (this.gesture.mode === 'group-resize') {
         this.groupTransform.groupResizeMove(event);
         return;
      }
      if (this.gesture.mode === 'spacing') {
         this.groupTransform.spacingMove(event);
         return;
      }
      if (this.gesture.mode === 'element-rotate') {
         this.elementGestures.rotateElement(event);
         return;
      }
      if (this.gesture.mode === 'arrow-endpoint') {
         this.elementGestures.moveEndpoint(event.clientX, event.clientY);
         return;
      }
      if (this.gesture.mode === 'arrow-bend') {
         this.elementGestures.moveBend(event.clientX, event.clientY);
         return;
      }
      if (this.gesture.mode === 'pan') {
         const dx = event.clientX - this.gesture.startClientX;
         const dy = event.clientY - this.gesture.startClientY;
         const v = this.store.viewport();
         this.store.setViewport(this.gesture.startViewportX + dx, this.gesture.startViewportY + dy, v.zoom);
      } else if (this.gesture.mode === 'node' && this.gesture.dragTableId) {
         if (this.gesture.belowDragThreshold(event.clientX, event.clientY)) {
            return;
         }
         this.gesture.movingItems.set(true);
         let { dx, dy } = this.gesture.dragDelta(event.clientX, event.clientY);
         const smart = this.snap.smartDelta(
            this.gesture.dragTableId,
            this.gesture.nodeExtras?.elements.keys() ?? [],
            this.gesture.multiDragStart.keys(),
            dx,
            dy,
            this.gesture.nodeExtras?.sequences.keys() ?? []
         );
         dx += smart?.ox ?? 0;
         dy += smart?.oy ?? 0;
         const grid = this.snap.gridSnap();
         // The tables' actual (snapped) move, so routes carried with them stay attached.
         let moved: { x: number; y: number } | null = null;
         const tables = new Map<string, { x: number; y: number }>();
         for (const [id, start] of this.gesture.multiDragStart) {
            const nx = grid && !smart?.snappedX ? snapToGrid(start.x + dx) : Math.round(start.x + dx);
            const ny = grid && !smart?.snappedY ? snapToGrid(start.y + dy) : Math.round(start.y + dy);
            tables.set(id, { x: nx, y: ny });
            if (id === this.gesture.dragTableId || !moved) moved = { x: nx - start.x, y: ny - start.y };
         }
         const mx = moved?.x ?? dx;
         const my = moved?.y ?? dy;
         const waypoints = new Map<string, { x: number; y: number }[]>();
         // Keep manual routes attached as their tables move. Both endpoints moving
         // together: translate the whole route rigidly. A single endpoint moving:
         // the waypoint nearest that anchor follows it in y (its horizontal run
         // stays parallel, the vertical run to it shrinks or grows); its x is
         // absorbed by the horizontal run, and every other waypoint stays put.
         for (const [relId, start] of this.gesture.waypointDragStart) {
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
         this.store.moveItemsLocal({ tables, waypoints, ...this.elementGestures.nodeExtrasMoves(mx, my) });
      } else if (this.gesture.mode === 'marquee') {
         this.marqueeCurrent.set(this.viewport.screenPoint(event.clientX, event.clientY));
      }
   }

   @HostListener('window:pointerup')
   onPointerUp(): void {
      if (this.gesture.mode === 'duplicating') {
         // The copies are still being created; finish the drop once they exist.
         this.gesture.releasedWhileDuplicating = true;
         return;
      }
      this.relLink.commitLinkSnap();
      const edgeGesture =
         this.gesture.mode === 'element-resize' ||
         this.gesture.mode === 'arrow-endpoint' ||
         this.gesture.mode === 'draw';
      const moved =
         this.gesture.mode === 'element' || this.gesture.mode === 'node'
            ? { elements: [...this.store.selectedElementIds()], tables: [...this.store.selectedTableIds()] }
            : null;
      if (this.gesture.mode === 'marquee') {
         this.commitMarquee();
      } else if (this.gesture.mode === 'draw') {
         void this.drawTool.commitDraft(false);
      } else if (this.gesture.mode === 'erase') {
         this.drawTool.commitErase();
      } else if (this.gesture.mode === 'element') {
         this.elementGestures.recordMoveGesture();
      } else if (this.gesture.mode === 'node') {
         this.elementGestures.settleNodeExtras();
      } else if (this.gesture.mode === 'group-resize') {
         this.groupTransform.commitGroupResize();
      } else if (this.gesture.mode === 'spacing') {
         this.groupTransform.commitSpacingDrag();
      } else if (
         this.gesture.mode === 'element-resize' ||
         this.gesture.mode === 'element-rotate' ||
         this.gesture.mode === 'arrow-endpoint' ||
         this.gesture.mode === 'arrow-bend'
      ) {
         this.elementGestures.commitElementGesture();
      }
      this.gesture.mode = 'idle';
      this.tools.panning.set(false);
      this.gesture.dragTableId = null;
      this.gesture.nodeExtras = null;
      this.elementGestures.elementGesture = null;
      this.gesture.gestureActive.set(false);
      this.gesture.movingItems.set(false);
      this.elementGestures.bindHighlight.set(null);
      this.gesture.multiDragStart.clear();
      this.gesture.waypointDragStart.clear();
      this.marqueeStart.set(null);
      this.marqueeCurrent.set(null);
      this.relLink.persistFlippedSides();
      this.relLink.activeSegment.set(null);
      this.relLink.clearLinking();
      this.gesture.gestureScale = 1;
      // Sequence diagrams run their own drags and clear this after their final shift.
      if (moved || edgeGesture) this.snap.smartDragEnd();
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
         const view = this.canvasView.viewOf(id);
         return view ? this.canvasView.rectThrough(view, rect) : rect;
      };
      const tableIds = this.canvasView
         .visibleTables()
         .filter((t) => {
            const r = rectIn(t.id);
            return !!r && this.boxIntersects(t, r);
         })
         .map((t) => t.id);
      const zoomedRels = this.canvasView.zoomedConnectorIds();
      const relIds = this.canvasView
         .connectors()
         .filter((con) => {
            const view = zoomedRels.get(con.id);
            const r = view ? this.canvasView.rectThrough(view, rect) : rect;
            return !!r && con.mx >= r.minX && con.mx <= r.maxX && con.my >= r.minY && con.my <= r.maxY;
         })
         .map((con) => con.id);
      const elementIds = this.canvasView
         .shownElements()
         .filter((e) => {
            const r = rectIn(e.id);
            return !!r && elementIntersectsRect(e, r);
         })
         .map((e) => e.id);

      // Sequence parts of a slide's diagrams are tested through that slide's block.
      const viewedDiagrams = this.canvasView.zoomedItems().diagrams;
      const diagramRect = (diagramId: string): Rect | null => {
         const view = viewedDiagrams.get(diagramId);
         return view ? this.canvasView.rectThrough(view, rect) : rect;
      };
      const sequenceHits = (find: (r: Rect) => string[], diagramOf: (id: string) => string | undefined): string[] => {
         const out = find(rect).filter((id) => !viewedDiagrams.has(diagramOf(id) ?? ''));
         for (const view of new Set(viewedDiagrams.values())) {
            const r = this.canvasView.rectThrough(view, rect);
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
      const enclosed = this.deckPanels
         .slideSets()
         .filter(
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
         tableSel = this.canvasView
            .visibleTables()
            .filter(
               (t) =>
                  tableIds.includes(t.id) &&
                  !inside({ x0: t.x, y0: t.y, x1: t.x + tableWidth(t), y1: t.y + tableHeight(t) })
            )
            .map((t) => t.id);
         elementSel = [
            ...frameIds,
            ...this.canvasView
               .shownElements()
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
      this.deckPanels.selectedSlideSets.set(
         this.marqueeAdditive ? [...new Set([...this.deckPanels.selectedSlideSets(), ...names])] : names
      );
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

   /** Sequence diagrams whose bounding box (as drawn) lies entirely inside the marquee rect. */
   private diagramsInRect(rect: Rect): string[] {
      const out: string[] = [];
      for (const d of this.store.sequenceDiagrams()) {
         const b = this.canvasView.diagramBox(d);
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

   readonly editingTextId = this.textEditing.editingTextId;
   readonly relinkPreview = computed<RelinkPreview | null>(() => {
      const relink = this.relLink.relinkState();
      const cursor = this.relLink.linkSnap()?.anchor ?? this.relLink.linkCursor();
      return relink && cursor ? { ...relink, cursor } : null;
   });
   readonly slideViews = this.canvasView.slideViews;
   readonly minimapItems = this.canvasView.minimapItems;
   readonly drawnBox = (id: string, box: Box): Box => this.canvasView.drawnBox(id, box);
   readonly diagramBox = (d: SequenceDiagramModel): Rect | null => this.canvasView.diagramBox(d);

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
   readonly selectedSlideSets = this.deckPanels.selectedSlideSets;
   readonly selectSlideSet = (name: string): void => this.deckPanels.selectSlideSet(name);
   readonly presentationOutlineBoxes = (): { frameId: string; box: Box }[] =>
      this.deckPanels.presentationOutlineBoxes();
   readonly updateDraw = (clientX: number, clientY: number, shift: boolean, alt: boolean): void =>
      this.drawTool.updateDraw(clientX, clientY, shift, alt);
   readonly beginNodeDrag = (tableId: string): void => this.tableDrag.beginNodeDrag(tableId);
   readonly syncSlideMoves = (): void => this.placement.syncSlideMoves();
   readonly newPresentationName = (): string => this.placement.newPresentationName();
   get slideBounds(): Map<string, { x: number; y: number; w: number; h: number }> {
      return this.placement.slideBounds;
   }
   readonly duplicateAndDrag = (): Promise<void> => this.elementGestures.duplicateAndDrag();

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
      const hits = this.canvasView
         .shownElements()
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
         const b = this.canvasView.diagramBox(d);
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
      const hide = this.canvasView.focusHidden();
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
      this.gesture.startClientX = event.clientX;
      this.gesture.startClientY = event.clientY;
      this.gesture.gestureScale = this.canvasView.itemScale(copy.id);
      this.gesture.dragCopied = false;
      this.elementGestures.beginElementDrag(copy);
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
         strokeColor: style.strokeColor ?? this.canvasView.defaultStroke(),
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
      this.tools.draft.set(draft);
      void this.drawTool.commitDraft(true);
   }

   protected addTableCentered(): void {
      const rect = this.viewport.canvasRect();
      const v = this.store.viewport();
      let x = Math.round((rect.width / 2 - v.x) / v.zoom - NODE_WIDTH / 2);
      let y = Math.round((rect.height / 2 - v.y) / v.zoom - 40);
      if (this.snap.gridSnap()) {
         x = snapToGrid(x);
         y = snapToGrid(y);
      }
      void this.store.addTable(x, y);
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
         const b = this.canvasView.diagramBox(d);
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
               seqMoves.push({ id: d.id, before: this.canvasView.layoutSnapshot(d.id) });
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
      this.relLink.followRoutes(tableStart);
      this.store.recordElementMove(moves);
      for (const { id, before } of seqMoves) {
         const after = this.canvasView.layoutSnapshot(id);
         for (const [lid, x] of after.lifelineXs) this.store.moveLifeline(lid, x);
         for (const [mid, y] of after.messageYs) this.store.moveMessage(mid, y);
         void this.store.updateSequenceConfig(id, {
            rowSpacing: after.rowSpacing,
            originY: after.originY,
         });
         this.store.recordSequenceLayout(id, before, after);
      }
   }
}
