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
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import type {
  CanvasElementModel,
  CodeLanguage,
  CreateElementDto,
  ElementType,
  RelationshipModel,
  RelationshipType,
  TableModel,
  TextRun,
} from '@dbdesigner/shared';
import {
  generateSql,
  PROJECT_EXPORT_FORMAT,
  PROJECT_EXPORT_VERSION,
  presentationOf,
  presentationSlides,
  type SequenceDiagramModel,
} from '@dbdesigner/shared';
import { LOCAL_LASER, LaserService } from '../../core/services/laser.service';
import { RealtimeService } from '../../core/services/realtime.service';
import { EditorActionsService } from '../../core/services/editor-actions.service';
import { ProjectFileService } from '../../core/services/project-file.service';
import { ElementImagesService } from '../../core/services/element-images.service';
import { ProjectsStore } from '../../stores/projects.store';
import { ThemeService } from '../../core/services/theme.service';
import { ProjectStore, type SequenceLayoutSnapshot } from '../../stores/project.store';
import { AutofocusDirective } from './autofocus.directive';
import { CodeActionsService } from '../../core/services/code-actions.service';
import {
  CanvasConnectorsComponent,
  type EndpointDownEvent,
  type SegmentDownEvent,
} from './canvas-connectors/canvas-connectors.component';
import {
  CanvasShapesComponent,
  type ResizeDownEvent,
  type ResizeHandle,
  type ShapeBendEvent,
  type ShapeEndpointEvent,
  type ShapePointerEvent,
} from './canvas-shapes/canvas-shapes.component';
import { type AlignAction } from './canvas/models/toolbar-actions';
import { MinimapComponent, type MinimapItem } from './minimap/minimap.component';
import { MAX_ZOOM, MIN_ZOOM, NODE_WIDTH, SVG_OFFSET } from './canvas/constants/canvas.constants';
import { computeConnectors, segmentDrag } from './canvas/helpers/connectors.helper';
import {
  contentForFrame,
  frameContents,
  sequenceDiagramBox,
} from './canvas/helpers/frame-contents.helper';
import { DEFAULT_FRAME_PRESET, framePreset } from './canvas/constants/frame-presets';
import {
  absolutePoints,
  elementBox,
  elementIntersectsRect,
  FRAME_TITLE_H,
  FRAME_TITLE_W,
  hitTestElement,
  tableBox,
  toRelative,
} from './canvas/helpers/element-geometry.helper';
import { chordNormal } from './canvas/helpers/freedraw-path.helper';
import {
  buildColumnLocations,
  columnAnchor,
  tableHeight,
  snapToGrid,
  tableWidth,
} from './canvas/helpers/node-metrics.helper';
import { messageLabelBoxes } from './canvas/helpers/message-box.helper';
import {
  buildShapeViews,
  CODE_FONT_SIZE,
  CODE_PADDING,
  codeContentSize,
  CODE_DOTS_WIDTH,
  codeHeaderHeight,
  codeTitle,
  codeLayoutMetrics,
  codeLineCount,
  codePrintWidth,
  fontStack,
  fontWeightFor,
} from './canvas/helpers/shape-render.helper';
import {
  DEFAULT_LINE_HEIGHT,
  fitTextElement,
  TEXT_MAX_FONT_SIZE,
  TEXT_MIN_FONT_SIZE,
} from './canvas/helpers/text-metrics';
import {
  isPlainRuns,
  normalizeRuns,
  patchRuns,
  plainOf,
  runsOrPlain,
  styleOver,
  usableRuns,
  type RunBase,
  type RunPatch,
} from './canvas/helpers/rich-text.helper';
import {
  listAutoformat,
  listBackspace,
  listEnter,
  listKindOver,
  normalizeLists,
  shiftListIndent,
  toggleList,
  type ListKind,
  type ListResult,
} from './canvas/helpers/rich-list.helper';
import { RichTextSessionService } from '../../core/services/rich-text-session.service';
import { TAB_SIZE } from './canvas/helpers/code-highlight.helper';
import { formatCode } from './canvas/helpers/code-format.helper';
import { elbowPath } from './canvas/helpers/svg-path.helper';
import { findLinkSnap, type LinkSnap } from './canvas/helpers/link-snap.helper';
import type { Box, Point, Side } from './canvas/models/geometry.model';
import { ElementFloatingToolbarComponent } from './element-floating-toolbar/element-floating-toolbar.component';
import { buildDiagramSvg, type SequenceExportData } from './export/diagram-svg.helper';
import { embedFonts } from './export/font-embed.helper';
import { ExportDialogComponent } from './export/export-dialog.component';
import {
  FrameOrderDialogComponent,
  type FrameOrderDialogData,
} from './export/frame-order-dialog.component';
import {
  downloadBlob,
  exportDiagramImage,
  pagesToPdfBlob,
  type DiagramImage,
  type ImageFormat,
} from './export/image-export.helper';
import { InspectorComponent } from './inspector/inspector.component';
import { RelationshipInspectorComponent } from './relationship-inspector/relationship-inspector.component';
import { ElementInspectorComponent } from './element-inspector/element-inspector.component';
import { SequenceInspectorComponent } from './sequence-inspector/sequence-inspector.component';
import { SequenceMessageToolbarComponent } from './sequence-message-toolbar/sequence-message-toolbar.component';
import { SequenceParticipantToolbarComponent } from './sequence-participant-toolbar/sequence-participant-toolbar.component';
import { CanvasSequenceComponent } from './canvas-sequence/canvas-sequence.component';
import { TableToolbarComponent } from './table-toolbar/table-toolbar.component';
import { RelationshipToolbarComponent } from './relationship-toolbar/relationship-toolbar.component';
import { LaserLayerComponent } from './laser-layer/laser-layer.component';
import { ShapeToolbarComponent, type EditorTool } from './shape-toolbar/shape-toolbar.component';
import { ShareDialogComponent } from './share-dialog/share-dialog.component';
import { PresentModeComponent } from './slides/present-mode.component';
import { SlideRenderService, type RenderedSlide } from './slides/slide-render.service';
import { SlidesPanelComponent, type SlidesCommand } from './slides/slides-panel.component';
import { TableNodeComponent, type HandleEvent } from './table-node/table-node.component';

type DragMode =
  | 'idle'
  | 'pan'
  | 'node'
  | 'marquee'
  | 'draw'
  | 'element'
  | 'element-resize'
  | 'element-rotate'
  | 'arrow-endpoint'
  | 'arrow-bend'
  /** Alt-drag: waiting for the copies to be created before the drag can start. */
  | 'duplicating';

/** Default styling applied to a newly drawn element. */
const DEFAULT_ELEMENT_STROKE = '#2f3a45';
const DEFAULT_FONT_SIZE = 20;

/** A sequence diagram's layout at drag start, as `shiftSequence` expects it. */
interface SequenceStart {
  xs: Map<string, number>;
  originY: number;
  rows: Map<string, number>;
}

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

interface RelinkState {
  relationshipId: string;
  which: 'source' | 'target';
}

interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Element kinds that can contain other items (a lone selection aligns to these). */
const CONTAINER_TYPES: ReadonlySet<string> = new Set(['frame', 'rectangle', 'ellipse', 'diamond']);
const GRID_SNAP_KEY = 'dbd-grid-snap';
const SIDE_PANEL_KEY = 'dbd-side-panel-collapsed';

