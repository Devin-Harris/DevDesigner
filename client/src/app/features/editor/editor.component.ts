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
  viewChild,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import type {
  CanvasElementModel,
  CreateElementDto,
  ElementType,
  RelationshipModel,
  RelationshipType,
  TableModel,
} from '@dbdesigner/shared';
import { generateSql } from '@dbdesigner/shared';
import { RealtimeService } from '../../core/services/realtime.service';
import { EditorActionsService } from '../../core/services/editor-actions.service';
import { ThemeService } from '../../core/services/theme.service';
import { ProjectStore } from '../../stores/project.store';
import { AutofocusDirective } from './autofocus.directive';
import {
  CanvasConnectorsComponent,
  type EndpointDownEvent,
  type SegmentDownEvent,
} from './canvas-connectors/canvas-connectors.component';
import {
  CanvasShapesComponent,
  type ResizeDownEvent,
  type ResizeHandle,
  type ShapeEndpointEvent,
  type ShapePointerEvent,
} from './canvas-shapes/canvas-shapes.component';
import {
  CanvasSequenceComponent,
  type LifelinePointerEvent,
  type SpineClickEvent,
} from './canvas-sequence/canvas-sequence.component';
import { buildLifelineViews, buildMessageViews } from './canvas/helpers/sequence-render.helper';
import { type AlignAction } from './canvas/models/toolbar-actions';
import { MAX_ZOOM, MIN_ZOOM, NODE_WIDTH, SVG_OFFSET } from './canvas/constants/canvas.constants';
import { computeConnectors, segmentDrag } from './canvas/helpers/connectors.helper';
import {
  absolutePoints,
  elementBox,
  elementIntersectsRect,
  hitTestElement,
  tableBox,
  toRelative,
} from './canvas/helpers/element-geometry.helper';
import {
  buildColumnLocations,
  columnAnchor,
  nodeHeight,
  snapToGrid,
  tableWidth,
} from './canvas/helpers/node-metrics.helper';
import { buildShapeViews, fontStack, fontWeightFor } from './canvas/helpers/shape-render.helper';
import { elbowPath } from './canvas/helpers/svg-path.helper';
import type { Box, Point, Side } from './canvas/models/geometry.model';
import { ElementFloatingToolbarComponent } from './element-floating-toolbar/element-floating-toolbar.component';
import { buildDiagramSvg } from './export/diagram-svg.helper';
import { ExportDialogComponent } from './export/export-dialog.component';
import { exportDiagramImage, type ImageFormat } from './export/image-export.helper';
import { InspectorComponent } from './inspector/inspector.component';
import { RelationshipInspectorComponent } from './relationship-inspector/relationship-inspector.component';
import { ElementInspectorComponent } from './element-inspector/element-inspector.component';
import { LifelineInspectorComponent } from './lifeline-inspector/lifeline-inspector.component';
import { MessageInspectorComponent } from './message-inspector/message-inspector.component';
import { TableToolbarComponent } from './table-toolbar/table-toolbar.component';
import { RelationshipToolbarComponent } from './relationship-toolbar/relationship-toolbar.component';
import { ShapeToolbarComponent, type EditorTool } from './shape-toolbar/shape-toolbar.component';
import { ShareDialogComponent } from './share-dialog/share-dialog.component';
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
  | 'lifeline-drag'
  | 'draw-message';

/** Default styling applied to a newly drawn element. */
const DEFAULT_ELEMENT_STROKE = '#2f3a45';
const DEFAULT_FONT_SIZE = 20;

