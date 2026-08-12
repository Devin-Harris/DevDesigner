import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { RelationshipModel, RelationshipType, TableModel } from '@dbdesigner/shared';
import { ProjectStore } from '../../stores/project.store';
import { MAX_ZOOM, MIN_ZOOM, NODE_WIDTH, SVG_OFFSET } from './canvas/constants/canvas.constants';
import type { Point, Side } from './canvas/models/geometry.model';
import {
  buildColumnLocations,
  columnAnchor,
  nodeHeight,
  snapToGrid,
} from './canvas/helpers/node-metrics.helper';
import { computeConnectors, segmentDrag } from './canvas/helpers/connectors.helper';
import { elbowPath } from './canvas/helpers/svg-path.helper';
import { CanvasToolbarComponent, type AlignAction } from './canvas-toolbar/canvas-toolbar.component';
import {
  CanvasConnectorsComponent,
  type EndpointDownEvent,
  type SegmentDownEvent,
} from './canvas-connectors/canvas-connectors.component';
import { InspectorComponent } from './inspector/inspector.component';
import { RelationshipInspectorComponent } from './relationship-inspector/relationship-inspector.component';
import { RelationshipToolbarComponent } from './relationship-toolbar/relationship-toolbar.component';
import { TableNodeComponent, type HandleEvent } from './table-node/table-node.component';

type DragMode = 'idle' | 'pan' | 'node' | 'marquee';

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
    CanvasConnectorsComponent,
    CanvasToolbarComponent,
    InspectorComponent,
    RelationshipInspectorComponent,
    RelationshipToolbarComponent,
    TableNodeComponent,
  ],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.scss',
})
export class EditorComponent {
  protected readonly store = inject(ProjectStore);
  protected readonly svgOffset = SVG_OFFSET;

  readonly projectId = input.required<string>();
  private readonly canvasRef = viewChild.required<ElementRef<HTMLDivElement>>('canvas');

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
    const center = loc.table.x + NODE_WIDTH / 2;
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

  constructor() {
    effect(() => {
      const id = this.projectId();
      if (id) {
        void this.store.load(id);
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

  private static additive(event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): boolean {
    return event.ctrlKey || event.metaKey || event.shiftKey;
  }

  // --- canvas pointer (pan / marquee) ---

  protected onCanvasPointerDown(event: PointerEvent): void {
    if (event.button === 1 || (event.button === 0 && this.spaceDown)) {
      event.preventDefault();
      this.mode = 'pan';
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
    this.marqueeAdditive = EditorComponent.additive(event);
    if (!this.marqueeAdditive) {
      this.store.clearSelection();
    }
    const p = this.screenPoint(event.clientX, event.clientY);
    this.marqueeStart.set(p);
    this.marqueeCurrent.set(p);
    this.mode = 'marquee';
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
    if (this.linkSourceColumnId() || this.relinkState()) {
      this.linkCursor.set(this.toWorld(event.clientX, event.clientY));
      return;
    }
    if (this.activeSegment()) {
      this.moveActiveSegment(event.clientX, event.clientY);
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
    }
    this.mode = 'idle';
    this.dragTableId = null;
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
      .filter((con) => con.mx >= rect.minX && con.mx <= rect.maxX && con.my >= rect.minY && con.my <= rect.maxY)
      .map((con) => con.id);

    if (this.marqueeAdditive) {
      const nextTables = new Set([...this.store.selectedTableIds(), ...tableIds]);
      const nextRels = new Set([...this.store.selectedRelationshipIds(), ...relIds]);
      this.store.setSelection([...nextTables], [...nextRels]);
    } else {
      this.store.setSelection(tableIds, relIds);
    }
  }

  private boxIntersects(table: TableModel, rect: Rect): boolean {
    const left = table.x;
    const right = table.x + NODE_WIDTH;
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
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.store.canEdit()) {
      const relIds = [...this.store.selectedRelationshipIds()];
      const tableIds = [...this.store.selectedTableIds()];
      if (relIds.length || tableIds.length) {
        event.preventDefault();
        relIds.forEach((id) => void this.store.deleteRelationship(id));
        tableIds.forEach((id) => void this.store.deleteTable(id));
      }
    }
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
    let x = Math.round(world.x - NODE_WIDTH / 2);
    let y = Math.round(world.y - 12);
    if (this.gridSnap()) {
      x = snapToGrid(x);
      y = snapToGrid(y);
    }
    void this.store.addTable(x, y);
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
    const selected = this.store.tables().filter((t) => this.store.selectedTableIds().includes(t.id));
    if (selected.length < 2) {
      return;
    }
    const height = (t: TableModel) => nodeHeight(t.columns.length);
    const minX = Math.min(...selected.map((t) => t.x));
    const maxRight = Math.max(...selected.map((t) => t.x + NODE_WIDTH));
    const minY = Math.min(...selected.map((t) => t.y));
    const maxBottom = Math.max(...selected.map((t) => t.y + height(t)));

    const move = (t: TableModel, x: number, y: number) =>
      this.store.moveTable(t.id, Math.round(x), Math.round(y));

    switch (action) {
      case 'left':
        selected.forEach((t) => move(t, minX, t.y));
        break;
      case 'right':
        selected.forEach((t) => move(t, maxRight - NODE_WIDTH, t.y));
        break;
      case 'hcenter': {
        const center = (minX + maxRight) / 2;
        selected.forEach((t) => move(t, center - NODE_WIDTH / 2, t.y));
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