function readStoredSidePanelCollapsed(): boolean {
  try {
    return globalThis.localStorage?.getItem(SIDE_PANEL_KEY) === '1';
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
@Component({
  selector: 'app-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
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
    MinimapComponent,
    CanvasSequenceComponent,
    ElementFloatingToolbarComponent,
    RelationshipInspectorComponent,
    ElementInspectorComponent,
    RelationshipToolbarComponent,
    TableToolbarComponent,
    TableNodeComponent,
    AutofocusDirective,
    SlidesPanelComponent,
    PresentModeComponent,
  ],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.scss',
})
export class EditorComponent {
  protected readonly store = inject(ProjectStore);
  protected readonly realtime = inject(RealtimeService);
  private readonly laser = inject(LaserService);
  private readonly dialog = inject(MatDialog);
  private readonly projectFile = inject(ProjectFileService);
  private readonly projectsStore = inject(ProjectsStore);
  private readonly snackBar = inject(MatSnackBar);
  private readonly slideRender = inject(SlideRenderService);

  /** The slide sorter panel (slides / presentation mode). */
  /** Kept as a signal other code reads; the panel itself shows whenever a frame is selected. */
  protected readonly slidesOpen = signal(false);
  /** The running presentation (or a one-transition preview), or null when not presenting. */
  protected readonly presentation = signal<{
    slides: RenderedSlide[];
    start: number;
    preview: boolean;
    /** Participant id being followed, when watching someone else's presentation. */
    follow: string | null;
  } | null>(null);
  /** Other participants who are presenting right now (offer to follow them). */
  protected readonly presenters = this.realtime.presenters;

  /** Whether the canvas inspector panels (table, relationship, element...) are folded away. */
  protected readonly sidePanelCollapsed = signal(readStoredSidePanelCollapsed());

  /** The slide being shown/edited; it is the only slide on the canvas. */
  protected readonly activeSlideId = this.store.activeSlideId;

  /** What the canvas leaves out because it belongs to another (stacked) slide. */
  protected readonly focusHidden = this.store.hiddenBySlides;

  /** The elements on the canvas right now (not collapsed away with another slide). */
  private shownElements(): CanvasElementModel[] {
    const hide = this.focusHidden();
    const all = this.store.elements();
    return hide ? all.filter((e) => !hide.elementIds.has(e.id)) : [...all];
  }

  /** Tables that are on the canvas right now (focus mode collapses other slides' tables). */
  protected readonly visibleTables = computed(() => {
    const hide = this.focusHidden();
    const tables = this.store.tables();
    return hide ? tables.filter((t) => !hide.tableIds.has(t.id)) : tables;
  });

  /** Sequence diagrams hidden by focus mode. */
  protected readonly hiddenDiagramIds = computed<ReadonlySet<string> | null>(
    () => this.focusHidden()?.diagramIds ?? null,
  );

  /** The settings panel is folded to a narrow strip (it folds sideways, toward the frame's edge). */
  protected readonly settingsFolded = signal(false);

  /** Panels hug the frame: this is the gap to its edge, and the outline's padding. */
  private static readonly PANEL_GAP = 8;
  private static readonly PANEL_PAD = 6;
  /** Smallest outline padding on screen, so the dashed border clears the panels at any zoom. */
  private static readonly PANEL_MIN_PAD_PX = 8;
  private static readonly LIST_W = 296;
  private static readonly SETTINGS_W = 296;
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
  protected readonly slideSets = computed(() => {
    const v = this.store.viewport();
    const gap = EditorComponent.PANEL_GAP;
    const frames = this.store.slideFrames();
    const shown = this.store.shownByPresentation();
    const folded = this.settingsFolded();
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
      // The border and its corner radius are fixed screen px, so zoomed far out the scaled
      // padding would shrink below them and the panels would poke through the outline.
      const pad = Math.max(EditorComponent.PANEL_PAD * v.zoom, EditorComponent.PANEL_MIN_PAD_PX);
      const bottom = top + height * v.zoom;
      return [
        {
          name,
          frameId: frame.id,
          list,
          settings,
          outline: {
            left: list.left - pad,
            top: top - pad,
            width: settings.left + settings.width * v.zoom - list.left + pad * 2,
            height: bottom - top + pad * 2,
          },
        },
      ];
    });
  });

  /**
   * The presentation selected as a whole (its outer border was clicked): drawn with a
   * selected outline, and Delete removes every slide of it. Null otherwise.
   */
  protected readonly selectedSlideSet = signal<string | null>(null);

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
    this.onElementPointerDown({ id: frameId, event });
    this.selectedSlideSet.set(name);
  }

  /** Touching a presentation's panels makes it the selected one (F5, export). */
  protected selectSlideSet(name: string): void {
    this.store.selectPresentation(name);
  }
  private readonly destroyRef = inject(DestroyRef);
  private readonly editorActions = inject(EditorActionsService);
  private readonly theme = inject(ThemeService);
  protected readonly svgOffset = SVG_OFFSET;

  /** Owner/anonymous mode passes a project id; shared mode passes a token instead. */
  readonly projectId = input<string | null>(null);
  readonly shareToken = input<string | null>(null);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLDivElement>>('canvas');

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

  protected readonly gridSnap = signal(readStoredGrid());

  protected readonly worldTransform = computed(() => {
    const v = this.store.viewport();
    return `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
  });
  protected readonly zoomLabel = computed(() => `${Math.round(this.store.viewport().zoom * 100)}%`);
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

  private readonly columnLocations = computed(() => buildColumnLocations(this.store.tables()));

  protected readonly connectors = computed(() =>
    computeConnectors(
      this.visibleTables(),
      this.store.relationships(),
      new Set(this.store.selectedRelationshipIds()),
      this.store
        .elements()
        .filter((e) => e.type === 'frame')
        .map(elementBox),
    ),
  );

  // --- drawing tools / canvas elements ---

  /** The active tool. 'select' is the pointer mode; others draw that element. */
  protected readonly activeTool = signal<EditorTool>('select');
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
    const editingId = this.editingTextId();
    const richEditing =
      !!editingId && this.store.elements().find((e) => e.id === editingId)?.type === 'text';
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
      const b = elementBox(e);
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

  /** World boxes of sequence message labels: anchor targets for lines/arrows. */
  private readonly messageBoxes = computed(() =>
    messageLabelBoxes(
      this.store.sequenceDiagrams(),
      this.store.lifelines(),
      this.store.sequenceMessages(),
    ),
  );

  /**
   * Stacking of sequence diagrams against drawing elements. A diagram with a
   * zIndex at or below the topmost element sits among the content shapes (the
   * content layer is split into slices around each such diagram); one above
   * every element also clears the table nodes. Table nodes stay at z 400.
   */
  protected readonly diagramLayers = computed(() => {
    const els = this.store.elements().filter((e) => e.type !== 'frame');
    const maxZ = els.reduce((m, e) => Math.max(m, e.zIndex), -Infinity);
    const sorted = [...this.store.sequenceDiagrams()].sort((a, b) => a.zIndex - b.zIndex);
    const among = sorted.filter((d) => d.zIndex <= maxZ);
    const z = new Map<string, number>();
    among.forEach((d, i) => z.set(d.id, 11 + 2 * i));
    sorted.filter((d) => d.zIndex > maxZ).forEach((d, i) => z.set(d.id, 401 + i));
    const segmentOf = new Map<string, number>();
    for (const e of els) {
      let s = 0;
      while (s < among.length && among[s].zIndex < e.zIndex) s++;
      segmentOf.set(e.id, s);
    }
    return { z, segmentOf, segments: among.length + 1 };
  });

  /** One content-layer slice per gap between diagrams (a single one without diagrams). */
  protected readonly contentSegments = computed(() => {
    const { segmentOf, segments } = this.diagramLayers();
    return Array.from({ length: segments }, (_, index) => ({
      index,
      z: 10 + 2 * index,
      // Anything unknown (the in-progress draft) is newest, so it draws on top.
      accept: (id: string): boolean => (segmentOf.get(id) ?? segments - 1) === index,
    }));
  });

  /** Render views for all elements plus any in-progress draft, resolved for the SVG layer. */
  protected readonly shapeViews = computed(() => {
    const draft = this.draft();
    const hide = this.focusHidden();
    const all = hide
      ? this.store.elements().filter((e) => !hide.elementIds.has(e.id))
      : this.store.elements();
    const elements = draft ? [...all, draft] : all;
    // Depend on the theme so colors re-resolve (and re-contrast) on toggle.
    this.theme.dark();
    return buildShapeViews(
      elements,
      this.visibleTables(),
      new Set(this.store.selectedElementIds()),
      this.themeColors(),
      this.messageBoxes(),
    );
  });

  /** Resolved canvas background + text color for the render-time contrast guard. */
  private themeColors(): { canvasBg: string; text: string; surface: string } | undefined {
    try {
      const styles = getComputedStyle(this.canvasRef().nativeElement);
      const canvasBg = styles.getPropertyValue('--dbd-canvas-bg').trim();
      const text = styles.getPropertyValue('--dbd-text').trim();
      const surface = styles.getPropertyValue('--dbd-surface').trim();
      return canvasBg && text ? { canvasBg, text, surface } : undefined;
    } catch {
      return undefined;
    }
  }

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
      }),
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
    () => this.store.canEdit() && (this.alignUnitCount() >= 2 || !!this.alignContainer()),
  );
  protected readonly canDistribute = computed(
    () => this.store.canEdit() && this.alignUnitCount() >= 3,
  );
  /** True when an align action would target the surrounding container. */
  protected readonly alignToContainer = computed(
    () => this.alignUnitCount() === 1 && !!this.alignContainer(),
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

  protected readonly shapesInteractive = computed(
    () => this.activeTool() === 'select' && this.store.canEdit(),
  );

  /** Id of the text element being edited inline (a DOM textarea overlays it). */
  protected readonly editingTextId = signal<string | null>(null);

  private readonly codeActions = inject(CodeActionsService);

  /** Screen-space placement of the inline file-name input over a code block's title bar. */
  protected readonly fileNameEditor = computed(() => {
    const id = this.codeActions.fileNameEditId();
    const el = id ? this.store.elements().find((e) => e.id === id && e.type === 'code') : null;
    if (!el || !this.store.canEdit()) {
      return null;
    }
    const v = this.store.viewport();
    const z = v.zoom;
    const fontSize = el.fontSize ?? CODE_FONT_SIZE;
    // With no name yet there is no bar; the input shows where it will appear.
    const height = codeHeaderHeight(fontSize);
    const view = this.shapeViews().find((s) => s.id === el.id)?.code;
    return {
      id: el.id,
      value: el.fileName ?? '',
      // Inset from both sides by the dot cluster's width: the dots stay visible and
      // the centered title keeps its place.
      left: (el.x + CODE_DOTS_WIDTH) * z + v.x,
      top: el.y * z + v.y,
      width: Math.max(40, el.width - CODE_DOTS_WIDTH * 2) * z,
      height: height * z,
      fontSize: 12 * z,
      // The card's own surface, so the title beneath doesn't show through the input.
      background: view?.background ?? null,
      color: view?.header.color ?? null,
    };
  });

  protected onFileNameKeydown(event: KeyboardEvent, id: string): void {
    const input = event.target as HTMLInputElement;
    if (event.key === 'Enter') {
      event.preventDefault();
      input.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      // Revert so the blur below commits nothing.
      input.value = this.store.elements().find((e) => e.id === id)?.fileName ?? '';
      input.blur();
    }
    event.stopPropagation();
  }

  protected commitFileName(id: string, value: string): void {
    this.codeActions.fileNameEditId.set(null);
    void this.codeActions.setFileName(id, value);
  }

  /** Screen-space placement + value for the inline text editor overlay. */
  protected readonly textEditor = computed(() => {
    const id = this.editingTextId();
    if (!id) {
      return null;
    }
    const el = this.store.elements().find((e) => e.id === id);
    const editable =
      el &&
      (el.type === 'text' ||
        el.type === 'code' ||
        el.type === 'frame' ||
        el.type === 'rectangle' ||
        el.type === 'ellipse' ||
        el.type === 'diamond' ||
        el.type === 'arrow' ||
        el.type === 'line');
    if (!el || !editable) {
      return null;
    }
    const v = this.store.viewport();
    const z = v.zoom;
    if (el.type === 'frame') {
      // The frame's name is edited in place on the strip above its top-left corner.
      return {
        id,
        left: el.x * z + v.x,
        top: (el.y - FRAME_TITLE_H) * z + v.y,
        width: FRAME_TITLE_W * z,
        height: FRAME_TITLE_H * z,
        fontSize: 14 * z,
        fontFamily: fontStack('normal'),
        fontWeight: 600,
        italic: false,
        value: el.text ?? '',
        color: el.strokeColor,
        align: 'left' as const,
        wrap: false,
        center: false,
        padding: 0,
        code: false,
        rich: false,
        lineHeight: null as number | null,
        padLeft: null as number | null,
      };
    }
    if (el.type === 'code') {
      // The textarea sits exactly over the card with transparent glyphs, so the
      // live-highlighted SVG beneath shows through while the caret and selection stay native.
      const fontSize = el.fontSize ?? CODE_FONT_SIZE;
      const m = codeLayoutMetrics(fontSize, codeLineCount(el.text ?? ''));
      // The file-name title bar (if any) sits above the editable code area.
      const header = codeHeaderHeight(fontSize);
      return {
        id,
        left: el.x * z + v.x,
        top: (el.y + header) * z + v.y,
        width: el.width * z,
        height: (el.height - header) * z,
        fontSize: fontSize * z,
        fontFamily: fontStack('code'),
        fontWeight: 400,
        italic: false,
        value: el.text ?? '',
        color: 'transparent',
        align: 'left' as const,
        wrap: false,
        center: false,
        padding: CODE_PADDING * z,
        code: true,
        rich: false,
        lineHeight: m.lineHeight * z,
        padLeft: m.textOffset * z,
      };
    }
    const isLabel = el.type !== 'text';
    const fontSize = el.fontSize ?? (isLabel ? 16 : DEFAULT_FONT_SIZE);
    const text = el.text ?? '';
    // Height of the text content itself (so a label's editor can be centered in
    // its shape); a text element's own box is already fit to its content.
    const lh = el.lineHeight ?? DEFAULT_LINE_HEIGHT;
    const contentHeight = Math.max(1, text.split('\n').length) * fontSize * lh;
    // The editor overlays the text exactly, sized and styled to match the
    // rendered glyphs so it reads as true WYSIWYG — no overlay surface and no
    // second copy of the text behind it. A shape label centers over its shape; a
    // text element sits at its own top-left (auto-sized, or fixed-width + wrap).
    return {
      id,
      left: (isLabel ? el.x + el.width / 2 : el.x) * z + v.x,
      top: (isLabel ? el.y + el.height / 2 : el.y) * z + v.y,
      width: Math.max(el.width, 8) * z,
      height: (isLabel ? contentHeight : Math.max(el.height, fontSize)) * z,
      fontSize: fontSize * z,
      fontFamily: fontStack(el.fontFamily),
      fontWeight: el.bold ? 800 : fontWeightFor(el.strokeWidth),
      italic: !!el.italic,
      value: text,
      color: el.strokeColor,
      align: isLabel ? 'center' : (el.textAlign ?? 'left'),
      wrap: isLabel || (el.type === 'text' && !!el.wrap),
      center: isLabel,
      padding: (isLabel ? 8 : 2) * z,
      code: false,
      rich: el.type === 'text',
      lineHeight: fontSize * z * lh,
      padLeft: null as number | null,
    };
  });

  /** Id of a just-created code card, discarded if it is left empty. */
  private freshCodeId: string | null = null;
  /** The language new code blocks start with: that of the most recent code block. */
  private lastCodeLanguage(): CodeLanguage {
    const els = this.store.elements();
    for (let i = els.length - 1; i >= 0; i -= 1) {
      if (els[i].type === 'code' && els[i].language) {
        return els[i].language as CodeLanguage;
      }
    }
    return 'typescript';
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
    () => !!(this.linkSourceColumnId() || this.relinkState() || this.activeSegment()),
  );

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
    const center = loc.table.x + tableWidth(loc.table) / 2;
    const side: Side = cursor.x >= center ? 'right' : 'left';
    const a = columnAnchor(loc.table, loc.index, side);
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

  private mode: DragMode = 'idle';
  private spaceDown = false;
  private marqueeAdditive = false;
  private startClientX = 0;
  private startClientY = 0;
  private startViewportX = 0;
  private startViewportY = 0;
  private dragTableId: string | null = null;
  /** World-space point a shape draw started from (the corner, or the center with Alt). */
  private drawAnchor = { x: 0, y: 0 };
  private lastDrawPointer = { x: 0, y: 0 };
  /** In-app clipboard for copy/paste of tables and canvas elements. */
  private clipboard: {
    tables: TableModel[];
    elements: CanvasElementModel[];
    diagramIds: string[];
    /** The first copied frame, so pasted slides land on free canvas. */
    frame: CanvasElementModel | null;
  } | null = null;
  private pasteCount = 0;
  /** True once the current drag has switched to dragging Alt-made copies. */
  private dragCopied = false;
  /** Pointer was released while Alt-drag copies were still being created. */
  private releasedWhileDuplicating = false;
  private lastPointer: PointerEvent | null = null;
  /** Live Shift state, so a move drag can lock to an axis without a pointer move. */
  private shiftHeld = false;
  private multiDragStart = new Map<string, { x: number; y: number }>();
  // Manual routes touching the dragged tables. `both` true when both endpoints
  // move together (rigid translate). Otherwise only one end moves: the waypoint
  // nearest that anchor follows it vertically (so the closest vertical run
  // shrinks) while its x is absorbed by the horizontal run. `sourceMoved` picks
  // which end (first vs last waypoint) is the one being dragged.
  private waypointDragStart = new Map<
    string,
    { wp: Point[]; both: boolean; sourceMoved: boolean }
  >();

  private lastCursorSent = 0;

  constructor() {
    // Initialise the contenteditable once per editing session (the DOM owns the
    // content while typing, so it is never re-rendered from the store).
    effect(() => {
      const ref = this.richEditorRef();
      untracked(() => {
        if (ref && ref.nativeElement !== this.richInitFor) {
          this.richInitFor = ref.nativeElement;
          this.initRichEditor(ref.nativeElement);
        } else if (!ref && this.richInitFor) {
          this.teardownRichEditor();
        }
      });
    });
    this.destroyRef.onDestroy(() => this.teardownRichEditor());
    // Slides are locked together: moving one moves all of them (once the move settles).
    effect((onCleanup) => {
      this.store.slideFrames();
      const timer = setTimeout(() => this.syncSlideMoves(), 160);
      onCleanup(() => clearTimeout(timer));
    });
    // A presentation stays selected as a whole only while its shown slide alone is selected.
    effect(() => {
      const ids = this.store.selectedElementIds();
      const tables = this.store.selectedTableIds();
      const diagrams = this.store.selectedDiagramIds();
      const shown = this.store.shownByPresentation();
      untracked(() => {
        const set = this.selectedSlideSet();
        if (
          set &&
          (ids.length !== 1 || ids[0] !== shown.get(set) || tables.length || diagrams.length)
        ) {
          this.selectedSlideSet.set(null);
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
      const timer = setTimeout(() => void this.adoptIntoShownSlide(), 350);
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
        () =>
          void this.stackLegacySlides().then(() => this.separateStackedPresentations()),
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
    // Join / re-join the realtime room whenever the loaded project changes.
    effect(() => {
      const id = this.store.projectId();
      if (id) {
        this.realtime.connect(id);
      }
    });
    // Track the canvas size for the minimap's viewport rectangle.
    effect((onCleanup) => {
      const el = this.canvasRef().nativeElement;
      const update = (): void =>
        this.canvasSize.set({ width: el.clientWidth, height: el.clientHeight });
      update();
      const ro = new ResizeObserver(update);
      ro.observe(el);
      onCleanup(() => ro.disconnect());
    });
    // Broadcast this participant's selection so others see what is being edited.
    effect(() => {
      const tableIds = this.store.selectedTableIds();
      const relationshipIds = this.store.selectedRelationshipIds();
      this.realtime.sendSelection(tableIds, relationshipIds);
    });
    this.destroyRef.onDestroy(() => this.realtime.disconnect());
    // Expose Export/Share to the global top bar while this editor is mounted.
    this.editorActions.register({
      share: () => this.openShare(),
      exportSql: () => this.openSqlExport(),
      exportImage: (format) => void this.onExportImage(format),
      exportFramesPdf: () => void this.exportAllFramesPdf(),
      exportSlidesPdf: () => void this.exportAllSlidesPdf(),
      exportSelectionFile: () => this.exportSelectionFile(),
      importFile: (file) => this.importProjectFile(file),
      deleteSelection: () => this.deleteSelection(),
    });
    this.destroyRef.onDestroy(() => this.editorActions.clear());
    // SQL needs unique table names within the exported scope (selection or whole diagram).
    effect(() => {
      const selected = this.store.selectedTableIds();
      const tables = this.store.tables();
      const scope = selected.length ? tables.filter((t) => selected.includes(t.id)) : tables;
      const names = scope.map((t) => t.name.trim().toLowerCase());
      this.editorActions.hasTableSelection.set(selected.length > 0);
      this.editorActions.canExportSql.set(new Set(names).size === names.length);
    });
    // The export menu offers the selected presentation's slides, and plain frames apart from them.
    effect(() => {
      this.editorActions.presentationName.set(this.store.presentation());
      this.editorActions.hasPlainFrames.set(
        this.store.elements().some((e) => e.type === 'frame' && !e.slide),
      );
    });
    effect(() => {
      this.editorActions.hasSelection.set(
        this.store.selectedTableIds().length > 0 ||
          this.store.selectedElementIds().length > 0 ||
          this.store.selectedMessageIds().length > 0 ||
          this.store.selectedLifelineIds().length > 0 ||
          this.store.selectedDiagramIds().length > 0,
      );
    });
    // Persist the side-panel collapse state across refreshes.
    effect(() => {
      const collapsed = this.sidePanelCollapsed();
      try {
        globalThis.localStorage?.setItem(SIDE_PANEL_KEY, collapsed ? '1' : '0');
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
    if (!this.realtime.connected()) {
      return;
    }
    const now = Date.now();
    if (now - this.lastCursorSent < 40) {
      return;
    }
    this.lastCursorSent = now;
    const world = this.toWorld(event.clientX, event.clientY);
    this.realtime.sendCursor(world.x, world.y);
  }

  private canvasRect(): DOMRect {
    return this.canvasRef().nativeElement.getBoundingClientRect();
  }

  private toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvasRect();
    const v = this.store.viewport();
    return { x: (clientX - rect.left - v.x) / v.zoom, y: (clientY - rect.top - v.y) / v.zoom };
  }

  /** Public screen→world mapping for the sequence layer's drag-connect. */
  protected readonly toWorldPoint = (clientX: number, clientY: number): { x: number; y: number } =>
    this.toWorld(clientX, clientY);

  /** Snap a world coordinate to the grid when grid-snap is enabled, else pass through. */
  protected readonly snapWorld = (n: number): number => (this.gridSnap() ? snapToGrid(n) : n);

  private screenPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvasRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  private static additive(event: {
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  }): boolean {
    return event.ctrlKey || event.metaKey || event.shiftKey;
  }

  // --- canvas pointer (pan / marquee) ---

  protected onCanvasPointerDown(event: PointerEvent): void {
    if (
      event.button === 1 ||
      (event.button === 0 && (this.spaceDown || this.activeTool() === 'hand'))
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
    if (
      tool !== 'select' &&
      tool !== 'hand' &&
      tool !== 'laser' &&
      this.store.canEdit() &&
      this.store.projectId()
    ) {
      event.preventDefault();
      if (tool === 'table') {
        this.addTableAt(event.clientX, event.clientY);
        this.activeTool.set('select');
        return;
      }
      if (tool === 'sequence') {
        this.addSequenceAt(event.clientX, event.clientY);
        this.activeTool.set('select');
        return;
      }
      if (tool === 'slide') {
        // A click adds a slide: the first where you click, later ones stacked on the shown one.
        void this.addSlide(this.toWorld(event.clientX, event.clientY));
        this.activeTool.set('select');
        return;
      }
      this.beginDraw(tool, event);
      return;
    }
    this.marqueeAdditive = EditorComponent.additive(event);
    if (!this.marqueeAdditive) {
      this.store.clearSelection();
    }
    const p = this.screenPoint(event.clientX, event.clientY);
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
    const world = this.toWorld(event.clientX, event.clientY);
    this.laserPointerId = null;
    this.laser.release(LOCAL_LASER);
    this.realtime.sendLaser(world.x, world.y, true);
  }

  private addLaserSample(event: PointerEvent, force: boolean): void {
    const world = this.toWorld(event.clientX, event.clientY);
    this.laser.add(LOCAL_LASER, world.x, world.y);
    const now = Date.now();
    if (!force && now - this.lastLaserSent < 33) {
      return;
    }
    this.lastLaserSent = now;
    if (this.realtime.connected()) {
      this.realtime.sendLaser(world.x, world.y);
    }
  }

  // --- drawing new elements ---

  /** Default stroke color for new elements: the theme's text color, so it reads on either theme. */
  private defaultStroke(): string {
    try {
      const c = getComputedStyle(this.canvasRef().nativeElement)
        .getPropertyValue('--dbd-text')
        .trim();
      return c || DEFAULT_ELEMENT_STROKE;
    } catch {
      return DEFAULT_ELEMENT_STROKE;
    }
  }

  /** Read a theme CSS custom property from the canvas, or null if unavailable. */
  private themeVar(name: string): string | null {
    try {
      return getComputedStyle(this.canvasRef().nativeElement).getPropertyValue(name).trim() || null;
    } catch {
      return null;
    }
  }

  /** Add an ERD table centered near the given screen point. */
  private addTableAt(clientX: number, clientY: number): void {
    const world = this.toWorld(clientX, clientY);
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
    const world = this.toWorld(clientX, clientY);
    let x = Math.round(world.x);
    let y = Math.round(world.y);
    if (this.gridSnap()) {
      x = snapToGrid(x);
      y = snapToGrid(y);
    }
    void this.store.addSequenceStarter(x, y);
  }

  /** Start drawing an element of the active tool at the pointer. */
  private beginDraw(
    tool: Exclude<EditorTool, 'select' | 'hand' | 'table' | 'sequence' | 'laser' | 'slide'>,
    event: PointerEvent,
  ): void {
    const world = this.toWorld(event.clientX, event.clientY);
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
              this.themeVar('--dbd-border-strong') ??
              this.themeVar('--dbd-text-muted') ??
              sticky.strokeColor,
            backgroundColor: undefined,
            fillStyle: 'none' as const,
            strokeWidth: 1,
            strokeStyle: 'solid' as const,
            opacity: 100,
            cornerRadius: 8,
            fontFamily: 'code',
            fontSize: CODE_FONT_SIZE,
          }
        : type === 'frame'
          ? {
              ...sticky,
              strokeColor: this.themeVar('--dbd-text-muted') ?? sticky.strokeColor,
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
      strokeWidth: style.strokeWidth,
      strokeStyle: style.strokeStyle,
      opacity: style.opacity,
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
      ...(type === 'code'
        ? {
            text: '',
            fontSize: CODE_FONT_SIZE,
            fontFamily: 'code',
            language: this.lastCodeLanguage(),
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

  private updateDraw(clientX: number, clientY: number, shift: boolean, alt: boolean): void {
    const draft = this.draft();
    if (!draft) {
      return;
    }
    this.lastDrawPointer = { x: clientX, y: clientY };
    const world = this.toWorld(clientX, clientY);
    const snap = this.gridSnap();
    if (draft.type === 'freedraw') {
      const pt = toRelative(draft, world);
      this.draft.set({ ...draft, points: [...(draft.points ?? []), pt] });
      return;
    }
    if (draft.type === 'line' || draft.type === 'arrow') {
      const end = {
        x: (snap ? snapToGrid(world.x) : world.x) - draft.x,
        y: (snap ? snapToGrid(world.y) : world.y) - draft.y,
      };
      this.draft.set({ ...draft, points: [{ x: 0, y: 0 }, end] });
      // Highlight the shape/table the free end would bind to.
      this.bindHighlight.set(this.bindingTargetAt(world, draft.id)?.box ?? null);
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
    if (!draft) {
      return;
    }
    const dto = this.draftToDto(draft);
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
    if (!isPen) {
      this.activeTool.set('select');
      if (created && selectAfter && created.type === 'text') {
        this.editingTextId.set(created.id);
      }
      if (created && created.type === 'code') {
        // A fresh code card opens straight into its editor; an untouched one is discarded on exit.
        this.freshCodeId = created.id;
        this.editingTextId.set(created.id);
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
      fontSize: draft.fontSize,
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
    const world = this.toWorld(event.clientX, event.clientY);
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
    this.selectedSlideSet.set(null);
    const clicked = this.store.elements().find((e) => e.id === payload.id);
    if (!clicked) {
      return;
    }
    const el = this.pickInnermostAt(clicked, payload.event);
    if (EditorComponent.additive(payload.event)) {
      this.store.selectElement(el.id, true);
      return;
    }
    if (!this.store.selectedElementIds().includes(el.id)) {
      this.store.selectElement(el.id, false);
    }
    if (!this.store.canEdit()) {
      return;
    }
    this.startClientX = payload.event.clientX;
    this.startClientY = payload.event.clientY;
    this.gestureActive.set(true);
    this.dragCopied = false;
    this.beginElementDrag(el);
    if (payload.event.altKey) {
      void this.duplicateAndDrag();
    }
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
    extra?: { tableIds: ReadonlySet<string>; diagramIds: ReadonlySet<string> },
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
          this.store.shownSlideIds(),
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
            rel.waypoints.map((w) => ({ ...w })),
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
        .map((t) => [t.id, { x: t.x, y: t.y }]),
    );
    g.sequences = new Map(
      diagramIds
        .map((id) => [id, this.sequenceStart(id)] as const)
        .filter((e): e is readonly [string, SequenceStart] => !!e[1]),
    );
  }

  /** A sequence diagram's current layout, captured so it can be shifted rigidly. */
  private sequenceStart(diagramId: string): SequenceStart | null {
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
          .map((l) => [l.id, l.x]),
      ),
      originY: d.originY,
      rows: new Map(
        this.store
          .sequenceMessages()
          .filter((m) => m.diagramId === diagramId)
          .map((m) => [m.id, rowOf(m.y)]),
      ),
    };
  }

  protected onElementResizeDown(payload: ResizeDownEvent): void {
    const el = this.store.elements().find((e) => e.id === payload.id);
    if (!el || !this.store.canEdit()) {
      return;
    }
    this.mode = 'element-resize';
    this.gestureActive.set(true);
    this.startClientX = payload.event.clientX;
    this.startClientY = payload.event.clientY;
    this.elementGesture = {
      id: el.id,
      handle: payload.handle,
      start: { x: el.x, y: el.y, width: el.width, height: el.height, angle: el.angle },
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
    const world = this.toWorld(clientX, clientY);
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
    const moves: { id: string; from: { x: number; y: number }; to: { x: number; y: number } }[] =
      [];
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
    const moves: { id: string; from: { x: number; y: number }; to: { x: number; y: number } }[] =
      [];
    for (const [id, from] of ex.elements) {
      const el = this.store.elements().find((e) => e.id === id);
      if (el && (el.x !== from.x || el.y !== from.y)) {
        moves.push({ id, from, to: { x: el.x, y: el.y } });
      }
    }
    this.store.recordElementMove(moves);
    this.persistSequences(ex.sequences.keys());
  }

  /** Shift elements/diagrams riding with a grabbed table by that table's net displacement. */
  private moveNodeExtras(): void {
    const ex = this.nodeExtras;
    const grabbed = this.dragTableId;
    if (!ex || !grabbed) {
      return;
    }
    const start = this.multiDragStart.get(grabbed);
    const table = this.store.tables().find((t) => t.id === grabbed);
    if (!start || !table) {
      return;
    }
    const mx = table.x - start.x;
    const my = table.y - start.y;
    for (const [id, p] of ex.elements) {
      this.store.moveElement(id, p.x + mx, p.y + my);
    }
    for (const [id, seq] of ex.sequences) {
      this.store.shiftSequence(id, seq.xs, mx, seq.originY, my, seq.rows);
    }
  }

  private moveElements(clientX: number, clientY: number): void {
    const g = this.elementGesture;
    if (!g?.others) {
      return;
    }
    const { dx, dy } = this.dragDelta(clientX, clientY);
    const snap = this.gridSnap();
    for (const [id, start] of g.others) {
      const nx = snap ? snapToGrid(start.x + dx) : Math.round(start.x + dx);
      const ny = snap ? snapToGrid(start.y + dy) : Math.round(start.y + dy);
      this.store.moveElement(id, nx, ny);
    }
    // Carry a frame's tables with it by the same (snapped) displacement as the frame.
    const grabbed = g.others.get(g.id);
    if (grabbed && (g.tables?.size || g.waypoints?.size || g.sequences?.size)) {
      const el = this.store.elements().find((e) => e.id === g.id);
      const mx = el ? el.x - grabbed.x : 0;
      const my = el ? el.y - grabbed.y : 0;
      for (const [id, start] of g.tables ?? []) {
        this.store.moveTable(id, start.x + mx, start.y + my);
      }
      for (const [relId, wp] of g.waypoints ?? []) {
        this.store.setWaypoints(
          relId,
          wp.map((w) => ({ x: Math.round(w.x + mx), y: Math.round(w.y + my) })),
        );
      }
      for (const [id, seq] of g.sequences ?? []) {
        this.store.shiftSequence(id, seq.xs, mx, seq.originY, my, seq.rows);
      }
    }
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
    const zoom = this.store.viewport().zoom;
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
      if (this.gridSnap()) {
        // Snap one dimension and derive the other so the ratio survives snapping.
        scale = Math.max(minScale, snapToGrid(s.width * scale) / s.width);
      }
      width = s.width * scale;
      height = s.height * scale;
    } else {
      // A slide frame is never shorter than the panels pinned to it.
      const minH = this.store.slideFrames().some((f) => f.id === g.id)
        ? EditorComponent.PANEL_MIN_H
        : 8;
      width = Math.max(8, s.width + grow);
      height = Math.max(minH, s.height + growY);
      if (this.gridSnap()) {
        width = Math.max(8, snapToGrid(width));
        height = Math.max(minH, snapToGrid(height));
      }
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

    this.store.patchElementLocal(g.id, { x, y, width, height });
  }

  private rotateElement(ev: PointerEvent): void {
    const g = this.elementGesture;
    if (!g) {
      return;
    }
    const cx = g.start.x + g.start.width / 2;
    const cy = g.start.y + g.start.height / 2;
    const world = this.toWorld(ev.clientX, ev.clientY);
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
    const world = this.toWorld(clientX, clientY);
    const target = this.bindingTargetAt(world, g.id);
    this.bindHighlight.set(target?.box ?? null);
    const binding = target?.binding ?? null;
    const pts = g.points.map((p) => ({ ...p }));
    const idx = g.which === 'start' ? 0 : pts.length - 1;
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
    excludeElementId: string,
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
      if (
        el.id === excludeElementId ||
        el.type === 'line' ||
        el.type === 'arrow' ||
        el.type === 'frame'
      ) {
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
        },
        {
          x: el.x,
          y: el.y,
          width: el.width,
          height: el.height,
          ...(scaled ? { fontSize: el.fontSize, wrap: el.wrap ?? false } : {}),
        },
      );
    } else if (this.mode === 'element-rotate') {
      void this.store.commitElementGeometry(g.id, { angle: snap.angle }, { angle: el.angle });
    } else if (this.mode === 'arrow-bend') {
      void this.store.commitElementGeometry(
        g.id,
        { curvature: snap.curvature ?? 0 },
        { curvature: el.curvature ?? 0 },
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
        },
      );
    }
  }

  // --- inline text editing ---

  protected onTextInput(value: string): void {
    const id = this.editingTextId();
    const el = id ? this.store.elements().find((e) => e.id === id) : null;
    if (!id || !el) {
      return;
    }
    if (el.type === 'code') {
      // The card grows to fit what is typed but never shrinks under a manual resize.
      const size = codeContentSize(value, el.fontSize ?? CODE_FONT_SIZE, codeTitle(el));
      this.store.patchElementLocal(id, {
        text: value,
        width: Math.max(el.width, size.width),
        height: Math.max(el.height, size.height),
      });
      return;
    }
    if (el.type !== 'text') {
      // Shape label: just update text; the shape box does not resize.
      this.store.patchElementLocal(id, { text: value });
      return;
    }
    // Auto-size (grow) while typing; once resized, keep the width and wrap.
    const size = this.fitTextSize(el, value);
    this.store.patchElementLocal(id, { text: value, width: size.width, height: size.height });
  }

  /** The box a text element takes for `value`: always hugging its content, never wrapped. */
  private fitTextSize(el: CanvasElementModel, value: string): { width: number; height: number } {
    return fitTextElement(el, { text: value });
  }

  /**
   * Keys inside the inline editor. Esc leaves edit mode (for every element). In a
   * code block, Tab indents (Shift+Tab outdents the line), and Enter keeps the
   * current line's indent, adding one more level after an opening bracket.
   */
  protected onEditorKeydown(event: KeyboardEvent): void {
    const area = event.target as HTMLTextAreaElement;
    if (event.key === 'Escape') {
      event.preventDefault();
      area.blur();
      return;
    }
    const id = this.editingTextId();
    const el = id ? this.store.elements().find((e) => e.id === id) : null;
    if (el?.type !== 'code' || event.isComposing) {
      return;
    }
    const insert = (text: string): void => {
      // execCommand keeps the browser's native undo stack; fall back to a manual splice.
      if (!document.execCommand('insertText', false, text)) {
        area.setRangeText(text, area.selectionStart, area.selectionEnd, 'end');
        area.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };
    const indent = ' '.repeat(TAB_SIZE);
    if (event.shiftKey && event.altKey && event.key.toLowerCase() === 'f') {
      // Format in place through the textarea so the edit stays one undo step.
      event.preventDefault();
      void formatCode(area.value, el.language, codePrintWidth(el))
        .then((formatted) => {
          if (formatted === area.value) {
            return;
          }
          area.select();
          insert(formatted);
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : 'Could not format the code.';
          this.snackBar.open(`Couldn't format: ${message}`, undefined, { duration: 4000 });
        });
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const { value, selectionStart: start, selectionEnd: end } = area;
      const multi = value.slice(start, end).includes('\n');
      if (!event.shiftKey && !multi) {
        insert(indent);
        return;
      }
      // Indent/outdent every line the selection touches.
      const from = value.lastIndexOf('\n', start - 1) + 1;
      const block = value.slice(from, end);
      const changed = block
        .split('\n')
        .map((line) =>
          event.shiftKey
            ? line.replace(new RegExp(`^(?: {1,${TAB_SIZE}}|\\t)`), '')
            : indent + line,
        )
        .join('\n');
      area.setSelectionRange(from, end);
      insert(changed);
      area.setSelectionRange(from, from + changed.length);
      return;
    }
    if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const { value, selectionStart: start } = area;
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const lead = /^[ \t]*/.exec(value.slice(lineStart, start))?.[0] ?? '';
      const opens = /[{[(]$/.test(value.slice(lineStart, start).trimEnd());
      insert(`\n${lead}${opens ? indent : ''}`);
    }
  }

  // --- rich text editing (contenteditable) ---

  private readonly richEditorRef = viewChild<ElementRef<HTMLDivElement>>('richEditor');
  private readonly richSession = inject(RichTextSessionService);
  /** The editor host the current session was initialised for. */
  private richInitFor: HTMLDivElement | null = null;
  /** Selection (character offsets) last seen inside the rich editor. */
  private richSel = { start: 0, end: 0 };
  private richCleanup: (() => void) | null = null;

  /** Paint runs into the editor host as inline-styled spans. */
  private renderRichRuns(root: HTMLElement, runs: readonly TextRun[]): void {
    root.textContent = '';
    for (const run of runs) {
      if (!run.text) {
        continue;
      }
      const span = document.createElement('span');
      span.textContent = run.text;
      if (run.bold !== undefined) {
        span.style.fontWeight = run.bold ? '700' : '400';
      }
      if (run.italic !== undefined) {
        span.style.fontStyle = run.italic ? 'italic' : 'normal';
      }
      if (run.underline) {
        span.style.textDecoration = 'underline';
      }
      if (run.color) {
        span.style.color = run.color;
        span.dataset['color'] = run.color;
      }
      if (run.morph) {
        span.dataset['morph'] = run.morph;
      }
      root.appendChild(span);
    }
    if (plainOf(runs).endsWith('\n')) {
      // A trailing newline needs a placeholder so the empty last line is visible.
      root.appendChild(document.createElement('br'));
    }
  }

  /** Read the editor host back into runs (tolerant of browser-inserted markup). */
  private readRichRuns(root: HTMLElement): TextRun[] {
    const out: TextRun[] = [];
    const push = (text: string, style: Partial<TextRun>): void => {
      if (text) {
        out.push({ text, ...style });
      }
    };
    const styleOf = (el: HTMLElement, parent: Partial<TextRun>): Partial<TextRun> => {
      const s: Partial<TextRun> = { ...parent };
      const fw = el.style.fontWeight;
      if (fw) {
        s.bold = fw === 'bold' || fw === 'bolder' || Number.parseInt(fw, 10) >= 600;
      } else if (el.tagName === 'B' || el.tagName === 'STRONG') {
        s.bold = true;
      }
      if (el.style.fontStyle) {
        s.italic = el.style.fontStyle === 'italic';
      } else if (el.tagName === 'I' || el.tagName === 'EM') {
        s.italic = true;
      }
      const deco = el.style.textDecorationLine || el.style.textDecoration;
      if (deco.includes('underline') || el.tagName === 'U') {
        s.underline = true;
      }
      const color = el.dataset['color'] ?? el.style.color;
      if (color) {
        s.color = color;
      }
      if (el.dataset['morph']) {
        s.morph = el.dataset['morph'];
      }
      return s;
    };
    const lastLeaf = (n: Node): Node => (n.lastChild ? lastLeaf(n.lastChild) : n);
    const last = lastLeaf(root);
    const isBlock = (n: Node): boolean =>
      n instanceof HTMLElement && (n.tagName === 'DIV' || n.tagName === 'P');
    const walk = (node: Node, style: Partial<TextRun>): void => {
      node.childNodes.forEach((child, index) => {
        if (child.nodeType === Node.TEXT_NODE) {
          push(child.nodeValue ?? '', style);
        } else if (child instanceof HTMLElement) {
          if (child.tagName === 'BR') {
            // The trailing <br> is only a placeholder for the last empty line, and
            // a lone <br> inside a block is that block's own empty line.
            const placeholder = isBlock(node) && node.childNodes.length === 1;
            if (child !== last && !placeholder) {
              push('\n', style);
            }
            return;
          }
          if (isBlock(child) && (out.length || index > 0)) {
            push('\n', style);
          }
          walk(child, styleOf(child, style));
        }
      });
    };
    walk(root, {});
    return normalizeRuns(out);
  }

  private richOffset(root: HTMLElement, node: Node, offset: number): number {
    const range = document.createRange();
    range.selectNodeContents(root);
    range.setEnd(node, offset);
    return range.toString().length;
  }

  private setRichSelection(root: HTMLElement, start: number, end: number): void {
    const locate = (target: number): { node: Node; offset: number } => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let seen = 0;
      let lastNode: Text | null = null;
      for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
        const len = n.nodeValue?.length ?? 0;
        if (target <= seen + len) {
          return { node: n, offset: target - seen };
        }
        seen += len;
        lastNode = n;
      }
      return lastNode
        ? { node: lastNode, offset: lastNode.nodeValue?.length ?? 0 }
        : { node: root, offset: 0 };
    };
    const a = locate(start);
    const b = locate(end);
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  private richBase(el: CanvasElementModel): RunBase {
    return {
      bold: !!el.bold,
      italic: !!el.italic,
      underline: false,
      color: el.strokeColor,
    };
  }

  private publishRichSelection(runs?: TextRun[]): void {
    const root = this.richEditorRef()?.nativeElement;
    const id = this.editingTextId();
    const el = id ? this.store.elements().find((e) => e.id === id) : null;
    if (!root || !el) {
      return;
    }
    const { start, end } = this.richSel;
    const current = runs ?? this.readRichRuns(root);
    const style = styleOver(current, Math.min(start, end), Math.max(start, end), this.richBase(el));
    this.richSession.selection.set({
      ...style,
      hasRange: start !== end,
      list: listKindOver(plainOf(current), start, end),
    });
  }

  /** Show a list edit's runs in the editor, keeping the (remapped) selection. */
  private commitListResult(root: HTMLElement, res: ListResult): void {
    const { start, end } = this.richSel;
    const total = plainOf(res.runs).length;
    this.renderRichRuns(root, res.runs);
    root.focus();
    this.setRichSelection(root, Math.min(res.map(start), total), Math.min(res.map(end), total));
    this.captureRichSelection(root);
    this.syncRichModel(res.runs);
    this.publishRichSelection(res.runs);
  }

  /** Toolbar / shortcut: toggle a bulleted or numbered list on the selected lines. */
  private toggleRichList(kind: ListKind): void {
    const root = this.richEditorRef()?.nativeElement;
    if (!root) {
      return;
    }
    this.captureRichSelection(root);
    const { start, end } = this.richSel;
    this.commitListResult(root, toggleList(this.readRichRuns(root), start, end, kind));
  }

  /** Push the editor's runs into the store (live) with the refit box. */
  private syncRichModel(runs: TextRun[]): void {
    const id = this.editingTextId();
    const el = id ? this.store.elements().find((e) => e.id === id) : null;
    if (!id || !el) {
      return;
    }
    const text = plainOf(runs);
    const stored = isPlainRuns(runs) ? undefined : runs;
    const size = fitTextElement(el, { text, runs: stored ?? null });
    this.store.patchElementLocal(id, { text, runs: stored, width: size.width, height: size.height });
  }

  protected onRichInput(event?: Event): void {
    const root = this.richEditorRef()?.nativeElement;
    if (!root) {
      return;
    }
    const runs = this.readRichRuns(root);
    this.captureRichSelection(root);
    // Keep list numbering/bullets right after deletes and pastes (not mid-composition).
    const fixed = (event as InputEvent | undefined)?.isComposing ? null : normalizeLists(runs);
    if (fixed) {
      this.commitListResult(root, fixed);
      return;
    }
    this.syncRichModel(runs);
    this.captureRichSelection(root);
    this.publishRichSelection(runs);
  }

  private captureRichSelection(root: HTMLElement): void {
    const sel = window.getSelection();
    if (!sel?.rangeCount || !root.contains(sel.anchorNode)) {
      return;
    }
    const r = sel.getRangeAt(0);
    this.richSel = {
      start: this.richOffset(root, r.startContainer, r.startOffset),
      end: this.richOffset(root, r.endContainer, r.endOffset),
    };
  }

  /** Style the selected characters, or the whole block when nothing is selected. */
  private applyRichPatch(patch: RunPatch): void {
    const root = this.richEditorRef()?.nativeElement;
    if (!root) {
      return;
    }
    const runs = this.readRichRuns(root);
    const total = plainOf(runs).length;
    const { start, end } = this.richSel;
    const from = start === end ? 0 : Math.min(start, end);
    const to = start === end ? total : Math.max(start, end);
    const next = patchRuns(runs, from, to, patch);
    this.renderRichRuns(root, next);
    root.focus();
    this.setRichSelection(root, Math.min(start, total), Math.min(end, total));
    this.syncRichModel(next);
    this.publishRichSelection(next);
  }

  private initRichEditor(root: HTMLDivElement): void {
    const id = this.editingTextId();
    const el = id ? this.store.elements().find((e) => e.id === id) : null;
    if (!id || !el || el.type !== 'text') {
      return;
    }
    const text = el.text ?? '';
    this.renderRichRuns(root, runsOrPlain(text, el.runs));
    root.focus();
    this.setRichSelection(root, text.length, text.length);
    this.richSel = { start: text.length, end: text.length };
    this.richSession.open(
      id,
      (patch) => this.applyRichPatch(patch),
      (kind) => this.toggleRichList(kind),
    );
    this.publishRichSelection();

    const onSelection = (): void => {
      if (document.activeElement === root) {
        this.captureRichSelection(root);
        this.publishRichSelection();
      }
    };
    // Toolbar buttons and their menus must not steal focus (and so the selection)
    // from the editor; sliders and text fields still need it.
    const onMouseDown = (e: MouseEvent): void => {
      const t = e.target as Element | null;
      if (
        t?.closest('app-element-floating-toolbar, .cdk-overlay-pane, .dbd-overlay-backdrop') &&
        !t.closest('input[type=range], input[type=text], input[type=number], textarea')
      ) {
        e.preventDefault();
      }
    };
    document.addEventListener('selectionchange', onSelection);
    document.addEventListener('mousedown', onMouseDown, true);
    this.richCleanup = () => {
      document.removeEventListener('selectionchange', onSelection);
      document.removeEventListener('mousedown', onMouseDown, true);
    };
  }

  private teardownRichEditor(): void {
    this.richCleanup?.();
    this.richCleanup = null;
    this.richInitFor = null;
    this.richSession.close();
  }

  protected onRichKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      (event.target as HTMLElement).blur();
      return;
    }
    const root = this.richEditorRef()?.nativeElement;
    if (root && !event.isComposing && this.onRichListKey(event, root)) {
      return;
    }
    if (event.key === 'Enter' && !event.isComposing) {
      // A plain line break keeps the content flat (no nested block elements).
      event.preventDefault();
      document.execCommand('insertLineBreak');
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
      const key = event.key.toLowerCase();
      const flag = key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'u' ? 'underline' : null;
      if (flag) {
        event.preventDefault();
        const current = this.richSession.selection();
        this.applyRichPatch({ [flag]: !(current?.[flag] ?? false) });
      }
    }
  }

  /** List behaviour of the rich editor's keys; true when the key was handled. */
  private onRichListKey(event: KeyboardEvent, root: HTMLElement): boolean {
    const mod = event.ctrlKey || event.metaKey;
    // Ctrl+Shift+7 / +8 toggle numbered / bulleted lists (as in Google Docs).
    if (mod && event.shiftKey && !event.altKey && (event.code === 'Digit7' || event.code === 'Digit8')) {
      event.preventDefault();
      this.toggleRichList(event.code === 'Digit7' ? 'number' : 'bullet');
      return true;
    }
    if (mod || event.altKey) {
      return false;
    }
    const key = event.key;
    if (key !== 'Enter' && key !== 'Backspace' && key !== 'Tab' && key !== ' ') {
      return false;
    }
    this.captureRichSelection(root);
    const { start, end } = this.richSel;
    const runs = this.readRichRuns(root);
    const collapsed = start === end;
    if (key === 'Tab') {
      event.preventDefault();
      const shifted = shiftListIndent(runs, start, end, event.shiftKey ? -1 : 1);
      if (shifted) {
        this.commitListResult(root, shifted);
      } else if (!event.shiftKey) {
        document.execCommand('insertText', false, ' '.repeat(4));
      }
      return true;
    }
    if (!collapsed || event.shiftKey) {
      return false;
    }
    if (key === 'Enter') {
      const result = listEnter(runs, start);
      if (!result) {
        return false;
      }
      event.preventDefault();
      if ('exit' in result) {
        this.commitListResult(root, result.exit);
      } else {
        // Native edits keep the browser's undo stack.
        document.execCommand('insertLineBreak');
        document.execCommand('insertText', false, result.insert.slice(1));
      }
      return true;
    }
    const result = key === 'Backspace' ? listBackspace(runs, start) : listAutoformat(runs, start);
    if (!result) {
      return false;
    }
    event.preventDefault();
    this.commitListResult(root, result);
    return true;
  }

  protected onRichPaste(event: ClipboardEvent): void {
    // Plain text only: pasted markup would drag foreign styles into the block.
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (text) {
      document.execCommand('insertText', false, text);
    }
  }

  protected onRichBlur(): void {
    // Switching windows or opening a native picker blurs the editor without leaving it.
    if (!document.hasFocus()) {
      return;
    }
    this.commitTextEdit();
  }

  protected commitTextEdit(): void {
    const id = this.editingTextId();
    this.editingTextId.set(null);
    this.teardownRichEditor();
    if (!id) {
      return;
    }
    const el = this.store.elements().find((e) => e.id === id);
    if (!el) {
      return;
    }
    const text = el.text ?? '';
    if (el.type === 'code') {
      if (text.trim() === '' && id === this.freshCodeId) {
        this.freshCodeId = null;
        void this.store.deleteElement(id);
        return;
      }
      this.freshCodeId = null;
      const size = codeContentSize(text, el.fontSize ?? CODE_FONT_SIZE, codeTitle(el));
      void this.store.updateElement(id, {
        text,
        width: Math.max(el.width, size.width),
        height: Math.max(el.height, size.height),
      });
      return;
    }
    if (el.type !== 'text') {
      // Shape label: store the (possibly empty) label without resizing the shape.
      void this.store.updateElement(id, { text });
      return;
    }
    if (text.trim() === '') {
      void this.store.deleteElement(id);
      return;
    }
    const runs = usableRuns(text, el.runs);
    const size = fitTextElement(el, { text, runs });
    void this.store.updateElement(id, {
      text,
      runs: runs ?? null,
      width: size.width,
      height: size.height,
    });
  }

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
  private async duplicateAndDrag(): Promise<void> {
    const kind = this.mode;
    if (this.dragCopied || (kind !== 'element' && kind !== 'node') || !this.store.canEdit()) {
      return;
    }
    this.dragCopied = true;
    const grabbedElement = this.elementGesture?.id ?? null;
    const grabbedTable = this.dragTableId;
    if (kind === 'element') {
      for (const [id, start] of this.elementGesture?.others ?? []) {
        this.store.moveElement(id, start.x, start.y);
      }
      for (const [id, start] of this.elementGesture?.tables ?? []) {
        this.store.moveTable(id, start.x, start.y);
      }
      for (const [relId, wp] of this.elementGesture?.waypoints ?? []) {
        this.store.setWaypoints(relId, wp);
      }
      for (const [id, seq] of this.elementGesture?.sequences ?? []) {
        this.store.shiftSequence(id, seq.xs, 0, seq.originY, 0, seq.rows);
      }
    } else {
      for (const [id, start] of this.multiDragStart) {
        this.store.moveTable(id, start.x, start.y);
      }
      for (const [relId, start] of this.waypointDragStart) {
        this.store.setWaypoints(relId, start.wp);
      }
      for (const [id, p] of this.nodeExtras?.elements ?? []) {
        this.store.moveElement(id, p.x, p.y);
      }
      for (const [id, seq] of this.nodeExtras?.sequences ?? []) {
        this.store.shiftSequence(id, seq.xs, 0, seq.originY, 0, seq.rows);
      }
    }
    this.mode = 'duplicating';
    let resume: (() => void) | null = null;
    let created: string[] = [];
    const selectedIds = this.store.selectedElementIds();
    const slideFrame =
      kind === 'element' && selectedIds.length === 1
        ? this.store.slideFrames().find((f) => f.id === selectedIds[0])
        : undefined;
    if (slideFrame) {
      // Alt-dragging a presentation's slide copies the whole presentation: every
      // slide with its contents, under a new name, dragged off as one set.
      // The original was put back above; bring its other (hidden) slides back with it
      // now, before copies exist that the catch-up could mistake for its own slides.
      this.syncSlideMoves();
      const frames = presentationSlides(this.store.slideFrames(), presentationOf(slideFrame));
      const frameIds = new Set(frames.map((f) => f.id));
      const inner = frameContents(
        frameIds,
        this.store.elements(),
        this.store.tables(),
        this.store.sequenceDiagrams(),
        this.store.lifelines(),
        this.store.sequenceMessages(),
        this.store.shownSlideIds(),
      );
      const name = this.newPresentationName();
      const sources = this.store
        .elements()
        .filter((e) => frameIds.has(e.id) || inner.elementIds.has(e.id));
      // One optimistic clone: the copies show at once and undo removes them in one step.
      const cloned = this.store.cloneItems(inner.tableIds, inner.diagramIds, sources, 0, 0, {
        presentation: name,
      });
      created = [...cloned.copies.values()].map((c) => c.id);
      const grabbed = cloned.copies.get(slideFrame.id);
      if (grabbed) {
        this.store.setActiveSlide(grabbed.id);
        resume = () => {
          this.store.setSelection([], [], [grabbed.id]);
          this.beginElementDrag(grabbed);
          this.attachCarried(
            created.filter((id) => id !== grabbed.id),
            [...cloned.tables.values()],
            [...cloned.diagrams.values()],
          );
        };
      }
    } else if (kind === 'element') {
      const selected = new Set(this.store.selectedElementIds());
      // Duplicating a frame duplicates what's inside it too (tables, sequence
      // diagrams, and elements), and the copies travel with the copied frame.
      const inner = this.carriedByFrames(selected);
      // One optimistic clone of selected + inner items: shows at once, one undo step,
      // bindings between copies remap and a copied slide's contents follow its copy.
      const sources = this.store
        .elements()
        .filter((e) => selected.has(e.id) || inner?.elements.has(e.id));
      const cloned = this.store.cloneItems(
        new Set(inner?.tables.keys() ?? []),
        new Set(inner?.sequences.keys() ?? []),
        sources,
        0,
        0,
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
          const selectedCopies = [...selected]
            .map((id) => copies.get(id)?.id)
            .filter((id): id is string => !!id);
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
        { relationshipIds: new Set(this.store.selectedRelationshipIds()) },
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
  private dragDelta(clientX: number, clientY: number): { dx: number; dy: number } {
    const zoom = this.store.viewport().zoom;
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
        .map((t) => [t.id, { x: t.x, y: t.y }]),
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
                .map((e) => [e.id, { x: e.x, y: e.y }] as const),
            ),
            sequences: new Map(
              diagramIds
                .map((id) => [id, this.sequenceStart(id)] as const)
                .filter((e): e is readonly [string, SequenceStart] => !!e[1]),
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
    const loc = this.columnLocations().get(payload.columnId);
    if (loc) {
      const a = columnAnchor(loc.table, loc.index, 'right');
      this.linkCursor.set({ x: a.x, y: a.y });
    }
  }

  protected onEndpointDown(payload: EndpointDownEvent): void {
    if (!this.store.canEdit()) {
      return;
    }
    this.linkSourceColumnId.set(null);
    this.relinkState.set({ relationshipId: payload.relationshipId, which: payload.which });
    this.linkCursor.set(this.toWorld(payload.event.clientX, payload.event.clientY));
  }

  protected onHandleUp(payload: HandleEvent): void {
    const relink = this.relinkState();
    if (relink) {
      payload.event.stopPropagation();
      const rel = this.store.relationships().find((r) => r.id === relink.relationshipId);
      const opposite = relink.which === 'source' ? rel?.targetColumnId : rel?.sourceColumnId;
      if (payload.columnId !== opposite) {
        void this.store.updateRelationship(
          relink.relationshipId,
          relink.which === 'source'
            ? { sourceColumnId: payload.columnId }
            : { targetColumnId: payload.columnId },
        );
      }
    } else {
      const sourceId = this.linkSourceColumnId();
      if (sourceId && sourceId !== payload.columnId) {
        payload.event.stopPropagation();
        void this.store.addRelationship(sourceId, payload.columnId);
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
      void this.store.updateRelationship(
        relink.relationshipId,
        relink.which === 'source'
          ? { sourceColumnId: snap.columnId }
          : { targetColumnId: snap.columnId },
      );
      return;
    }
    const sourceId = this.linkSourceColumnId();
    if (sourceId && sourceId !== snap.columnId) {
      void this.store.addRelationship(sourceId, snap.columnId);
    }
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
    this.activeSegment.set({
      relationshipId: payload.relationshipId,
      segIndex: payload.segmentIndex,
      a: { x: connector.ax, y: connector.ay },
      b: { x: connector.bx, y: connector.by },
      route: connector.routePoints,
    });
  }

  protected onResetRoute(relationshipId: string): void {
    if (this.store.canEdit()) {
      this.store.setWaypoints(relationshipId, []);
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
    const cursor = this.toWorld(clientX, clientY);
    const waypoints = segmentDrag(active.a, active.b, active.route, active.segIndex, cursor);
    this.store.setWaypoints(active.relationshipId, waypoints);
  }

  // --- global pointer + keyboard ---

  @HostListener('window:pointermove', ['$event'])
  protected onPointerMove(event: PointerEvent): void {
    this.lastPointer = event;
    this.shiftHeld = event.shiftKey;
    this.handlePointerMove(event);
  }

  private handlePointerMove(event: PointerEvent): void {
    if (this.mode === 'duplicating') {
      return; // copies are still being created; the drag resumes from lastPointer
    }
    this.broadcastCursor(event);
    if (this.linkSourceColumnId() || this.relinkState()) {
      this.linkCursor.set(this.toWorld(event.clientX, event.clientY));
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
    if (this.mode === 'element') {
      this.moveElements(event.clientX, event.clientY);
      return;
    }
    if (this.mode === 'element-resize') {
      this.resizeElement(event);
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
      const { dx, dy } = this.dragDelta(event.clientX, event.clientY);
      const snap = this.gridSnap();
      for (const [id, start] of this.multiDragStart) {
        const nx = snap ? snapToGrid(start.x + dx) : Math.round(start.x + dx);
        const ny = snap ? snapToGrid(start.y + dy) : Math.round(start.y + dy);
        this.store.moveTable(id, nx, ny);
      }
      this.moveNodeExtras();
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
          this.store.setWaypoints(
            relId,
            start.wp.map((w) => ({ x: Math.round(w.x + dx), y: Math.round(w.y + dy) })),
          );
          continue;
        }
        const near = start.sourceMoved ? 0 : start.wp.length - 1;
        this.store.setWaypoints(
          relId,
          start.wp.map((w, i) => ({
            x: Math.round(w.x),
            y: Math.round(i === near ? w.y + dy : w.y),
          })),
        );
      }
    } else if (this.mode === 'marquee') {
      this.marqueeCurrent.set(this.screenPoint(event.clientX, event.clientY));
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
    if (this.mode === 'marquee') {
      this.commitMarquee();
    } else if (this.mode === 'draw') {
      void this.commitDraft(false);
    } else if (this.mode === 'element') {
      this.recordMoveGesture();
    } else if (this.mode === 'node') {
      this.settleNodeExtras();
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
    this.bindHighlight.set(null);
    this.multiDragStart.clear();
    this.waypointDragStart.clear();
    this.marqueeStart.set(null);
    this.marqueeCurrent.set(null);
    this.activeSegment.set(null);
    this.clearLinking();
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

    const tableIds = this.visibleTables()
      .filter((t) => this.boxIntersects(t, rect))
      .map((t) => t.id);
    const relIds = this.connectors()
      .filter(
        (con) =>
          con.mx >= rect.minX && con.mx <= rect.maxX && con.my >= rect.minY && con.my <= rect.maxY,
      )
      .map((con) => con.id);
    const elementIds = this.shownElements()
      .filter((e) => elementIntersectsRect(e, rect))
      .map((e) => e.id);

    const messageIds = this.messagesInRect(rect);
    const lifelineIds = this.store
      .lifelines()
      .filter((l) => {
        const d = this.store.sequenceDiagrams().find((x) => x.id === l.diagramId);
        if (!d) return false;
        const left = l.x - l.width / 2;
        return (
          left <= rect.maxX &&
          left + l.width >= rect.minX &&
          d.originY <= rect.maxY &&
          d.originY + d.headerHeight >= rect.minY
        );
      })
      .map((l) => l.id);

    const diagramIds = this.diagramsInRect(rect);
    // A diagram swept up whole is selected as a unit; its parts needn't be listed too.
    const hit = new Set(diagramIds);
    const looseMessages = messageIds.filter(
      (id) => !hit.has(this.store.sequenceMessages().find((m) => m.id === id)?.diagramId ?? ''),
    );
    const looseLifelines = lifelineIds.filter(
      (id) => !hit.has(this.store.lifelines().find((l) => l.id === id)?.diagramId ?? ''),
    );

    if (this.marqueeAdditive) {
      const nextTables = new Set([...this.store.selectedTableIds(), ...tableIds]);
      const nextRels = new Set([...this.store.selectedRelationshipIds(), ...relIds]);
      const nextEls = new Set([...this.store.selectedElementIds(), ...elementIds]);
      const nextMsgs = new Set([...this.store.selectedMessageIds(), ...looseMessages]);
      const nextLls = new Set([...this.store.selectedLifelineIds(), ...looseLifelines]);
      const nextDiagrams = new Set([...this.store.selectedDiagramIds(), ...diagramIds]);
      this.store.setSelection(
        [...nextTables],
        [...nextRels],
        [...nextEls],
        [...nextMsgs],
        [...nextLls],
        [...nextDiagrams],
      );
    } else {
      this.store.setSelection(
        tableIds,
        relIds,
        elementIds,
        looseMessages,
        looseLifelines,
        diagramIds,
      );
    }
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
  private diagramBox(d: SequenceDiagramModel): Rect | null {
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
      if (
        b &&
        b.minX >= rect.minX &&
        b.maxX <= rect.maxX &&
        b.minY >= rect.minY &&
        b.maxY <= rect.maxY
      ) {
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

  @HostListener('window:keydown', ['$event'])
  protected onKeyDown(event: KeyboardEvent): void {
    if (this.presentation()) {
      // The presenter owns the keyboard; nothing behind it may react.
      return;
    }
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    const typing =
      tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;
    if (typing) {
      return;
    }
    if (event.key === 'F5') {
      // Only with a presentation selected; otherwise the browser's reload runs as usual.
      const name = this.selectedPresentationName();
      if (name) {
        // Present from the beginning; Shift+F5 from the current slide (as in PowerPoint).
        event.preventDefault();
        this.store.selectPresentation(name);
        void this.startPresentation(event.shiftKey ? 'current' : 'start');
      }
      return;
    }
    if (event.key === ' ') {
      this.spaceDown = true;
      event.preventDefault();
      return;
    }
    if (event.key === 'Home') {
      this.resetView();
      event.preventDefault();
      return;
    }
    if (event.key === 'Escape') {
      this.activeTool.set('select');
      return;
    }
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === 'z') {
      if (this.store.canEdit()) {
        event.preventDefault();
        if (event.shiftKey) {
          this.store.redoElement();
        } else {
          this.store.undoElement();
        }
      }
      return;
    }
    if (mod && event.key.toLowerCase() === 'y') {
      if (this.store.canEdit()) {
        event.preventDefault();
        this.store.redoElement();
      }
      return;
    }
    if (mod && (event.code === 'BracketLeft' || event.code === 'BracketRight')) {
      // Ctrl+[ / ] steps the selection back / forward one layer; Shift goes all the way.
      event.preventDefault();
      if (this.store.canEdit()) {
        const forward = event.code === 'BracketRight';
        this.store.arrangeSelection(
          event.shiftKey ? (forward ? 'front' : 'back') : forward ? 'forward' : 'backward',
        );
      }
      return;
    }
    if (mod && event.key.toLowerCase() === 'g') {
      // Group / ungroup the selection (also stops the browser's find-next).
      event.preventDefault();
      if (this.store.canEdit()) {
        if (event.shiftKey) {
          void this.store.ungroupSelection();
        } else {
          void this.store.groupSelection();
        }
      }
      return;
    }
    if (mod && event.key.toLowerCase() === 'c') {
      this.copySelection();
      return;
    }
    if (mod && event.key.toLowerCase() === 'v') {
      // Handled by the window `paste` event, which also sees system-clipboard images.
      return;
    }
    // Shift/Alt pressed or released mid-draw re-applies the constraint immediately.
    if (event.key === 'Alt' && (this.mode === 'element' || this.mode === 'node')) {
      event.preventDefault();
      void this.duplicateAndDrag();
      return;
    }
    if (event.key === 'Shift' && (this.mode === 'element' || this.mode === 'node')) {
      this.shiftHeld = true;
      if (this.lastPointer) {
        this.handlePointerMove(this.lastPointer);
      }
      return;
    }
    if (this.mode === 'draw' && (event.key === 'Shift' || event.key === 'Alt')) {
      event.preventDefault(); // keep Alt from focusing the browser menu
      this.updateDraw(
        this.lastDrawPointer.x,
        this.lastDrawPointer.y,
        event.key === 'Shift' ? true : event.shiftKey,
        event.key === 'Alt' ? true : event.altKey,
      );
      return;
    }
    const tool = mod ? undefined : EditorComponent.TOOL_SHORTCUTS[event.key.toLowerCase()];
    // The laser pointer is a presenting tool, so view-only guests may use it too.
    if (tool && (this.store.canEdit() || tool === 'laser')) {
      this.activeTool.set(tool);
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.store.canEdit()) {
      const set = this.selectedSlideSet();
      if (set) {
        event.preventDefault();
        this.selectedSlideSet.set(null);
        this.onSlidesCommand({ kind: 'deletePresentation' }, set);
        return;
      }
      const relIds = [...this.store.selectedRelationshipIds()];
      const tableIds = [...this.store.selectedTableIds()];
      const elementIds = [...this.store.selectedElementIds()];
      const lifelineIds = [...this.store.selectedLifelineIds()];
      const messageIds = [...this.store.selectedMessageIds()];
      const diagramId = this.store.selectedDiagramIds().length > 0;
      if (
        relIds.length ||
        tableIds.length ||
        elementIds.length ||
        lifelineIds.length ||
        messageIds.length ||
        diagramId
      ) {
        event.preventDefault();
        this.deleteSelection();
      }
    }
  }

  /**
   * Delete everything selected. Deleting a frame also deletes what sits inside it
   * (elements, tables and sequence diagrams), so a frame removes its whole page.
   */
  private deleteSelection(): void {
    if (!this.store.canEdit()) {
      return;
    }
    const relIds = [...this.store.selectedRelationshipIds()];
    const tableIds = new Set(this.store.selectedTableIds());
    const elementIds = new Set(this.store.selectedElementIds());
    const lifelineIds = [...this.store.selectedLifelineIds()];
    const messageIds = [...this.store.selectedMessageIds()];
    const diagramIds = new Set<string>();
    this.store.selectedDiagramIds().forEach((id) => diagramIds.add(id));
    const inner = frameContents(
      elementIds,
      this.store.elements(),
      this.store.tables(),
      this.store.sequenceDiagrams(),
      this.store.lifelines(),
      this.store.sequenceMessages(),
      this.store.shownSlideIds(),
    );
    inner.elementIds.forEach((id) => elementIds.add(id));
    inner.tableIds.forEach((id) => tableIds.add(id));
    inner.diagramIds.forEach((id) => diagramIds.add(id));

    void this.store.batchHistory(() => {
      const jobs: unknown[] = [];
      relIds.forEach((id) => jobs.push(this.store.deleteRelationship(id)));
      tableIds.forEach((id) => jobs.push(this.store.deleteTable(id)));
      elementIds.forEach((id) => jobs.push(this.store.deleteElement(id)));
      diagramIds.forEach((id) => jobs.push(this.store.deleteSequence(id)));
      if (!diagramIds.size) {
        messageIds.forEach((id) => jobs.push(this.store.deleteMessage(id)));
        lifelineIds.forEach((id) => jobs.push(this.store.deleteLifeline(id)));
      }
      return Promise.all(jobs);
    });
  }

  // --- slides / presentation mode ---

  protected onSlidesCommand(cmd: SlidesCommand, presentation: string): void {
    // Everything below acts on the selected presentation: the one whose panel was used.
    this.store.selectPresentation(presentation);
    switch (cmd.kind) {
      case 'close':
        this.store.setSelection([], [], []);
        break;
      case 'fold':
        this.settingsFolded.update((v) => !v);
        break;
      case 'present':
        void this.startPresentation(cmd.from);
        break;
      case 'preview':
        void this.previewTransition(cmd.id);
        break;
      case 'focus':
        this.focusFrame(cmd.id);
        break;
      case 'add':
        void this.addSlide();
        break;
      case 'deletePresentation': {
        const ids = presentationSlides(this.store.slideFrames(), presentation).map((f) => f.id);
        if (ids.length) {
          this.store.setSelection([], [], ids);
          this.deleteSelection();
        }
        break;
      }
      case 'duplicate':
        void this.duplicateSlide(cmd.id, cmd.toIndex);
        break;
      case 'delete':
        this.store.setSelection([], [], [cmd.id]);
        this.deleteSelection();
        break;
    }
  }

  /** Watch another participant's presentation, staying on their slide and step. */
  protected async followPresenter(participantId: string): Promise<void> {
    const p = this.realtime.participants().find((x) => x.id === participantId);
    // Watch the presentation the presenter is in (the one their slide belongs to).
    const theirs = this.store.slideFrames().find((f) => f.id === p?.presenting?.frameId);
    const slides = (
      theirs ? presentationSlides(this.store.slideFrames(), presentationOf(theirs)) : this.store.presentationFrames()
    ).filter((f) => !f.slide?.hidden);
    if (!slides.length) {
      return;
    }
    const start = Math.max(
      0,
      slides.findIndex((f) => f.id === p?.presenting?.frameId),
    );
    const rendered = await this.slideRender.render(slides);
    this.presentation.set({ slides: rendered, start, preview: false, follow: participantId });
  }

  private migratingSlides = false;
  /** Project whose misplaced slides stackLegacySlides already gathered (once per load). */
  private misplacedCheckedFor: string | null = null;
  /** Where each slide frame was last seen, to notice which one the user moved. */
  private slideBounds = new Map<string, { x: number; y: number; w: number; h: number }>();

  /**
   * Slides are stacked in one spot and stay that way: when one slide frame is moved
   * (same size, new position) every other slide, with its contents, moves by the
   * same amount. Skipped when several moved at once (a remote peer already did it).
   */
  private syncSlideMoves(): void {
    const all = this.store.slideFrames();
    const prev = this.slideBounds;
    this.slideBounds = new Map(
      all.map((f) => [f.id, { x: f.x, y: f.y, w: f.width, h: f.height }]),
    );
    if (!this.store.canEdit() || this.migratingSlides) {
      return;
    }
    // Each presentation is locked together on its own: its slides share a spot and a size.
    for (const name of this.store.presentations()) {
      const frames = presentationSlides(all, name);
      const known = frames.filter((f) => prev.has(f.id));
      if (known.length === 0) {
        // First sight of this presentation: bring slides that differ to the first one's size.
        const first = frames[0];
        for (const f of frames.slice(1)) {
          if (first && (f.width !== first.width || f.height !== first.height)) {
            void this.store.patchElementSilently(f.id, {
              x: first.x,
              y: first.y,
              width: first.width,
              height: first.height,
            });
            this.slideBounds.set(f.id, { x: first.x, y: first.y, w: first.width, h: first.height });
          }
        }
        continue;
      }
      // Every slide has the same size: resizing one resizes them all.
      const resized = frames.filter((f) => {
        const p = prev.get(f.id);
        return !!p && (p.w !== f.width || p.h !== f.height);
      });
      if (resized.length === 1) {
        const r = resized[0];
        for (const other of frames) {
          if (other.id === r.id) {
            continue;
          }
          void this.store.patchElementSilently(other.id, {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
          });
          this.slideBounds.set(other.id, { x: r.x, y: r.y, w: r.width, h: r.height });
        }
        continue;
      }
      const moved = frames.filter((f) => {
        const p = prev.get(f.id);
        return !!p && p.w === f.width && p.h === f.height && (p.x !== f.x || p.y !== f.y);
      });
      if (moved.length !== 1) {
        continue;
      }
      const m = moved[0];
      const p = prev.get(m.id)!;
      const dx = m.x - p.x;
      const dy = m.y - p.y;
      for (const other of frames) {
        if (other.id === m.id) {
          continue;
        }
        this.shiftSlide(other.id, dx, dy);
        const b = this.slideBounds.get(other.id);
        if (b) {
          this.slideBounds.set(other.id, { ...b, x: b.x + dx, y: b.y + dy });
        }
      }
    }
  }

  /** Content lying inside a shown slide's frame that belongs to no slide joins it. */
  private async adoptIntoShownSlide(): Promise<void> {
    if (!this.store.canEdit() || this.migratingSlides || this.presentation()) {
      return;
    }
    const shown = this.store.shownSlideIds();
    for (const active of this.store.slideFrames().filter((f) => shown.has(f.id))) {
      await this.adoptInto(active);
    }
  }

  private async adoptInto(active: CanvasElementModel): Promise<void> {
    const inside = (cx: number, cy: number): boolean =>
      cx >= active.x && cx <= active.x + active.width && cy >= active.y && cy <= active.y + active.height;
    const elements = this.store
      .elements()
      .filter((e) => {
        if (e.type === 'frame' || e.slideId) {
          return false;
        }
        const b = elementBox(e);
        return inside((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
      })
      .map((e) => e.id);
    const tables = this.store
      .tables()
      .filter((t) => {
        if (t.slideId) {
          return false;
        }
        const b = tableBox(t);
        return inside((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
      })
      .map((t) => t.id);
    const diagrams = this.store
      .sequenceDiagrams()
      .filter((d) => {
        if (d.slideId) {
          return false;
        }
        const b = sequenceDiagramBox(d, this.store.lifelines(), this.store.sequenceMessages());
        return !!b && inside((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
      })
      .map((d) => d.id);
    if (elements.length || tables.length || diagrams.length) {
      await this.store.assignSlide({ elements, tables, diagrams }, active.id);
    }

    // The other way round: what the shown slide owns but now lies wholly outside its
    // frame (cloned or dragged out) belongs to the normal canvas, whatever slide is shown.
    const apart = (b: { x0: number; y0: number; x1: number; y1: number }): boolean =>
      b.x1 < active.x ||
      b.x0 > active.x + active.width ||
      b.y1 < active.y ||
      b.y0 > active.y + active.height;
    const freeElements = this.store
      .elements()
      .filter((e) => e.type !== 'frame' && e.slideId === active.id && apart(elementBox(e)))
      .map((e) => e.id);
    const freeTables = this.store
      .tables()
      .filter((t) => t.slideId === active.id && apart(tableBox(t)))
      .map((t) => t.id);
    const freeDiagrams = this.store
      .sequenceDiagrams()
      .filter((d) => {
        if (d.slideId !== active.id) {
          return false;
        }
        const b = sequenceDiagramBox(d, this.store.lifelines(), this.store.sequenceMessages());
        return !!b && apart(b);
      })
      .map((d) => d.id);
    if (freeElements.length || freeTables.length || freeDiagrams.length) {
      await this.store.assignSlide(
        { elements: freeElements, tables: freeTables, diagrams: freeDiagrams },
        null,
      );
    }
  }

  /** Move a slide's frame and everything it owns by (dx, dy), without undo entries. */
  private shiftSlide(frameId: string, dx: number, dy: number): void {
    const frame = this.store.elements().find((e) => e.id === frameId);
    if (frame) {
      this.store.moveElement(frameId, frame.x + dx, frame.y + dy);
    }
    for (const e of this.store.elements()) {
      if (e.slideId === frameId) {
        this.store.moveElement(e.id, e.x + dx, e.y + dy);
      }
    }
    const tableIds = new Set<string>();
    for (const t of this.store.tables()) {
      if (t.slideId === frameId) {
        tableIds.add(t.id);
        this.store.moveTable(t.id, t.x + dx, t.y + dy);
      }
    }
    for (const rel of this.store.relationships()) {
      if (!rel.waypoints?.length) {
        continue;
      }
      const locs = this.columnLocations();
      const st = locs.get(rel.sourceColumnId)?.table.id;
      const tt = locs.get(rel.targetColumnId)?.table.id;
      if (st && tt && tableIds.has(st) && tableIds.has(tt)) {
        this.store.setWaypoints(
          rel.id,
          rel.waypoints.map((w) => ({ x: w.x + dx, y: w.y + dy })),
        );
      }
    }
    for (const d of this.store.sequenceDiagrams()) {
      if (d.slideId !== frameId) {
        continue;
      }
      // Move the whole diagram locally in one step (originY included) before saving:
      // originY only lands after the server answers, so shifting lifelines/messages
      // and originY separately let a second shift read a stale originY and tear the
      // header away from its messages.
      const start = this.sequenceStart(d.id);
      if (!start) {
        continue;
      }
      this.store.shiftSequence(d.id, start.xs, dx, start.originY, dy, start.rows);
      for (const l of this.store.lifelines()) {
        if (l.diagramId === d.id) {
          this.store.moveLifeline(l.id, l.x);
        }
      }
      for (const msg of this.store.sequenceMessages()) {
        if (msg.diagramId === d.id) {
          this.store.moveMessage(msg.id, msg.y);
        }
      }
      void this.store.updateSequenceConfig(d.id, { originY: start.originY + dy });
    }
  }

  /**
   * Slides used to sit side by side on the canvas. They are now stacked in one spot
   * and own their contents by id, so a slide that owns nothing yet claims what lies
   * inside its frame and moves (with it) onto the first slide's spot. Runs once per
   * such slide; an empty or already-owning slide is left alone.
   */
  private async stackLegacySlides(): Promise<void> {
    if (this.migratingSlides || !this.store.canEdit() || !this.store.projectId()) {
      return;
    }
    const frames = this.store.slideFrames();
    if (frames.length === 0) {
      return;
    }
    // A presentation's slides gather on its first slide's spot.
    const anchors = new Map<string, CanvasElementModel>();
    for (const f of frames) {
      if (!anchors.has(presentationOf(f))) {
        anchors.set(presentationOf(f), f);
      }
    }
    const elements = this.store.elements();
    // A frame is never the content of a slide; undo an earlier mistaken claim.
    const claimedFrames = elements.filter((e) => e.type === 'frame' && e.slideId);
    const tables = this.store.tables();
    const diagrams = this.store.sequenceDiagrams();
    const owns = (id: string): boolean =>
      elements.some((e) => e.slideId === id) ||
      tables.some((t) => t.slideId === id) ||
      diagrams.some((d) => d.slideId === id);
    // A slide that already owns content but sits away from its presentation's spot (a
    // file or tool laid the slides out side by side) moves back, taking its contents.
    // Checked once per loaded project only: this runs on every edit, and mid-drag the
    // dragged slide is briefly away from the others until syncSlideMoves catches them
    // up; snapping it back then fought the drag and double-shifted slide contents.
    const checkMisplaced = this.misplacedCheckedFor !== this.store.projectId();
    this.misplacedCheckedFor = this.store.projectId();
    const misplaced = !checkMisplaced ? [] : frames.filter((f) => {
      const anchor = anchors.get(presentationOf(f))!;
      return owns(f.id) && (f.x !== anchor.x || f.y !== anchor.y);
    });
    // Only slides still sitting elsewhere (saved side by side) are legacy: a slide on
    // the shared spot gets its content through adoption of the shown slide instead.
    const work = frames
      .filter((f) => {
        const anchor = anchors.get(presentationOf(f))!;
        return !owns(f.id) && (f.x !== anchor.x || f.y !== anchor.y);
      })
      .map((f) => {
        const anchor = anchors.get(presentationOf(f))!;
        const asPlain = elements.map((e) => (e.id === f.id ? { ...e, slide: undefined } : e));
        const geo = frameContents(
          new Set([f.id]),
          asPlain,
          tables,
          diagrams,
          this.store.lifelines(),
          this.store.sequenceMessages(),
          null,
        );
        for (const id of [...geo.elementIds]) {
          if (elements.find((e) => e.id === id)?.type === 'frame') {
            geo.elementIds.delete(id);
          }
        }
        return { f, geo, dx: anchor.x - f.x, dy: anchor.y - f.y };
      })
      // Only slides with something to claim; an empty slide is left where it is (the
      // move lock keeps it with the others from then on).
      .filter((w) => w.geo.elementIds.size || w.geo.tableIds.size || w.geo.diagramIds.size);
    if (!work.length && !claimedFrames.length && !misplaced.length) {
      return;
    }
    this.migratingSlides = true;
    try {
      await this.store.batchHistory(async () => {
        for (const f of misplaced) {
          const anchor = anchors.get(presentationOf(f))!;
          this.shiftSlide(f.id, anchor.x - f.x, anchor.y - f.y);
        }
        for (const fr of claimedFrames) {
          await this.store.updateElement(fr.id, { slideId: null });
        }
        for (const { f, geo, dx, dy } of work) {
          const moved = dx !== 0 || dy !== 0;
          if (moved) {
            await this.store.updateElement(f.id, { x: f.x + dx, y: f.y + dy });
          }
          for (const id of geo.elementIds) {
            const e = this.store.elements().find((x) => x.id === id);
            if (e) {
              await this.store.updateElement(id, {
                slideId: f.id,
                ...(moved ? { x: e.x + dx, y: e.y + dy } : {}),
              });
            }
          }
          for (const id of geo.tableIds) {
            const t = this.store.tables().find((x) => x.id === id);
            if (t) {
              await this.store.updateTable(id, { slideId: f.id });
              if (moved) {
                this.store.moveTable(id, t.x + dx, t.y + dy);
              }
            }
          }
          for (const id of geo.diagramIds) {
            const start = this.sequenceStart(id);
            await this.store.updateSequenceConfig(id, { slideId: f.id });
            if (start && moved) {
              this.store.shiftSequence(id, start.xs, dx, start.originY, dy, start.rows);
              await this.store.updateSequenceConfig(id, { originY: start.originY + dy });
              for (const [lifelineId, x] of start.xs) {
                this.store.moveLifeline(lifelineId, x + dx);
              }
            }
          }
          if (moved) {
            for (const rel of this.store.relationships()) {
              if (rel.waypoints?.length) {
                const locs = this.columnLocations();
                const st = locs.get(rel.sourceColumnId)?.table.id;
                const tt = locs.get(rel.targetColumnId)?.table.id;
                if (st && tt && geo.tableIds.has(st) && geo.tableIds.has(tt)) {
                  this.store.setWaypoints(
                    rel.id,
                    rel.waypoints.map((w) => ({ x: w.x + dx, y: w.y + dy })),
                  );
                }
              }
            }
          }
        }
      });
    } finally {
      this.migratingSlides = false;
      this.slideBounds = new Map(
        this.store
          .slideFrames()
          .map((f) => [f.id, { x: f.x, y: f.y, w: f.width, h: f.height }]),
      );
    }
  }

  /**
   * Presentations used to share one spot. Each presentation now has its own set of
   * panels, so one that sits exactly on top of an earlier presentation moves down
   * (with its slides and their contents) to free canvas.
   */
  private separateStackedPresentations(): void {
    if (this.migratingSlides || !this.store.canEdit() || !this.store.projectId()) {
      return;
    }
    const frames = this.store.slideFrames();
    const placed: Array<{ x: number; y: number }> = [];
    for (const name of this.store.presentations()) {
      const slides = presentationSlides(frames, name);
      const first = slides[0];
      if (!first) {
        continue;
      }
      let dy = 0;
      while (placed.some((p) => p.x === first.x && p.y === first.y + dy)) {
        dy += first.height + 200;
      }
      placed.push({ x: first.x, y: first.y + dy });
      if (dy === 0) {
        continue;
      }
      for (const f of slides) {
        this.shiftSlide(f.id, 0, dy);
        this.slideBounds.set(f.id, { x: f.x, y: f.y + dy, w: f.width, h: f.height });
      }
    }
  }

  /**
   * Show a slide. Slides are stacked in one spot per presentation and only the shown
   * one is on the canvas, so switching just changes what is drawn there: the view never moves.
   */
  private focusFrame(id: string): void {
    if (!this.store.elements().some((e) => e.id === id)) {
      return;
    }
    this.store.setActiveSlide(id);
    this.store.setSelection([], [], [id]);
  }

  /** Leave the presenter, selecting the slide it was on (not for one-transition previews). */
  protected onPresentationClosed(frameId: string | null): void {
    const preview = this.presentation()?.preview;
    this.presentation.set(null);
    if (!preview && frameId) {
      this.focusFrame(frameId);
      // Center it once fullscreen has been left, so the canvas has its real size again.
      const reveal = (): void => {
        const f = this.store.elements().find((e) => e.id === frameId);
        if (f) {
          this.panToWorld({ x: f.x + f.width / 2, y: f.y + f.height / 2 });
        }
      };
      if (document.fullscreenElement) {
        document.addEventListener('fullscreenchange', () => requestAnimationFrame(reveal), { once: true });
      } else {
        reveal();
      }
    }
  }

  /** The slide the view is on: the selected slide, else the one under the view center. */
  private currentSlideIndex(): number {
    const frames = this.store.presentationFrames();
    return Math.max(
      0,
      frames.findIndex((f) => f.id === this.activeSlideId()),
    );
  }

  /**
   * The presentation the canvas selection belongs to: a selected slide frame, or an
   * item on a slide. Null when nothing of any presentation is selected.
   */
  private selectedPresentationName(): string | null {
    const frames = this.store.slideFrames();
    const owner = (slideId: string | undefined): string | null => {
      const f = slideId ? frames.find((x) => x.id === slideId) : undefined;
      return f ? presentationOf(f) : null;
    };
    for (const id of this.store.selectedElementIds()) {
      const e = this.store.elements().find((x) => x.id === id);
      const name = e?.type === 'frame' && e.slide ? presentationOf(e) : owner(e?.slideId);
      if (name) {
        return name;
      }
    }
    for (const id of this.store.selectedTableIds()) {
      const name = owner(this.store.tables().find((t) => t.id === id)?.slideId);
      if (name) {
        return name;
      }
    }
    for (const id of this.store.selectedDiagramIds()) {
      const name = owner(this.store.sequenceDiagrams().find((d) => d.id === id)?.slideId);
      if (name) {
        return name;
      }
    }
    return null;
  }

  /** Render the sequence and open the full-screen presenter. */
  private async startPresentation(from: 'start' | 'current'): Promise<void> {
    // Only the selected presentation plays (F5 from its start, Shift+F5 from the shown slide).
    const all = this.store.presentationFrames();
    const slides = all.filter((f) => !f.slide?.hidden);
    if (!slides.length) {
      this.snackBar.open('No slides yet. Open Slides and add a frame to the sequence.', undefined, {
        duration: 3000,
      });
      return;
    }
    let start = 0;
    if (from === 'current') {
      const here = all[this.currentSlideIndex()];
      start = Math.max(
        0,
        slides.findIndex((f) => f.id === here?.id),
      );
    }
    try {
      const rendered = await this.slideRender.render(slides);
      this.presentation.set({ slides: rendered, start, preview: false, follow: null });
    } catch (err) {
      this.snackBar.open(
        `Could not start the presentation: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        { duration: 4000 },
      );
    }
  }

  /** Play the transition into a slide from the one before it, without presenting. */
  private async previewTransition(id: string): Promise<void> {
    const frames = this.store.presentationFrames();
    const i = frames.findIndex((f) => f.id === id);
    if (i <= 0) {
      this.snackBar.open('The first slide has no transition into it.', undefined, {
        duration: 2500,
      });
      return;
    }
    const rendered = await this.slideRender.render([frames[i - 1], frames[i]]);
    this.presentation.set({ slides: rendered, start: 0, preview: true, follow: null });
  }

  /** The first free "Presentation N" name. */
  private newPresentationName(): string {
    const taken = new Set(this.store.presentations());
    let n = 1;
    while (taken.has(`Presentation ${n}`)) {
      n += 1;
    }
    return `Presentation ${n}`;
  }

  /**
   * Add a slide. With `at` (the Slide tool) it starts a whole new presentation there:
   * a first 16:9 slide with its own list and settings panels. Without it, the new slide
   * joins the selected presentation, stacked on the one it shows.
   */
  private async addSlide(at?: { x: number; y: number }): Promise<void> {
    if (!this.store.canEdit()) {
      return;
    }
    const preset = framePreset('16-9');
    const newPresentation = at ? this.newPresentationName() : undefined;
    const slides = newPresentation ? [] : this.store.presentationFrames();
    const presentation = newPresentation ?? this.store.presentation() ?? undefined;
    const shown = newPresentation
      ? undefined
      : this.store.slideFrames().find((f) => f.id === this.activeSlideId());
    let x: number;
    let y: number;
    if (shown) {
      // Slides are stacked: a new one takes the shown slide's place (and size).
      x = shown.x;
      y = shown.y;
    } else {
      const rect = this.canvasRect();
      const c = at ?? this.toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
      x = Math.round(c.x - preset.width / 2);
      y = Math.round(c.y - preset.height / 2);
    }
    // Insert right after the selected slide of this presentation; append when none is.
    const after = newPresentation
      ? undefined
      : slides.find((f) => f.id === this.activeSlideId());
    let order = slides.reduce((m, f) => Math.max(m, f.slide?.order ?? 0), -1) + 1;
    let shifted: CanvasElementModel[] = [];
    if (after) {
      const afterOrder = after.slide?.order ?? 0;
      order = afterOrder + 1;
      shifted = slides.filter((f) => f.id !== after.id && (f.slide?.order ?? 0) > afterOrder);
    }
    for (const f of shifted) {
      if (f.slide) {
        await this.store.updateElement(f.id, { slide: { ...f.slide, order: f.slide.order + 1 } });
      }
    }
    const created = await this.store.addElement({
      type: 'frame',
      x,
      y,
      width: shown?.width ?? preset.width,
      height: shown?.height ?? preset.height,
      angle: 0,
      strokeColor: this.themeVar('--dbd-text-muted') ?? DEFAULT_ELEMENT_STROKE,
      fillStyle: 'none',
      strokeWidth: 1.5,
      strokeStyle: 'solid',
      opacity: 100,
      cornerRadius: 0,
      slide: presentation ? { order, presentation } : { order },
    });
    if (created) {
      this.focusFrame(created.id);
    }
  }

  /**
   * Horizontal offset that puts a copy of `frame` on free canvas: `step` page
   * widths to the right, pushed further right while it would land on another frame.
   */
  private freeFrameOffset(frame: CanvasElementModel, step = 1): number {
    const frames = this.store.elements().filter((e) => e.type === 'frame');
    let dx = (frame.width + 160) * step;
    for (let i = 0; i < 40; i += 1) {
      const clash = frames.some(
        (f) =>
          f.id !== frame.id &&
          frame.x + dx < f.x + f.width &&
          frame.x + dx + frame.width > f.x &&
          frame.y < f.y + f.height &&
          frame.y + frame.height > f.y,
      );
      if (!clash) {
        break;
      }
      dx += frame.width + 160;
    }
    return dx;
  }

  /**
   * Clone tables (plus the relationships between them), sequence diagrams and
   * elements by (dx, dy). Callers wrap this in `batchHistory` for one undo step.
   */
  private async cloneItems(
    tableIds: ReadonlySet<string>,
    diagramIds: ReadonlySet<string>,
    elements: readonly CanvasElementModel[],
    dx: number,
    dy: number,
  ): Promise<{ copies: Map<string, CanvasElementModel>; tableIds: string[]; diagramIds: string[] }> {
    const cloned = this.store.cloneItems(tableIds, diagramIds, elements, dx, dy);
    return {
      copies: cloned.copies,
      tableIds: [...cloned.tables.values()],
      diagramIds: [...cloned.diagrams.values()],
    };
  }

  /**
   * Duplicate a slide with everything on it, beside the original. The copy lands
   * right after it in the sequence, or at `toIndex` when given (Alt-drag in the panel).
   */
  private async duplicateSlide(id: string, toIndex?: number): Promise<void> {
    const frame = this.store.elements().find((e) => e.id === id);
    if (!frame || !this.store.canEdit()) {
      return;
    }
    // Slides are stacked in one spot, so a copy sits exactly on its source.
    const dx = 0;
    const inner = frameContents(
      new Set([id]),
      this.store.elements(),
      this.store.tables(),
      this.store.sequenceDiagrams(),
      this.store.lifelines(),
      this.store.sequenceMessages(),
      this.store.shownSlideIds(),
    );
    let newId: string | null = null;
    await this.store.batchHistory(async () => {
      const sources = this.store
        .elements()
        .filter((e) => e.id === id || inner.elementIds.has(e.id));
      const cloned = await this.cloneItems(inner.tableIds, inner.diagramIds, sources, dx, 0);
      newId = cloned.copies.get(id)?.id ?? null;
      if (newId && toIndex !== undefined) {
        const others = this.store.presentationFrames().filter((f) => f.id !== newId);
        const lo = others[toIndex - 1]?.slide?.order;
        const hi = others[toIndex]?.slide?.order;
        const order =
          lo === undefined ? (hi ?? 0) - 1 : hi === undefined ? lo + 1 : (lo + hi) / 2;
        const copy = this.store.elements().find((e) => e.id === newId);
        if (copy?.slide) {
          await this.store.updateElement(newId, { slide: { ...copy.slide, order } });
        }
      }
    });
    if (newId) {
      this.focusFrame(newId);
    }
  }

  /** Single-key tool shortcuts (Excalidraw-style). */
  private static readonly TOOL_SHORTCUTS: Record<string, EditorTool> = {
    v: 'select',
    h: 'hand',
    e: 'table',
    r: 'rectangle',
    o: 'ellipse',
    d: 'diamond',
    a: 'arrow',
    l: 'line',
    t: 'text',
    p: 'freedraw',
    f: 'frame',
    s: 'slide',
    c: 'code',
    k: 'laser',
  };

  protected onToolChange(tool: EditorTool): void {
    this.activeTool.set(tool);
  }

  @HostListener('window:keyup', ['$event'])
  protected onKeyUp(event: KeyboardEvent): void {
    if (event.key === ' ') {
      this.spaceDown = false;
    }
    if (event.key === 'Shift') {
      this.shiftHeld = false;
      if ((this.mode === 'element' || this.mode === 'node') && this.lastPointer) {
        this.handlePointerMove(this.lastPointer);
      }
    }
    if (this.mode === 'draw' && (event.key === 'Shift' || event.key === 'Alt')) {
      this.updateDraw(
        this.lastDrawPointer.x,
        this.lastDrawPointer.y,
        event.key === 'Shift' ? false : event.shiftKey,
        event.key === 'Alt' ? false : event.altKey,
      );
    }
  }

  // --- copy / paste ---

  /** Ctrl/Cmd+V: a system-clipboard picture becomes an image element, else the in-app clipboard pastes. */
  @HostListener('window:paste', ['$event'])
  protected onPaste(event: ClipboardEvent): void {
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
      return;
    }
    if (!this.store.canEdit()) {
      return;
    }
    const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
      f.type.startsWith('image/'),
    );
    if (files.length) {
      event.preventDefault();
      void this.insertImages(files);
      return;
    }
    if (this.clipboard) {
      event.preventDefault();
      void this.pasteClipboard();
    }
  }

  // --- images ---

  private readonly images = inject(ElementImagesService);

  /** Toolbar "Image": pick one or more files and drop them at the center of the view. */
  protected pickImages(): void {
    if (!this.store.canEdit() || !this.store.projectId()) {
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,.svg';
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      if (files.length) {
        void this.insertImages(files);
      }
    };
    input.click();
  }

  protected onCanvasDragOver(event: DragEvent): void {
    if (this.store.canEdit() && event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  protected onCanvasDrop(event: DragEvent): void {
    const files = Array.from(event.dataTransfer?.files ?? []).filter(
      (f) => f.type.startsWith('image/') || /\.svg$/i.test(f.name),
    );
    if (!files.length) {
      return;
    }
    event.preventDefault();
    if (this.store.canEdit()) {
      void this.insertImages(files, this.toWorld(event.clientX, event.clientY));
    }
  }

  /**
   * Upload image files and add each as an image element, centered on `at` (or the
   * middle of the view) and staggered so several don't stack exactly. Large
   * pictures are scaled down to a comfortable on-canvas size, keeping proportions.
   */
  private async insertImages(files: File[], at?: { x: number; y: number }): Promise<void> {
    const projectId = this.store.projectId();
    if (!projectId || !this.store.canEdit()) {
      return;
    }
    const rect = this.canvasRect();
    const v = this.store.viewport();
    const center = at ?? {
      x: (rect.width / 2 - v.x) / v.zoom,
      y: (rect.height / 2 - v.y) / v.zoom,
    };
    const maxSide = 400;
    let index = 0;
    for (const file of files) {
      try {
        // Some sources (an SVG from a file picker) report no MIME type; infer it.
        const typed =
          file.type || !/\.svg$/i.test(file.name)
            ? file
            : new Blob([file], { type: 'image/svg+xml' });
        const uploaded = await this.images.upload(projectId, typed);
        const scale = Math.min(1, maxSide / Math.max(uploaded.width, uploaded.height));
        const width = Math.max(8, Math.round(uploaded.width * scale));
        const height = Math.max(8, Math.round(uploaded.height * scale));
        const shift = index * 24;
        const x = Math.round(center.x - width / 2 + shift);
        const y = Math.round(center.y - height / 2 + shift);
        await this.store.addElement({
          type: 'image',
          x: this.gridSnap() ? snapToGrid(x) : x,
          y: this.gridSnap() ? snapToGrid(y) : y,
          width,
          height,
          angle: 0,
          strokeColor: this.defaultStroke(),
          fillStyle: 'none',
          strokeWidth: 0,
          strokeStyle: 'solid',
          opacity: 100,
          fileId: uploaded.fileId,
        });
        index += 1;
      } catch (err) {
        this.snackBar.open(
          err instanceof Error ? err.message : 'Could not add the image.',
          undefined,
          { duration: 4000 },
        );
      }
    }
  }

  /** Snapshot the selected tables and elements into the in-app clipboard. */
  private copySelection(): void {
    const tableIds = this.store.selectedTableIds();
    const elementIds = this.store.selectedElementIds();
    // Copying a frame (slide) copies everything inside it too.
    const inner = frameContents(
      new Set(elementIds),
      this.store.elements(),
      this.store.tables(),
      this.store.sequenceDiagrams(),
      this.store.lifelines(),
      this.store.sequenceMessages(),
      this.store.shownSlideIds(),
    );
    const selectedDiagrams = new Set(this.store.selectedDiagramIds());
    const tables = this.store
      .tables()
      .filter((t) => tableIds.includes(t.id) || inner.tableIds.has(t.id));
    const elements = this.store
      .elements()
      .filter((e) => elementIds.includes(e.id) || inner.elementIds.has(e.id));
    if (!tables.length && !elements.length && !selectedDiagrams.size && !inner.diagramIds.size) {
      return;
    }
    this.clipboard = {
      tables,
      elements,
      diagramIds: [...new Set([...inner.diagramIds, ...selectedDiagrams])],
      frame: elements.find((e) => e.type === 'frame' && elementIds.includes(e.id)) ?? null,
    };
    this.pasteCount = 0;
    // A lone code block also lands on the system clipboard as plain text.
    if (!tables.length && elements.length === 1 && elements[0].type === 'code') {
      void navigator.clipboard?.writeText(elements[0].text ?? '').catch(() => undefined);
    }
  }

  /** Paste the clipboard, each successive paste stepping further from the original. */
  private async pasteClipboard(): Promise<void> {
    const clip = this.clipboard;
    if (!clip) {
      return;
    }
    this.pasteCount++;
    // Slides are pasted a page-width away on free canvas, other things nudged diagonally.
    const slide = clip.frame ? this.store.elements().find((e) => e.id === clip.frame?.id) : null;
    const frame = slide ?? clip.frame;
    const isSlide = !!frame?.slide;
    const dx = isSlide ? 0 : frame ? this.freeFrameOffset(frame, this.pasteCount) : 24 * this.pasteCount;
    const dy = frame && !isSlide ? 0 : isSlide ? 0 : 24 * this.pasteCount;
    let result: { copies: Map<string, CanvasElementModel>; tableIds: string[]; diagramIds: string[] } | null =
      null;
    await this.store.batchHistory(async () => {
      result = await this.cloneItems(
        new Set(clip.tables.map((t) => t.id).filter((id) => this.store.tables().some((t) => t.id === id))),
        new Set(clip.diagramIds.filter((id) => this.store.sequenceDiagrams().some((d) => d.id === id))),
        clip.elements.map((e) => this.store.elements().find((x) => x.id === e.id) ?? e),
        dx,
        dy,
      );
    });
    const r = result as { copies: Map<string, CanvasElementModel>; tableIds: string[]; diagramIds: string[] } | null;
    if (!r) {
      return;
    }
    const pastedSlide = [...r.copies.values()].find((c) => c.type === 'frame' && c.slide);
    if (pastedSlide) {
      this.focusFrame(pastedSlide.id);
      return;
    }
    // Pasted content lands on the slide that is shown, not on the one it was copied from.
    const shown = this.store.activeSlideId();
    if (shown) {
      await this.store.assignSlide(
        {
          elements: [...r.copies.values()].filter((c) => c.type !== 'frame').map((c) => c.id),
          tables: r.tableIds,
          diagrams: r.diagramIds,
        },
        shown,
      );
    }
    this.store.setSelection(
      r.tableIds,
      [],
      [...r.copies.values()].map((c) => c.id),
      [],
      [],
      r.diagramIds,
    );
  }

  // --- toolbar: add / zoom / grid / align ---

  protected onCanvasDblClick(event: MouseEvent): void {
    // Toolbars, panels, the minimap and the inline editor are children of the
    // canvas element, so their double-clicks bubble up here. Only a double-click
    // on the drawing surface itself (the canvas or the world layer) is ours.
    const target = event.target as Element | null;
    const onSurface =
      !!target &&
      (target === event.currentTarget || !!target.closest('.world')) &&
      !target.closest('.text-editor');
    if (!onSurface) {
      return;
    }
    const world = this.toWorld(event.clientX, event.clientY);
    const hit = this.shownElements().reverse().find((e) => hitTestElement(e, world));
    // Double-clicking a member of a group steps into it (selecting just that
    // member); once inside, the usual double-click behaviour applies.
    const locked = (id: string): boolean => {
      const gid = this.store.groupIdOf(id);
      return !!gid && gid !== this.store.enteredGroupId();
    };
    const diagram = this.store.sequenceDiagrams().find((d) => {
      const b = this.diagramBox(d);
      return (
        !!b && world.x >= b.minX && world.x <= b.maxX && world.y >= b.minY && world.y <= b.maxY
      );
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
            this.store.patchElementLocal(hit.id, this.fitTextSize(hit, hit.text ?? ''));
          }
        }
        this.editingTextId.set(hit.id);
      }
      return;
    }
    this.createTextAt(world);
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

  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    const rect = this.canvasRect();
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.applyZoom(factor, event.clientX - rect.left, event.clientY - rect.top);
  }

  protected addTableCentered(): void {
    const rect = this.canvasRect();
    const v = this.store.viewport();
    let x = Math.round((rect.width / 2 - v.x) / v.zoom - NODE_WIDTH / 2);
    let y = Math.round((rect.height / 2 - v.y) / v.zoom - 40);
    if (this.gridSnap()) {
      x = snapToGrid(x);
      y = snapToGrid(y);
    }
    void this.store.addTable(x, y);
  }

  protected zoomIn(): void {
    const rect = this.canvasRect();
    this.applyZoom(1.2, rect.width / 2, rect.height / 2);
  }

  protected zoomOut(): void {
    const rect = this.canvasRect();
    this.applyZoom(1 / 1.2, rect.width / 2, rect.height / 2);
  }

  /** Animate back to the project's saved home view, or the default (origin, 100%). */
  protected resetView(): void {
    const home = this.store.home() ?? { x: 0, y: 0, zoom: 1 };
    this.animateViewport(home.x, home.y, home.zoom);
  }

  protected setHome(): void {
    if (!this.store.canEdit()) {
      return;
    }
    const v = this.store.viewport();
    void this.store.setHome({ x: v.x, y: v.y, zoom: v.zoom });
  }

  protected clearHome(): void {
    if (!this.store.canEdit()) {
      return;
    }
    void this.store.setHome(null);
  }

  /** Pan (keeping zoom) so the given world point is at the center of the canvas. */
  protected panToWorld(world: { x: number; y: number }): void {
    const rect = this.canvasRect();
    const v = this.store.viewport();
    this.store.setViewport(
      rect.width / 2 - world.x * v.zoom,
      rect.height / 2 - world.y * v.zoom,
      v.zoom,
    );
  }

  private viewAnim = 0;

  /** Canvas pixel size, tracked so the minimap can show the visible world rectangle. */
  private readonly canvasSize = signal({ width: 0, height: 0 });

  private animateViewport(x: number, y: number, zoom: number): void {
    cancelAnimationFrame(this.viewAnim);
    const from = this.store.viewport();
    const start = performance.now();
    const duration = 250;
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      this.store.setViewport(
        from.x + (x - from.x) * e,
        from.y + (y - from.y) * e,
        from.zoom + (zoom - from.zoom) * e,
      );
      if (t < 1) {
        this.viewAnim = requestAnimationFrame(step);
      }
    };
    this.viewAnim = requestAnimationFrame(step);
  }

  /** Simplified world-space footprint of every element, for the minimap. */
  protected readonly minimapItems = computed<MinimapItem[]>(() => {
    const items: MinimapItem[] = [];
    for (const t of this.store.tables()) {
      items.push({
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
        items.push({ kind: 'sequence', x0: b.minX, y0: b.minY, x1: b.maxX, y1: b.maxY });
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
      items.push({
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
    const rect = this.canvasSize();
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

  /**
   * Tables + relationships to export. If any tables are selected (marquee or
   * multi-select), export just those and only the relationships whose endpoints
   * both fall inside the selection; otherwise export the whole diagram.
   */
  private exportScope(ignoreSelection = false): {
    tables: TableModel[];
    relationships: RelationshipModel[];
    elements: CanvasElementModel[];
    sequences: SequenceExportData;
    selectionOnly: boolean;
  } {
    const selectedTableIds = new Set(ignoreSelection ? [] : this.store.selectedTableIds());
    const selectedElementIds = new Set(ignoreSelection ? [] : this.store.selectedElementIds());
    const selectedMessageIds = new Set(ignoreSelection ? [] : this.store.selectedMessageIds());
    const selectedLifelineIds = new Set(ignoreSelection ? [] : this.store.selectedLifelineIds());
    const selectedDiagramIds = new Set(ignoreSelection ? [] : this.store.selectedDiagramIds());
    const selectionOnly =
      selectedTableIds.size > 0 ||
      selectedElementIds.size > 0 ||
      selectedMessageIds.size > 0 ||
      selectedLifelineIds.size > 0 ||
      selectedDiagramIds.size > 0;
    const tables = selectionOnly
      ? this.store.tables().filter((t) => selectedTableIds.has(t.id))
      : this.store.tables();
    const elements = selectionOnly
      ? this.store.elements().filter((e) => selectedElementIds.has(e.id))
      : this.store.elements();

    const columnIds = new Set<string>();
    for (const table of tables) {
      for (const column of table.columns) {
        columnIds.add(column.id);
      }
    }
    const relationships = this.store
      .relationships()
      .filter((r) => columnIds.has(r.sourceColumnId) && columnIds.has(r.targetColumnId));

    // A selection includes a sequence diagram when the diagram itself, or any of
    // its participants/messages, is selected. With only some messages selected,
    // draw just those (participants stay so the arrows have ends).
    const allLifelines = this.store.lifelines();
    const allMessages = this.store.sequenceMessages();
    const diagrams = this.store.sequenceDiagrams().filter((d) => {
      if (!selectionOnly) return true;
      return (
        selectedDiagramIds.has(d.id) ||
        allLifelines.some((l) => l.diagramId === d.id && selectedLifelineIds.has(l.id)) ||
        allMessages.some((m) => m.diagramId === d.id && selectedMessageIds.has(m.id))
      );
    });
    const diagramIds = new Set(diagrams.map((d) => d.id));
    const messages = allMessages.filter((m) => {
      if (!diagramIds.has(m.diagramId)) return false;
      if (!selectionOnly || selectedDiagramIds.has(m.diagramId)) return true;
      const hasPicked = allMessages.some(
        (o) => o.diagramId === m.diagramId && selectedMessageIds.has(o.id),
      );
      return !hasPicked || selectedMessageIds.has(m.id);
    });
    const sequences: SequenceExportData = {
      diagrams,
      lifelines: allLifelines.filter((l) => diagramIds.has(l.diagramId)),
      messages,
    };

    return { tables, relationships, elements, sequences, selectionOnly };
  }

  private exportBaseName(selectionOnly: boolean): string {
    return selectionOnly ? 'diagram-selection' : 'diagram';
  }

  /** Merge a project file into this project, landing in the visible part of the canvas. */
  protected importProjectFile(file: unknown): Promise<number> {
    const rect = this.canvasRect();
    const v = this.store.viewport();
    // Top-left of the content goes a little in from the canvas's top-left corner.
    const anchor = {
      x: Math.round((rect.width * 0.1 - v.x) / v.zoom),
      y: Math.round((rect.height * 0.15 - v.y) / v.zoom),
    };
    return this.store.importFile(file, anchor);
  }

  /**
   * Save just the current selection as a project file. It imports as its own new
   * project; references that leave the selection (e.g. an arrow bound to an
   * unselected table) are dropped by the importer.
   */
  protected exportSelectionFile(): void {
    const { tables, relationships, elements, sequences, selectionOnly } = this.exportScope();
    if (!selectionOnly) return;
    const current = this.projectsStore.selected();
    const baseName = (current?.name ?? 'project').slice(0, 100);
    this.projectFile.save(
      {
        format: PROJECT_EXPORT_FORMAT,
        version: PROJECT_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        project: {
          name: `${baseName} (selection)`,
          description: current?.description ?? null,
          type: current?.type ?? 'ERD',
        },
        schema: {
          tables,
          relationships,
          notes: [],
          elements,
          sequenceDiagrams: [...sequences.diagrams],
          lifelines: [...sequences.lifelines],
          sequenceMessages: [...sequences.messages],
          viewport: this.store.viewport(),
        },
      },
      `${baseName}-selection`,
    );
  }

  /** Open the SQL export dialog for the current scope (selection or whole diagram). */
  protected openSqlExport(): void {
    const { tables, relationships, selectionOnly } = this.exportScope();
    const sql = generateSql(
      // Elements are decorative and are ignored by the SQL generator.
      {
        tables,
        relationships,
        notes: [],
        elements: [],
        sequenceDiagrams: [],
        lifelines: [],
        sequenceMessages: [],
        viewport: this.store.viewport(),
      },
      { dialect: 'mysql' },
    );
    this.dialog.open(ExportDialogComponent, {
      width: '720px',
      maxWidth: '92vw',
      data: { sql, baseName: this.exportBaseName(selectionOnly), selectionOnly },
    });
  }

  /** Export the current scope as an image, matching the live theme and layout. */
  protected async onExportImage(format: ImageFormat): Promise<void> {
    // Selecting one or more frames exports those frames (each as its own fixed-size page).
    const selectedIds = new Set(this.store.selectedElementIds());
    const selectedFrames = this.store
      .elements()
      .filter((e) => e.type === 'frame' && selectedIds.has(e.id));
    if (selectedFrames.length) {
      await this.exportFrames(format, selectedFrames);
      return;
    }
    const { tables, relationships, elements, sequences, selectionOnly } = this.exportScope();
    if (tables.length === 0 && elements.length === 0 && sequences.lifelines.length === 0) {
      this.snackBar.open('Nothing to export yet. Add a table or shape first.', undefined, {
        duration: 2500,
      });
      return;
    }
    try {
      const imageData = await this.imageDataFor(elements);
      const built = buildDiagramSvg(
        tables,
        relationships,
        elements,
        sequences,
        undefined,
        imageData,
      );
      const diagram = { ...built, svg: await embedFonts(built.svg) };
      await exportDiagramImage(format, diagram, this.exportBaseName(selectionOnly));
    } catch (err) {
      this.snackBar.open(
        `Export failed: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        { duration: 4000 },
      );
    }
  }

  /** `data:` URIs for the pictures among `elements`, so exports are self-contained. */
  private async imageDataFor(
    elements: readonly CanvasElementModel[],
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(
        elements.filter((e) => e.type === 'image' && e.fileId).map((e) => e.fileId as string),
      ),
    ];
    const data = new Map<string, string>();
    await Promise.all(
      ids.map(async (id) => {
        const url = await this.images.dataUrl(id);
        if (url) {
          data.set(id, url);
        }
      }),
    );
    return data;
  }

  /** Export every frame on the canvas as a multi-page PDF (one page per frame). */
  protected async exportAllFramesPdf(): Promise<void> {
    // Slide frames belong to their presentation and have their own export.
    const frames = this.store.elements().filter((e) => e.type === 'frame' && !e.slide);
    if (!frames.length) {
      this.snackBar.open('No frames yet. Draw one with the Frame tool (F).', undefined, {
        duration: 2500,
      });
      return;
    }
    await this.exportFrames('pdf', frames);
  }

  /** Export the selected presentation's slides, in order, as a multi-page PDF. */
  protected async exportAllSlidesPdf(): Promise<void> {
    const slides = this.store.presentationFrames().filter((f) => !f.slide?.hidden);
    if (!slides.length) {
      this.snackBar.open('No slides to export in this presentation.', undefined, {
        duration: 2500,
      });
      return;
    }
    await this.exportFrames('pdf', slides, true, this.store.presentation() ?? undefined);
  }

  /**
   * Export frames as cropped, exact-size images. PDF bundles them into one
   * multi-page file (reading order by default; with several frames the user
   * arranges the pages first); SVG/PNG
   * download one file per frame, named after the frame.
   */
  private async exportFrames(
    format: ImageFormat,
    frames: readonly CanvasElementModel[],
    /** Keep `frames` in the given order (slide sequence) instead of reading order + arrange dialog. */
    keepOrder = false,
    /** File name for a multi-page PDF (defaults to "slides" / "frames"). */
    pdfName?: string,
  ): Promise<void> {
    // Whole-canvas scope: a frame crops the full diagram, whatever is selected.
    const { tables, relationships, elements, sequences } = this.exportScope(true);
    let ordered = keepOrder ? [...frames] : [...frames].sort((a, b) => a.y - b.y || a.x - b.x);
    if (!keepOrder && format === 'pdf' && ordered.length > 1) {
      const arranged = await this.arrangeFramePages(ordered);
      if (!arranged) {
        return;
      }
      ordered = arranged;
    }
    try {
      const images: DiagramImage[] = [];
      const imageData = await this.imageDataFor(elements);
      for (const frame of ordered) {
        // A slide's picture holds only its own contents (slides are stacked).
        const mine = contentForFrame(
          frame.id,
          !!frame.slide,
          elements,
          tables,
          sequences.diagrams,
          sequences.lifelines,
          sequences.messages,
        );
        const built = buildDiagramSvg(
          mine.tables,
          relationships,
          mine.elements,
          { diagrams: mine.diagrams, lifelines: mine.lifelines, messages: mine.messages },
          { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
          imageData,
        );
        images.push({ ...built, svg: await embedFonts(built.svg) });
      }
      if (format === 'pdf') {
        const name =
          ordered.length === 1
            ? EditorComponent.fileSafe(ordered[0].text)
            : pdfName
              ? EditorComponent.fileSafe(pdfName) || 'slides'
              : keepOrder
                ? 'slides'
                : 'frames';
        downloadBlob(await pagesToPdfBlob(images), `${name}.pdf`);
        return;
      }
      const used = new Map<string, number>();
      for (let i = 0; i < ordered.length; i += 1) {
        const base = EditorComponent.fileSafe(ordered[i].text) || `frame-${i + 1}`;
        const n = (used.get(base) ?? 0) + 1;
        used.set(base, n);
        await exportDiagramImage(format, images[i], n > 1 ? `${base}-${n}` : base);
      }
    } catch (err) {
      this.snackBar.open(
        `Export failed: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        { duration: 4000 },
      );
    }
  }

  /** Page order the user last picked, reused as the starting order next time. */
  private lastFramePageOrder: string[] = [];

  /**
   * Ask the user for the PDF page order. Starts from their previous arrangement
   * (frames not seen before follow in reading order). Null when cancelled.
   */
  private async arrangeFramePages(
    frames: CanvasElementModel[],
  ): Promise<CanvasElementModel[] | null> {
    const rank = (f: CanvasElementModel): number => {
      const i = this.lastFramePageOrder.indexOf(f.id);
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    const start = [...frames].sort((a, b) => rank(a) - rank(b)); // stable: reading order for new ones
    const ref = this.dialog.open<FrameOrderDialogComponent, FrameOrderDialogData, string[]>(
      FrameOrderDialogComponent,
      {
        width: '460px',
        maxWidth: '92vw',
        data: {
          frames: start.map((f) => ({
            id: f.id,
            name: f.text || 'Untitled frame',
            width: Math.round(f.width),
            height: Math.round(f.height),
          })),
        },
      },
    );
    const ids = await firstValueFrom(ref.afterClosed());
    if (!ids) {
      return null;
    }
    this.lastFramePageOrder = ids;
    const byId = new Map(frames.map((f) => [f.id, f]));
    return ids.map((id) => byId.get(id)).filter((f): f is CanvasElementModel => !!f);
  }

  /** A frame name made safe for use as a file name. */
  private static fileSafe(name: string | undefined): string {
    return (
      (name ?? 'frame')
        .trim()
        .replace(/[^\w\-. ]+/g, '')
        .replace(/\s+/g, '-') || 'frame'
    );
  }

  private applyZoom(factor: number, centerX: number, centerY: number): void {
    const v = this.store.viewport();
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
    const worldX = (centerX - v.x) / v.zoom;
    const worldY = (centerY - v.y) / v.zoom;
    this.store.setViewport(centerX - worldX * newZoom, centerY - worldY * newZoom, newZoom);
  }

  // --- relationship inline toolbar ---

  protected onSetRelType(type: RelationshipType): void {
    const rel = this.store.selectedRelationship();
    if (rel && this.store.canEdit()) {
      void this.store.updateRelationship(rel.id, { type });
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
    const moves: { id: string; from: { x: number; y: number }; to: { x: number; y: number } }[] =
      [];
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
    }
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

  private layoutSnapshot(diagramId: string): SequenceLayoutSnapshot {
    const cfg = this.store.sequenceDiagrams().find((x) => x.id === diagramId);
    return {
      lifelineXs: new Map(
        this.store
          .lifelines()
          .filter((l) => l.diagramId === diagramId)
          .map((l) => [l.id, l.x]),
      ),
      messageYs: new Map(
        this.store
          .sequenceMessages()
          .filter((m) => m.diagramId === diagramId)
          .map((m) => [m.id, m.y]),
      ),
      originY: cfg?.originY ?? 0,
      rowSpacing: cfg?.rowSpacing ?? 48,
    };
  }
}
