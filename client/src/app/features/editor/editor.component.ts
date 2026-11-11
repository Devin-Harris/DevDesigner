import { FloatingToolbarsService } from './features/elements/services/floating-toolbars.service';
import { AlignService } from './services/align.service';
import { RemotePresenceService } from './features/collaboration/services/remote-presence.service';
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
import { presentationOf, presentationSlides } from '@devdesigner/shared';
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
import { ProjectStore } from './state/project/project.store';
import { AutofocusDirective } from '../../shared/ui/directives/autofocus.directive';
import { CodeActionsService } from './services/code-actions.service';
import { GridTableService } from './services/grid-table.service';
import { CanvasConnectorsComponent } from './features/canvas/components/canvas-connectors/canvas-connectors.component';
import { CanvasShapesComponent } from './features/canvas/components/canvas-shapes/canvas-shapes.component';
import { MinimapComponent } from './features/minimap/minimap.component';
import { NODE_WIDTH, SVG_OFFSET } from './shared/constants/canvas.constants';
import { framePreset } from './shared/constants/frame-presets';
import { snapToGrid } from './helpers/node-metrics.helper';
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
      AlignService,
      FloatingToolbarsService,
      RemotePresenceService,
   ],
   templateUrl: './editor.component.html',
   styleUrl: './editor.component.scss',
})
export class EditorComponent {
   protected readonly presence = inject(RemotePresenceService);
   protected readonly bars = inject(FloatingToolbarsService);
   protected readonly align = inject(AlignService);
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
      this.align.connect(this);
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
      // Track the canvas size and position (minimap rectangle, cached screen/world mapping).
      effect((onCleanup) => onCleanup(this.viewport.observeCanvas(this.canvasRef().nativeElement)));
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
      // Floating islands fade while dragging or drawing (toolbar setting).
      effect(() => {
         const on = this.gesture.gestureActive() && this.toolbarPrefs.fadeWhileDragging();
         document.body.classList.toggle('dd-gesture', on);
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
   readonly followRoutes = (start: Map<string, { x: number; y: number }>): void => this.relLink.followRoutes(start);
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
}
