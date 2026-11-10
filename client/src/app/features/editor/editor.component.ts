import { EditorPointerService } from './editor-pointer.service';
import { CanvasDblClickService } from './features/elements/services/canvas-dblclick.service';
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
import type { CanvasElementModel } from '@devdesigner/shared';
import { presentationOf, presentationSlides, sequenceDiagramRect } from '@devdesigner/shared';
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
import { CanvasConnectorsComponent } from './features/canvas/components/canvas-connectors/canvas-connectors.component';
import { CanvasShapesComponent } from './features/canvas/components/canvas-shapes/canvas-shapes.component';
import { type AlignAction } from './models/toolbar-actions';
import { MinimapComponent } from './features/minimap/minimap.component';
import { NODE_WIDTH, SVG_OFFSET } from './shared/constants/canvas.constants';
import { sequenceDiagramBox } from './helpers/frame-contents.helper';
import { framePreset } from './shared/constants/frame-presets';
import { elementBox, tableBox } from './helpers/element-geometry.helper';
import { tableHeight, snapToGrid, tableWidth } from './helpers/node-metrics.helper';
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
      CanvasDblClickService,
      EditorPointerService,
   ],
   templateUrl: './editor.component.html',
   styleUrl: './editor.component.scss',
})
export class EditorComponent {
   protected readonly pointer = inject(EditorPointerService);
   protected readonly dblClick = inject(CanvasDblClickService);
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

      this.dblClick.attach(host);

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

   // --- rich text editing (contenteditable) ---

   readonly gridCellArea = viewChild<ElementRef<HTMLTextAreaElement>>('gridCellArea');
   readonly richEditorRef = viewChild<ElementRef<HTMLDivElement>>('richEditor');

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
   @HostListener('window:dragstart', ['$event'])
   protected onNativeDragStart(event: DragEvent): void {
      this.pointer.onNativeDragStart(event);
   }

   @HostListener('window:pointermove', ['$event'])
   protected onPointerMove(event: PointerEvent): void {
      this.pointer.onPointerMove(event);
   }

   @HostListener('window:pointerup')
   onPointerUp(): void {
      this.pointer.onPointerUp();
   }

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
   readonly handlePointerMove = (event: PointerEvent): void => this.pointer.handlePointerMove(event);
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
