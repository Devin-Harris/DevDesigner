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
import { firstValueFrom } from 'rxjs';
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
import {
  generateSql,
  PROJECT_EXPORT_FORMAT,
  PROJECT_EXPORT_VERSION,
  type SequenceDiagramModel,
} from '@dbdesigner/shared';
import { RealtimeService } from '../../core/services/realtime.service';
import { EditorActionsService } from '../../core/services/editor-actions.service';
import { ProjectFileService } from '../../core/services/project-file.service';
import { ProjectsStore } from '../../stores/projects.store';
import { ThemeService } from '../../core/services/theme.service';
import { ProjectStore, type SequenceLayoutSnapshot } from '../../stores/project.store';
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
import { type AlignAction } from './canvas/models/toolbar-actions';
import { MAX_ZOOM, MIN_ZOOM, NODE_WIDTH, SVG_OFFSET } from './canvas/constants/canvas.constants';
import { computeConnectors, segmentDrag } from './canvas/helpers/connectors.helper';
import { frameContents, sequenceDiagramBox } from './canvas/helpers/frame-contents.helper';
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
    ShapeToolbarComponent,
    InspectorComponent,
    SequenceInspectorComponent,
    SequenceMessageToolbarComponent,
    SequenceParticipantToolbarComponent,
    CanvasSequenceComponent,
    ElementFloatingToolbarComponent,
    RelationshipInspectorComponent,
    ElementInspectorComponent,
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
  private readonly projectFile = inject(ProjectFileService);
  private readonly projectsStore = inject(ProjectsStore);
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
    const above = (minY * v.zoom + v.y) - ROTATE_CLEAR * v.zoom - BAR;
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
  protected readonly canAlign = computed(() => {
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
    return this.store.canEdit() && units.size >= 2;
  });

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
      };
    }
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
  /** World-space point a shape draw started from (the corner, or the center with Alt). */
  private drawAnchor = { x: 0, y: 0 };
  private lastDrawPointer = { x: 0, y: 0 };
  /** In-app clipboard for copy/paste of tables and canvas elements. */
  private clipboard: { tables: TableModel[]; elements: CanvasElementModel[] } | null = null;
  private pasteCount = 0;
  /** True once the current drag has switched to dragging Alt-made copies. */
  private dragCopied = false;
  private lastPointer: PointerEvent | null = null;
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
      exportFramesPdf: () => void this.exportAllFramesPdf(),
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
    effect(() => {
      this.editorActions.hasSelection.set(
        this.store.selectedTableIds().length > 0 ||
          this.store.selectedElementIds().length > 0 ||
          this.store.selectedMessageIds().length > 0 ||
          this.store.selectedLifelineIds().length > 0 ||
          this.store.selectedDiagramIds().length > 0,
      );
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
    if (tool !== 'select' && tool !== 'hand' && this.store.canEdit() && this.store.projectId()) {
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
    tool: Exclude<EditorTool, 'select' | 'hand' | 'table' | 'sequence'>,
    event: PointerEvent,
  ): void {
    const world = this.toWorld(event.clientX, event.clientY);
    const x = this.gridSnap() ? snapToGrid(world.x) : world.x;
    const y = this.gridSnap() ? snapToGrid(world.y) : world.y;
    const type = tool as ElementType;
    const sticky = this.store.elementStyle();
    // Frames keep their own quiet look; they don't inherit the last-used shape style.
    const style =
      type === 'frame'
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
    if (draft.type === 'frame') {
      if (width < 40 || height < 40) {
        const preset = framePreset(this.framePresetId());
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
          waypoints.set(rel.id, rel.waypoints.map((w) => ({ ...w })));
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
    const zoom = this.store.viewport().zoom;
    const dx = (clientX - this.startClientX) / zoom;
    const dy = (clientY - this.startClientY) / zoom;
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
    if (kind === 'element') {
      const selected = new Set(this.store.selectedElementIds());
      // Duplicating a frame duplicates what's inside it too (tables, sequence
      // diagrams, and elements), and the copies travel with the copied frame.
      const inner = this.carriedByFrames(selected);
      const tableCopies: string[] = [];
      for (const id of inner?.tables.keys() ?? []) {
        const copy = await this.store.duplicateTable(id, 0, 0, false, false);
        if (copy) {
          tableCopies.push(copy);
        }
      }
      const sequenceCopies: string[] = [];
      for (const id of inner?.sequences.keys() ?? []) {
        const copy = await this.store.duplicateSequence(id, 0, 0);
        if (copy) {
          sequenceCopies.push(copy);
        }
      }
      // One call for selected + inner elements so bindings between copies remap.
      const sources = this.store
        .elements()
        .filter((e) => selected.has(e.id) || inner?.elements.has(e.id));
      const copies = await this.store.duplicateElements(sources, 0, 0);
      created = [...copies.values()].map((c) => c.id);
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
      const sources = this.store
        .tables()
        .filter((t) => this.store.selectedTableIds().includes(t.id));
      const ids = new Map<string, string>();
      // Selected relationships between cloned tables are cloned too, which needs
      // the copies' column ids, so wait for the columns in that case.
      const relSources = this.store
        .relationships()
        .filter((r) => this.store.selectedRelationshipIds().includes(r.id));
      const columnMap = new Map<string, string>();
      for (const src of sources) {
        const id = await this.store.duplicateTable(
          src.id,
          0,
          0,
          false,
          relSources.length > 0,
          columnMap,
        );
        if (id) {
          ids.set(src.id, id);
        }
      }
      created = [...ids.values()];
      const relCopies = relSources.length
        ? await this.store.duplicateRelationships(relSources, columnMap)
        : [];
      this.store.setSelection(created, relCopies, []);
      const grabbed = (grabbedTable && ids.get(grabbedTable)) || created[0];
      if (grabbed) {
        resume = () => this.beginNodeDrag(grabbed);
      }
    }
    if (this.mode !== 'duplicating' || !resume) {
      // Released before the copies existed (or nothing was copied).
      if (this.mode === 'duplicating') {
        this.mode = 'idle';
        this.gestureActive.set(false);
      }
      return;
    }
    resume();
    if (this.lastPointer) {
      this.onPointerMove(this.lastPointer);
    }
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
      this.mode === 'arrow-endpoint'
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
      if (this.clipboard && this.store.canEdit()) {
        event.preventDefault();
        void this.pasteClipboard();
      }
      return;
    }
    // Shift/Alt pressed or released mid-draw re-applies the constraint immediately.
    if (event.key === 'Alt' && (this.mode === 'element' || this.mode === 'node')) {
      event.preventDefault();
      void this.duplicateAndDrag();
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
    );
    inner.elementIds.forEach((id) => elementIds.add(id));
    inner.tableIds.forEach((id) => tableIds.add(id));
    inner.diagramIds.forEach((id) => diagramIds.add(id));

    relIds.forEach((id) => void this.store.deleteRelationship(id));
    tableIds.forEach((id) => void this.store.deleteTable(id));
    elementIds.forEach((id) => void this.store.deleteElement(id));
    diagramIds.forEach((id) => void this.store.deleteSequence(id));
    if (!diagramIds.size) {
      messageIds.forEach((id) => void this.store.deleteMessage(id));
      lifelineIds.forEach((id) => void this.store.deleteLifeline(id));
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
  };

  protected onToolChange(tool: EditorTool): void {
    this.activeTool.set(tool);
  }

  @HostListener('window:keyup', ['$event'])
  protected onKeyUp(event: KeyboardEvent): void {
    if (event.key === ' ') {
      this.spaceDown = false;
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

  /** Snapshot the selected tables and elements into the in-app clipboard. */
  private copySelection(): void {
    const tableIds = this.store.selectedTableIds();
    const elementIds = this.store.selectedElementIds();
    const tables = this.store.tables().filter((t) => tableIds.includes(t.id));
    const elements = this.store.elements().filter((e) => elementIds.includes(e.id));
    if (!tables.length && !elements.length) {
      return;
    }
    this.clipboard = { tables, elements };
    this.pasteCount = 0;
  }

  /** Paste the clipboard, each successive paste stepping further from the original. */
  private async pasteClipboard(): Promise<void> {
    const clip = this.clipboard;
    if (!clip) {
      return;
    }
    this.pasteCount++;
    const offset = 24 * this.pasteCount;
    const tableIds: string[] = [];
    for (const t of clip.tables) {
      const id = await this.store.duplicateTable(t.id, offset, offset, false);
      if (id) {
        tableIds.push(id);
      }
    }
    // Element copies select themselves; fold the table copies into that selection.
    const copies = await this.store.duplicateElements(clip.elements, offset, offset);
    this.store.setSelection(
      tableIds,
      [],
      [...copies.values()].map((c) => c.id),
    );
  }

  // --- toolbar: add / zoom / grid / align ---

  protected onCanvasDblClick(event: MouseEvent): void {
    const world = this.toWorld(event.clientX, event.clientY);
    const hit = [...this.store.elements()].reverse().find((e) => hitTestElement(e, world));
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
    // Double-clicking a text element edits it; double-clicking a shape edits its
    // centered label; double-clicking empty canvas creates a text block.
    if (hit) {
      if (
        hit.type === 'text' ||
        hit.type === 'frame' ||
        hit.type === 'rectangle' ||
        hit.type === 'ellipse' ||
        hit.type === 'diamond' ||
        hit.type === 'arrow' ||
        hit.type === 'line'
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
      const built = buildDiagramSvg(tables, relationships, elements, sequences);
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

  /** Export every frame on the canvas as a multi-page PDF (one page per frame). */
  protected async exportAllFramesPdf(): Promise<void> {
    const frames = this.store.elements().filter((e) => e.type === 'frame');
    if (!frames.length) {
      this.snackBar.open('No frames yet. Draw one with the Frame tool (F).', undefined, {
        duration: 2500,
      });
      return;
    }
    await this.exportFrames('pdf', frames);
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
  ): Promise<void> {
    // Whole-canvas scope: a frame crops the full diagram, whatever is selected.
    const { tables, relationships, elements, sequences } = this.exportScope(true);
    let ordered = [...frames].sort((a, b) => a.y - b.y || a.x - b.x);
    if (format === 'pdf' && ordered.length > 1) {
      const arranged = await this.arrangeFramePages(ordered);
      if (!arranged) {
        return;
      }
      ordered = arranged;
    }
    try {
      const images: DiagramImage[] = [];
      for (const frame of ordered) {
        const built = buildDiagramSvg(tables, relationships, elements, sequences, {
          x: frame.x,
          y: frame.y,
          width: frame.width,
          height: frame.height,
        });
        images.push({ ...built, svg: await embedFonts(built.svg) });
      }
      if (format === 'pdf') {
        const name = ordered.length === 1 ? EditorComponent.fileSafe(ordered[0].text) : 'frames';
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
    return (name ?? 'frame').trim().replace(/[^\w\-. ]+/g, '').replace(/\s+/g, '-') || 'frame';
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
          h: nodeHeight(t.columns.length),
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
    if (items.length < 2) {
      return;
    }
    const minX = Math.min(...items.map((i) => i.x));
    const maxRight = Math.max(...items.map((i) => i.x + i.w));
    const minY = Math.min(...items.map((i) => i.y));
    const maxBottom = Math.max(...items.map((i) => i.y + i.h));

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
        const sorted = [...items].sort((p, q) => p.x - q.x);
        const first = sorted[0].x;
        const last = sorted[sorted.length - 1].x;
        const step = (last - first) / (sorted.length - 1);
        sorted.forEach((i, n) => i.place(first + step * n, i.y));
        break;
      }
      case 'dist-v': {
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