interface ElementGesture {
  id: string;
  /** Starting geometry of the element(s) at gesture start (for delta math). */
  start: { x: number; y: number; width: number; height: number; angle: number };
  /** The element's full state at gesture start (for undo history). */
  snapshot: CanvasElementModel;
  /** Additional selected elements moved together (id -> start x/y), move only. */
  others?: Map<string, { x: number; y: number }>;
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

const GRID_SNAP_KEY = 'dbd-grid-snap';

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
    CanvasSequenceComponent,
    ShapeToolbarComponent,
    InspectorComponent,
    ElementFloatingToolbarComponent,
    RelationshipInspectorComponent,
    ElementInspectorComponent,
    LifelineInspectorComponent,
    MessageInspectorComponent,
    RelationshipToolbarComponent,
    TableToolbarComponent,
    TableNodeComponent,
    AutofocusDirective,
  ],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.scss',
})
export class EditorComponent {
  protected readonly store = inject(ProjectStore);
  protected readonly realtime = inject(RealtimeService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
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
          height: nodeHeight(table.columns.length),
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
      this.store.tables(),
      this.store.relationships(),
      new Set(this.store.selectedRelationshipIds()),
    ),
  );

  // --- drawing tools / canvas elements ---

  /** The active tool. 'select' is the pointer mode; others draw that element. */
  protected readonly activeTool = signal<EditorTool>('select');

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
    if (this.editingTextId() || this.gestureActive()) {
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
    for (const e of els) {
      const b = elementBox(e);
      minX = Math.min(minX, b.x0);
      minY = Math.min(minY, b.y0);
      maxX = Math.max(maxX, b.x1);
    }
    const v = this.store.viewport();
    return {
      left: ((minX + maxX) / 2) * v.zoom + v.x,
      top: Math.max(minY * v.zoom + v.y - 52, 8),
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

  /** Render views for all elements plus any in-progress draft, resolved for the SVG layer. */
  protected readonly shapeViews = computed(() => {
    const draft = this.draft();
    const elements = draft ? [...this.store.elements(), draft] : this.store.elements();
    // Depend on the theme so colors re-resolve (and re-contrast) on toggle.
    this.theme.dark();
    return buildShapeViews(
      elements,
      this.store.tables(),
      new Set(this.store.selectedElementIds()),
      this.themeColors(),
    );
  });

  /** Resolved canvas background + text color for the render-time contrast guard. */
  private themeColors(): { canvasBg: string; text: string } | undefined {
    try {
      const styles = getComputedStyle(this.canvasRef().nativeElement);
      const canvasBg = styles.getPropertyValue('--dbd-canvas-bg').trim();
      const text = styles.getPropertyValue('--dbd-text').trim();
      return canvasBg && text ? { canvasBg, text } : undefined;
    } catch {
      return undefined;
    }
  }

  /** The shapes layer is interactive only in select mode (drawing passes through it). */
  protected readonly shapesInteractive = computed(
    () => this.activeTool() === 'select' && this.store.canEdit(),
  );

  /** Sequence layer is interactive in select mode and when drawing a message. */
  protected readonly sequenceInteractive = computed(
    () =>
      (this.activeTool() === 'select' || this.activeTool() === 'message') && this.store.canEdit(),
  );

  protected readonly lifelineViews = computed(() =>
    buildLifelineViews(
      this.store.lifelines(),
      this.store.sequenceConfig(),
      this.store.sequenceMessages(),
      this.store.selectedLifelineIds(),
    ),
  );

  protected readonly messageViews = computed(() =>
    buildMessageViews(
      this.store.sequenceMessages(),
      this.store.lifelines(),
      this.store.selectedMessageIds(),
    ),
  );

  /** Id of the text element being edited inline (a DOM textarea overlays it). */
  protected readonly editingTextId = signal<string | null>(null);

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
        el.type === 'rectangle' ||
        el.type === 'ellipse' ||
        el.type === 'diamond');
    if (!el || !editable) {
      return null;
    }
    const v = this.store.viewport();
    const z = v.zoom;
    const isLabel = el.type !== 'text';
    // A text element that has been resized keeps its fixed width and wraps.
    const wrapped = !isLabel && this.resizedTextIds.has(id);
    const fontSize = el.fontSize ?? (isLabel ? 16 : DEFAULT_FONT_SIZE);
    const text = el.text ?? '';
    // Height of the text content itself (so a label's editor can be centered in
    // its shape); a text element's own box is already fit to its content.
    const contentHeight = Math.max(1, text.split('\n').length) * fontSize * 1.25;
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
      wrap: isLabel || wrapped,
      center: isLabel,
      padding: (isLabel ? 8 : 2) * z,
    };
  });

  /**
   * Measure a multi-line text block in world units using a hidden DOM element in
   * the ACTUAL rendered web font (canvas `measureText` falls back to a narrower
   * font for script faces like Kalam and under-measures, so the box came out too
   * small and the text spilled out). Includes the 2px layout padding on each side
   * so the glyphs never touch the box edge.
   */
  private measureText(
    text: string,
    fontSize: number,
    fontFamilyKey: string | undefined,
    fontWeight = 400,
    italic = false,
    wrapWidth?: number,
  ): { width: number; height: number } {
    const el = EditorComponent.measureEl;
    if (!el) {
      const lines = text.split('\n');
      const width = Math.max(1, ...lines.map((l) => l.length)) * fontSize * 0.6;
      return { width: Math.ceil(width) + 6, height: Math.ceil(lines.length * fontSize * 1.25) };
    }
    el.style.fontFamily = fontStack(fontFamilyKey);
    el.style.fontSize = `${fontSize}px`;
    el.style.fontWeight = String(fontWeight);
    el.style.fontStyle = italic ? 'italic' : 'normal';
    // wrapWidth set => measure the WRAPPED height at that content width; else the
    // natural single-line width (auto-size).
    if (wrapWidth != null) {
      el.style.whiteSpace = 'pre-wrap';
      el.style.wordBreak = 'break-word';
      el.style.width = `${Math.max(1, wrapWidth)}px`;
    } else {
      el.style.whiteSpace = 'pre';
      el.style.wordBreak = 'normal';
      el.style.width = 'auto';
    }
    el.textContent = text.length ? text : ' ';
    const rect = el.getBoundingClientRect();
    return {
      width: Math.ceil(rect.width) + 6, // +4 for the 2px layout padding, +2 slack
      height: Math.ceil(rect.height) + 4,
    };
  }

  /** Hidden element used to measure text in the real web font (1x, outside the zoom). */
  private static readonly measureEl: HTMLDivElement | null = (() => {
    if (typeof document === 'undefined') {
      return null;
    }
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'absolute',
      left: '-9999px',
      top: '-9999px',
      visibility: 'hidden',
      pointerEvents: 'none',
      whiteSpace: 'pre',
      lineHeight: '1.25',
      padding: '0',
      margin: '0',
      border: '0',
      boxSizing: 'content-box',
    } as Partial<CSSStyleDeclaration>);
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    return el;
  })();

  /**
   * Text element ids whose box has been manually resized: they keep a fixed width
   * and WRAP their text, instead of auto-growing to fit. Seeded on edit-start from
   * geometry (text wider than its box) so it survives reloads. In-memory only.
   */
  private readonly resizedTextIds = new Set<string>();

  /** Whether a text element is in fixed-width (wrap) mode rather than auto-size. */
  private isWrappedText(id: string): boolean {
    return this.resizedTextIds.has(id);
  }

  /**
   * Seed the fixed-width/wrap flag for an existing committed text from geometry:
   * if its settled box is narrower than the natural single-line text, it was
   * resized. Called at edit-start only (never on a freshly-created box, whose
   * initial width would wrongly read as "narrower than the text").
   */
  private seedWrapFlag(el: CanvasElementModel): void {
    const natural = this.measureText(
      el.text ?? '',
      el.fontSize ?? DEFAULT_FONT_SIZE,
      el.fontFamily,
      el.bold ? 800 : fontWeightFor(el.strokeWidth),
      el.italic,
    );
    if (natural.width > el.width + 2) {
      this.resizedTextIds.add(el.id);
    }
  }

  /**
   * Connectors as rendered. While re-pointing an endpoint, the affected line's
   * own end follows the cursor (so the line moves in place) instead of showing a
   * separate temporary line.
   */
  protected readonly displayConnectors = computed(() => {
    const base = this.connectors();
    const relink = this.relinkState();
    const cursor = this.linkCursor();
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

  /** Dashed preview only for drawing a brand-new relationship (re-point moves the line itself). */
  protected readonly tempLink = computed<string | null>(() => {
    const cursor = this.linkCursor();
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

  private dragLifelineId: string | null = null;
  private dragLifelineStartX = 0;
  private drawMessageFromLifelineId: string | null = null;
  private drawMessageWorldY = 0;
  private drawMessageCurrentWorldX = 0;

  private lastCursorSent = 0;

  constructor() {
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
    });
    this.destroyRef.onDestroy(() => this.editorActions.clear());
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
    if (tool !== 'select' && tool !== 'hand' && this.store.canEdit() && this.store.projectId()) {
      event.preventDefault();
      if (tool === 'table') {
        this.addTableAt(event.clientX, event.clientY);
        this.activeTool.set('select');
        return;
      }
      if (tool === 'lifeline') {
        const world = this.toWorld(event.clientX, event.clientY);
        const x = this.gridSnap() ? snapToGrid(Math.round(world.x)) : Math.round(world.x);
        const cfg = this.store.sequenceConfig();
        if (cfg.originY == null) {
          this.store.setSequenceOriginY(Math.round(world.y) + cfg.headerHeight);
        }
        void this.store.addLifeline({ label: 'Lifeline', x, width: 120, order: this.store.lifelines().length });
        this.activeTool.set('select');
        return;
      }
      if (tool === 'message') {
        // Message drawing begins on a spine click (handled by onSequenceSpineClick).
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

  /** Start drawing an element of the active tool at the pointer. */
  private beginDraw(tool: Exclude<EditorTool, 'select' | 'table'>, event: PointerEvent): void {
    const world = this.toWorld(event.clientX, event.clientY);
    const x = this.gridSnap() ? snapToGrid(world.x) : world.x;
    const y = this.gridSnap() ? snapToGrid(world.y) : world.y;
    const type = tool as ElementType;
    const style = this.store.elementStyle();
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

  private updateDraw(clientX: number, clientY: number): void {
    const draft = this.draft();
    if (!draft) {
      return;
    }
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
    // Rectangle / ellipse / diamond: grow the box from the anchor corner.
    const ex = snap ? snapToGrid(world.x) : world.x;
    const ey = snap ? snapToGrid(world.y) : world.y;
    this.draft.set({
      ...draft,
      x: Math.min(draft.x, ex),
      y: Math.min(draft.y, ey),
      width: Math.abs(ex - draft.x),
      height: Math.abs(ey - draft.y),
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
    }
  }

  private draftToDto(draft: CanvasElementModel): CreateElementDto {
    const { x, y, points } = draft;
    let { width, height } = draft;
    if (draft.type === 'rectangle' || draft.type === 'ellipse' || draft.type === 'diamond') {
      if (width < 4 && height < 4) {
        width = 120;
        height = 80;
      }
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
      text: draft.text,
      fontSize: draft.fontSize,
      fontFamily: draft.fontFamily,
      textAlign: draft.textAlign,
      startArrowhead: draft.startArrowhead,
      endArrowhead: draft.endArrowhead,
    };
  }

  // --- canvas element pointer (select / move / resize / rotate / endpoint) ---

  protected onElementPointerDown(payload: ShapePointerEvent): void {
    const el = this.store.elements().find((e) => e.id === payload.id);
    if (!el) {
      return;
    }
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
    this.mode = 'element';
    this.gestureActive.set(true);
    this.startClientX = payload.event.clientX;
    this.startClientY = payload.event.clientY;
    const others = new Map<string, { x: number; y: number }>();
    for (const id of this.store.selectedElementIds()) {
      const e = this.store.elements().find((x) => x.id === id);
      if (e) {
        others.set(id, { x: e.x, y: e.y });
      }
    }
    this.elementGesture = {
      id: el.id,
      start: { x: el.x, y: el.y, width: el.width, height: el.height, angle: el.angle },
      snapshot: el,
      others,
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
  }

  private moveElements(clientX: number, clientY: number): void {
    const g = this.elementGesture;
    if (!g?.others) {
      return;
    }
    const zoom = this.store.viewport().zoom;
    const dx = (clientX - this.startClientX) / zoom;
    const dy = (clientY - this.startClientY) / zoom;
    const snap = this.gridSnap();
    for (const [id, start] of g.others) {
      const nx = snap ? snapToGrid(start.x + dx) : Math.round(start.x + dx);
      const ny = snap ? snapToGrid(start.y + dy) : Math.round(start.y + dy);
      this.store.moveElement(id, nx, ny);
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
    const left = g.handle === 'nw' || g.handle === 'sw';
    const top = g.handle === 'nw' || g.handle === 'ne';
    const cx = s.x + s.width / 2;
    const cy = s.y + s.height / 2;
    const factor = ev.altKey ? 2 : 1;

    let width = Math.max(8, s.width + (left ? -dx : dx) * factor);
    let height = Math.max(8, s.height + (top ? -dy : dy) * factor);
    if (ev.shiftKey && s.width > 0 && s.height > 0) {
      const scale = Math.max(width / s.width, height / s.height);
      width = s.width * scale;
      height = s.height * scale;
    }
    if (this.gridSnap()) {
      width = Math.max(8, snapToGrid(width));
      height = Math.max(8, snapToGrid(height));
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

    // Resizing a TEXT element fixes its width and makes it wrap: the horizontal
    // drag sets the width, the height auto-fits the wrapped text (top-anchored),
    // and the element is flagged so it keeps wrapping instead of auto-growing.
    const el = this.store.elements().find((e) => e.id === g.id);
    if (el?.type === 'text') {
      this.resizedTextIds.add(g.id);
      const fitted = this.measureText(
        el.text ?? '',
        el.fontSize ?? DEFAULT_FONT_SIZE,
        el.fontFamily,
        el.bold ? 800 : fontWeightFor(el.strokeWidth),
        el.italic,
        width - 4,
      );
      this.store.patchElementLocal(g.id, { x, y: s.y, width, height: fitted.height });
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
    binding: { targetKind: 'element' | 'table'; targetId: string };
    box: { x: number; y: number; width: number; height: number };
  } | null {
    const toRect = (b: Box) => ({ x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 });
    for (const table of this.store.tables()) {
      const box = tableBox(table);
      if (this.pointInBox(world, box)) {
        return { binding: { targetKind: 'table', targetId: table.id }, box: toRect(box) };
      }
    }
    // Topmost element first (elements render in ascending zIndex order).
    const elements = [...this.store.elements()].reverse();
    for (const el of elements) {
      if (el.id === excludeElementId || el.type === 'line' || el.type === 'arrow') {
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
      void this.store.commitElementGeometry(
        g.id,
        { x: snap.x, y: snap.y, width: snap.width, height: snap.height },
        { x: el.x, y: el.y, width: el.width, height: el.height },
      );
    } else if (this.mode === 'element-rotate') {
      void this.store.commitElementGeometry(g.id, { angle: snap.angle }, { angle: el.angle });
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
    if (el.type !== 'text') {
      // Shape label: just update text; the shape box does not resize.
      this.store.patchElementLocal(id, { text: value });
      return;
    }
    // Auto-size (grow) while typing; once resized, keep the width and wrap.
    const size = this.fitTextSize(el, value);
    this.store.patchElementLocal(id, { text: value, width: size.width, height: size.height });
  }

  /**
   * The box a text element should take for `value`: auto-sized to the content in
   * auto mode, or the current (resized) width with the text wrapped to it.
   */
  private fitTextSize(el: CanvasElementModel, value: string): { width: number; height: number } {
    const fontSize = el.fontSize ?? DEFAULT_FONT_SIZE;
    const weight = el.bold ? 800 : fontWeightFor(el.strokeWidth);
    if (this.isWrappedText(el.id)) {
      const width = Math.max(16, el.width);
      const size = this.measureText(value, fontSize, el.fontFamily, weight, el.italic, width - 4);
      return { width, height: size.height };
    }
    const size = this.measureText(value, fontSize, el.fontFamily, weight, el.italic);
    return { width: Math.max(size.width, 8), height: size.height };
  }

  protected commitTextEdit(): void {
    const id = this.editingTextId();
    this.editingTextId.set(null);
    if (!id) {
      return;
    }
    const el = this.store.elements().find((e) => e.id === id);
    if (!el) {
      return;
    }
    const text = el.text ?? '';
    if (el.type !== 'text') {
      // Shape label: store the (possibly empty) label without resizing the shape.
      void this.store.updateElement(id, { text });
      return;
    }
    if (text.trim() === '') {
      void this.store.deleteElement(id);
      return;
    }
    const size = this.fitTextSize(el, text);
    void this.store.updateElement(id, { text, width: size.width, height: size.height });
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
    this.mode = 'node';
    this.dragTableId = table.id;
    this.startClientX = event.clientX;
    this.startClientY = event.clientY;
    this.multiDragStart = new Map(
      this.store
        .tables()
        .filter((t) => this.store.selectedTableIds().includes(t.id))
        .map((t) => [t.id, { x: t.x, y: t.y }]),
    );

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

  // --- sequence diagram interactions ---

  protected onSequenceLifelineDown(payload: LifelinePointerEvent): void {
    if (payload.event.button !== 0 || !this.store.canEdit()) return;
    if (EditorComponent.additive(payload.event)) {
      this.store.selectLifeline(payload.id, true);
      return;
    }
    this.store.selectLifeline(payload.id, false);
    const ll = this.store.lifelines().find((l) => l.id === payload.id);
    if (!ll) return;
    this.dragLifelineId = payload.id;
    this.dragLifelineStartX = ll.x;
    this.startClientX = payload.event.clientX;
    this.mode = 'lifeline-drag';
  }

  protected onSequenceSelectLifeline(payload: LifelinePointerEvent): void {
    if (this.mode !== 'lifeline-drag') {
      this.store.selectLifeline(payload.id, EditorComponent.additive(payload.event));
    }
  }

  protected onSequenceSelectMessage(payload: LifelinePointerEvent): void {
    this.store.selectMessage(payload.id, EditorComponent.additive(payload.event));
  }

  protected onSequenceMessageDown(payload: LifelinePointerEvent): void {
    if (payload.event.button !== 0 || !this.store.canEdit()) return;
    this.store.selectMessage(payload.id, EditorComponent.additive(payload.event));
  }

  protected onSequenceSpineClick(ev: SpineClickEvent): void {
    if (!this.store.canEdit()) return;
    if (this.activeTool() === 'message') {
      // Begin drawing a message from this spine.
      this.drawMessageFromLifelineId = ev.lifelineId;
      this.drawMessageWorldY = ev.worldY;
      this.drawMessageCurrentWorldX = this.store.lifelines().find((l) => l.id === ev.lifelineId)?.x ?? 0;
      this.startClientX = ev.event.clientX;
      this.mode = 'draw-message';
      return;
    }
    // In select mode: clicking the spine selects the lifeline.
    if (this.activeTool() === 'select') {
      this.store.selectLifeline(ev.lifelineId, EditorComponent.additive(ev.event));
    }
  }

  private commitMessageDraw(): void {
    const fromId = this.drawMessageFromLifelineId;
    if (!fromId) return;
    const worldX = this.drawMessageCurrentWorldX;
    // Find the nearest lifeline to the release point.
    const lifelines = this.store.lifelines();
    let toId: string | null = null;
    let minDist = Infinity;
    for (const ll of lifelines) {
      if (ll.id === fromId) continue;
      const d = Math.abs(ll.x - worldX);
      if (d < minDist) {
        minDist = d;
        toId = ll.id;
      }
    }
    if (toId && minDist < 100) {
      void this.store.addSequenceMessage({
        fromLifelineId: fromId,
        toLifelineId: toId,
        y: this.drawMessageWorldY,
        style: 'solid',
        direction: 'forward',
        arrowhead: 'arrow',
      });
    }
    this.drawMessageFromLifelineId = null;
    this.activeTool.set('select');
  }

  private commitLifelineDrag(): void {
    const id = this.dragLifelineId;
    if (!id) return;
    // Check if this lifeline crossed another and needs reordering.
    const lifelines = this.store.lifelines().slice().sort((a, b) => a.x - b.x);
    const ordered = lifelines.map((l) => l.id);
    this.store.reorderLifelines(ordered);
    this.dragLifelineId = null;
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
      this.updateDraw(event.clientX, event.clientY);
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
    if (this.mode === 'lifeline-drag' && this.dragLifelineId) {
      const zoom = this.store.viewport().zoom;
      const dx = (event.clientX - this.startClientX) / zoom;
      const x = this.gridSnap()
        ? snapToGrid(Math.round(this.dragLifelineStartX + dx))
        : Math.round(this.dragLifelineStartX + dx);
      this.store.moveLifeline(this.dragLifelineId, x);
      return;
    }
    if (this.mode === 'draw-message') {
      const world = this.toWorld(event.clientX, event.clientY);
      this.drawMessageCurrentWorldX = world.x;
      return;
    }
    if (this.mode === 'pan') {
      const dx = event.clientX - this.startClientX;
      const dy = event.clientY - this.startClientY;
      const v = this.store.viewport();
      this.store.setViewport(this.startViewportX + dx, this.startViewportY + dy, v.zoom);
    } else if (this.mode === 'node' && this.dragTableId) {
      const zoom = this.store.viewport().zoom;
      const dx = (event.clientX - this.startClientX) / zoom;
      const dy = (event.clientY - this.startClientY) / zoom;
      const snap = this.gridSnap();
      for (const [id, start] of this.multiDragStart) {
        const nx = snap ? snapToGrid(start.x + dx) : Math.round(start.x + dx);
        const ny = snap ? snapToGrid(start.y + dy) : Math.round(start.y + dy);
        this.store.moveTable(id, nx, ny);
      }
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
    if (this.mode === 'marquee') {
      this.commitMarquee();
    } else if (this.mode === 'draw') {
      void this.commitDraft(false);
    } else if (this.mode === 'element') {
      this.recordMoveGesture();
    } else if (
      this.mode === 'element-resize' ||
      this.mode === 'element-rotate' ||
      this.mode === 'arrow-endpoint'
    ) {
      this.commitElementGesture();
    } else if (this.mode === 'lifeline-drag') {
      this.commitLifelineDrag();
    } else if (this.mode === 'draw-message') {
      this.commitMessageDraw();
    }
    this.mode = 'idle';
    this.panning.set(false);
    this.dragTableId = null;
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

    const tableIds = this.store
      .tables()
      .filter((t) => this.boxIntersects(t, rect))
      .map((t) => t.id);
    const relIds = this.connectors()
      .filter(
        (con) =>
          con.mx >= rect.minX && con.mx <= rect.maxX && con.my >= rect.minY && con.my <= rect.maxY,
      )
      .map((con) => con.id);
    const elementIds = this.store
      .elements()
      .filter((e) => elementIntersectsRect(e, rect))
      .map((e) => e.id);

    if (this.marqueeAdditive) {
      const nextTables = new Set([...this.store.selectedTableIds(), ...tableIds]);
      const nextRels = new Set([...this.store.selectedRelationshipIds(), ...relIds]);
      const nextEls = new Set([...this.store.selectedElementIds(), ...elementIds]);
      this.store.setSelection([...nextTables], [...nextRels], [...nextEls]);
    } else {
      this.store.setSelection(tableIds, relIds, elementIds);
    }
  }

  private boxIntersects(table: TableModel, rect: Rect): boolean {
    const left = table.x;
    const right = table.x + tableWidth(table);
    const top = table.y;
    const bottom = table.y + nodeHeight(table.columns.length);
    return left <= rect.maxX && right >= rect.minX && top <= rect.maxY && bottom >= rect.minY;
  }

  @HostListener('window:keydown', ['$event'])
  protected onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    const typing =
      tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;
    if (typing) {
      return;
    }
    if (event.key === ' ') {
      this.spaceDown = true;
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
    const tool = mod ? undefined : EditorComponent.TOOL_SHORTCUTS[event.key.toLowerCase()];
    if (tool && this.store.canEdit()) {
      this.activeTool.set(tool);
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.store.canEdit()) {
      const relIds = [...this.store.selectedRelationshipIds()];
      const tableIds = [...this.store.selectedTableIds()];
      const elementIds = [...this.store.selectedElementIds()];
      const lifelineIds = [...this.store.selectedLifelineIds()];
      const messageIds = [...this.store.selectedMessageIds()];
      if (relIds.length || tableIds.length || elementIds.length || lifelineIds.length || messageIds.length) {
        event.preventDefault();
        relIds.forEach((id) => void this.store.deleteRelationship(id));
        tableIds.forEach((id) => void this.store.deleteTable(id));
        elementIds.forEach((id) => void this.store.deleteElement(id));
        lifelineIds.forEach((id) => void this.store.deleteLifeline(id));
        messageIds.forEach((id) => void this.store.deleteSequenceMessage(id));
      }
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
    f: 'lifeline',
    m: 'message',
  };

  protected onToolChange(tool: EditorTool): void {
    this.activeTool.set(tool);
  }

  @HostListener('window:keyup', ['$event'])
  protected onKeyUp(event: KeyboardEvent): void {
    if (event.key === ' ') {
      this.spaceDown = false;
    }
  }

  // --- toolbar: add / zoom / grid / align ---

  protected onCanvasDblClick(event: MouseEvent): void {
    if (!this.store.canEdit() || !this.store.projectId()) {
      return;
    }
    const world = this.toWorld(event.clientX, event.clientY);
    // Double-clicking a text element edits it; double-clicking a shape edits its
    // centered label; double-clicking empty canvas creates a text block.
    const hit = [...this.store.elements()].reverse().find((e) => hitTestElement(e, world));
    if (hit) {
      if (
        hit.type === 'text' ||
        hit.type === 'rectangle' ||
        hit.type === 'ellipse' ||
        hit.type === 'diamond'
      ) {
        this.store.selectElement(hit.id);
        // Seed the fixed-width/wrap flag from geometry before the editor opens.
        if (hit.type === 'text') {
          this.seedWrapFlag(hit);
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

  protected resetView(): void {
    this.store.setViewport(0, 0, 1);
  }

  protected toggleGrid(): void {
    this.gridSnap.update((v) => !v);
  }

  /**
   * Tables + relationships to export. If any tables are selected (marquee or
   * multi-select), export just those and only the relationships whose endpoints
   * both fall inside the selection; otherwise export the whole diagram.
   */
  private exportScope(): {
    tables: TableModel[];
    relationships: RelationshipModel[];
    elements: CanvasElementModel[];
    selectionOnly: boolean;
  } {
    const selectedTableIds = new Set(this.store.selectedTableIds());
    const selectedElementIds = new Set(this.store.selectedElementIds());
    const selectionOnly = selectedTableIds.size > 0 || selectedElementIds.size > 0;
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

    return { tables, relationships, elements, selectionOnly };
  }

  private exportBaseName(selectionOnly: boolean): string {
    return selectionOnly ? 'diagram-selection' : 'diagram';
  }

  /** Open the SQL export dialog for the current scope (selection or whole diagram). */
  protected openSqlExport(): void {
    const { tables, relationships, selectionOnly } = this.exportScope();
    const sql = generateSql(
      // Elements are decorative and are ignored by the SQL generator.
      { tables, relationships, notes: [], elements: [], viewport: this.store.viewport(), lifelines: [], sequenceMessages: [], sequenceConfig: { lifelineSpacing: 180, rowSpacing: 60, headerHeight: 48 } },
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
    const { tables, relationships, elements, selectionOnly } = this.exportScope();
    if (tables.length === 0 && elements.length === 0) {
      this.snackBar.open('Nothing to export yet. Add a table or shape first.', undefined, {
        duration: 2500,
      });
      return;
    }
    try {
      const diagram = buildDiagramSvg(tables, relationships, elements);
      await exportDiagramImage(format, diagram, this.exportBaseName(selectionOnly));
    } catch (err) {
      this.snackBar.open(
        `Export failed: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        { duration: 4000 },
      );
    }
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
    const selected = this.store
      .tables()
      .filter((t) => this.store.selectedTableIds().includes(t.id));
    if (selected.length < 2) {
      return;
    }
    const height = (t: TableModel) => nodeHeight(t.columns.length);
    const minX = Math.min(...selected.map((t) => t.x));
    const maxRight = Math.max(...selected.map((t) => t.x + tableWidth(t)));
    const minY = Math.min(...selected.map((t) => t.y));
    const maxBottom = Math.max(...selected.map((t) => t.y + height(t)));

    const move = (t: TableModel, x: number, y: number) =>
      this.store.moveTable(t.id, Math.round(x), Math.round(y));

    switch (action) {
      case 'left':
        selected.forEach((t) => move(t, minX, t.y));
        break;
      case 'right':
        selected.forEach((t) => move(t, maxRight - tableWidth(t), t.y));
        break;
      case 'hcenter': {
        const center = (minX + maxRight) / 2;
        selected.forEach((t) => move(t, center - tableWidth(t) / 2, t.y));
        break;
      }
      case 'top':
        selected.forEach((t) => move(t, t.x, minY));
        break;
      case 'bottom':
        selected.forEach((t) => move(t, t.x, maxBottom - height(t)));
        break;
      case 'vcenter': {
        const center = (minY + maxBottom) / 2;
        selected.forEach((t) => move(t, t.x, center - height(t) / 2));
        break;
      }
      case 'dist-h': {
        const sorted = [...selected].sort((p, q) => p.x - q.x);
        const first = sorted[0].x;
        const last = sorted[sorted.length - 1].x;
        const step = (last - first) / (sorted.length - 1);
        sorted.forEach((t, i) => move(t, first + step * i, t.y));
        break;
      }
      case 'dist-v': {
        const sorted = [...selected].sort((p, q) => p.y - q.y);
        const first = sorted[0].y;
        const last = sorted[sorted.length - 1].y;
        const step = (last - first) / (sorted.length - 1);
        sorted.forEach((t, i) => move(t, t.x, first + step * i));
        break;
      }
    }
  }
}
