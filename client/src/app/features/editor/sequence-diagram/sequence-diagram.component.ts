import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import type { LifelineModel, SequenceDiagramModel } from '@dbdesigner/shared';
import { AutofocusDirective } from '../../../core/directives/autofocus.directive';
import { ProjectStore } from '../../../stores/project.store';

interface MessageView {
  id: string;
  y: number;
  leftX: number;
  width: number;
  fromX: number;
  toX: number;
  headX: number;
  dirRight: boolean;
  mid: number;
  label: string;
  dashed: boolean;
  isBreak: boolean;
  spanLeft: number;
  spanWidth: number;
  selected: boolean;
}

interface BoundingBox {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
  cx: number;
  cy: number;
}

type WorldFn = (clientX: number, clientY: number) => { x: number; y: number };
type SnapFn = (n: number) => number;
/** All eight resize handles, like any other shape. */
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

type Drag =
  | { kind: 'll'; id: string; start: number; startVal: number }
  | { kind: 'msg'; id: string; startClientY: number; startY: number }
  | {
      kind: 'diagram';
      startX: number;
      startY: number;
      startXs: Map<string, number>;
      startOriginY: number;
      startRows: Map<string, number>;
    }
  | {
      kind: 'resize';
      handle: Handle;
      startX: number;
      startY: number;
      startXs: Map<string, number>;
      startRows: Map<string, number>;
      left: number;
      right: number;
      centerX: number;
      top: number;
      contentH: number;
      centerY: number;
      headerH: number;
      nRows: number;
      startRowSpacing: number;
    }
  | { kind: 'connect'; fromId: string; startY: number }
  | { kind: 'endpoint'; id: string; which: 'from' | 'to' };

const BOX_PAD = 26;
const MIN_ROW = 20;

/**
 * One sequence diagram: a rounded bounding box wrapping its participant lifelines
 * (header boxes + dashed spines) and messages (horizontal arrows with labels, or
 * a label-only "break" row). A project may show several of these side by side.
 * Interactions are self-managed against the store, scoped to this diagram's id:
 *  - click the box to select it; drag it to move; drag any edge/corner handle to
 *    resize (Shift locks proportions, Alt resizes from center);
 *  - drag a header horizontally to reposition that participant;
 *  - drag anywhere on a spine onto another to add a message at the drawn row;
 *  - drag a message vertically to re-row it (snaps; rows may be shared);
 *  - double-click a connector/label to edit its text.
 * Lives inside the transformed `.world`, so children sit at world coordinates.
 */
@Component({
  selector: 'app-sequence-diagram',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AutofocusDirective],
  templateUrl: './sequence-diagram.component.html',
  styleUrl: './sequence-diagram.component.scss',
})
export class SequenceDiagramComponent {
  protected readonly store = inject(ProjectStore);

  /** The id of the diagram this instance renders. */
  readonly diagramId = input.required<string>();
  /** Screen→world mapping supplied by the editor (for drag-connect drop targets). */
  readonly toWorld = input<WorldFn | null>(null);
  /** Snap a world coordinate to the grid (identity when grid-snap is off). */
  readonly snap = input<SnapFn | null>(null);

  /**
   * This diagram's record, read straight from the store signal (not via an input)
   * so a config change — including one made from a window-listener drag — re-renders
   * this component the same way a lifeline change does.
   */
  protected readonly diagram = computed<SequenceDiagramModel>(
    () =>
      this.store.sequenceDiagrams().find((d) => d.id === this.diagramId()) ?? {
        id: this.diagramId(),
        lifelineSpacing: 160,
        rowSpacing: 48,
        headerHeight: 42,
        originY: 0,
      },
  );

  protected readonly originY = computed(() => this.diagram().originY);
  protected readonly headerH = computed(() => this.diagram().headerHeight);
  protected readonly headerBottom = computed(() => this.originY() + this.headerH());
  protected readonly rowSpacing = computed(() => this.diagram().rowSpacing);

  /** This diagram's lifelines, left-to-right. */
  protected readonly lls = computed(() =>
    this.store
      .lifelines()
      .filter((l) => l.diagramId === this.diagram().id)
      .sort((a, b) => a.x - b.x),
  );
  private readonly msgs = computed(() =>
    this.store.sequenceMessages().filter((m) => m.diagramId === this.diagram().id),
  );

  protected readonly selectedLifelineIds = computed(() => new Set(this.store.selectedLifelineIds()));
  protected readonly sequenceSelected = computed(
    () => this.store.selectedDiagramId() === this.diagram().id,
  );

  /** Snap a world-y to its row centre on the grid (row 1 is the first below the header). */
  protected rowY(y: number): number {
    const hb = this.headerBottom();
    const gap = this.rowSpacing();
    return hb + gap * Math.max(1, Math.round((y - hb) / gap));
  }

  /** Messages, each at its own snapped row — several may share a row (simultaneous). */
  protected readonly msgViews = computed<MessageView[]>(() => {
    const ll = this.lls();
    const byId = new Map(ll.map((l) => [l.id, l] as const));
    const minX = ll.length ? Math.min(...ll.map((l) => l.x)) : 0;
    const maxX = ll.length ? Math.max(...ll.map((l) => l.x)) : 0;
    const sel = new Set(this.store.selectedMessageIds());
    const out: MessageView[] = [];
    const ordered = [...this.msgs()].sort((a, b) => a.y - b.y);
    ordered.forEach((m) => {
      const isBreak = m.style === 'break';
      const f = byId.get(m.fromLifelineId);
      const t = byId.get(m.toLifelineId);
      // A break only needs the diagram to exist; a normal message needs both ends.
      if (!isBreak && (!f || !t)) return;
      const fromX = f ? f.x : minX;
      const toX = t ? t.x : maxX;
      const headX = m.direction === 'forward' ? toX : fromX;
      const otherX = headX === fromX ? toX : fromX;
      out.push({
        id: m.id,
        y: this.rowY(m.y),
        leftX: Math.min(fromX, toX),
        width: Math.max(Math.abs(toX - fromX), 1),
        fromX,
        toX,
        headX,
        dirRight: headX >= otherX,
        mid: isBreak ? (minX + maxX) / 2 : (fromX + toX) / 2,
        label: m.label ?? '',
        dashed: m.style === 'dashed',
        isBreak,
        spanLeft: minX,
        spanWidth: Math.max(maxX - minX, 1),
        selected: sel.has(m.id),
      });
    });
    return out;
  });

  /** Highest occupied row, for sizing the spines and box. */
  protected readonly maxRow = computed(() => {
    const hb = this.headerBottom();
    const gap = this.rowSpacing();
    const rows = this.msgs().map((m) => Math.max(1, Math.round((m.y - hb) / gap)));
    return rows.length ? Math.max(...rows) : 0;
  });

  /** Spine length: one row past the lowest message, leaving room below. */
  protected readonly spineEnd = computed(
    () => this.headerBottom() + this.rowSpacing() * (this.maxRow() + 1),
  );

  /** Rounded bounding box around this diagram (for move/resize/select). */
  protected readonly box = computed<BoundingBox | null>(() => {
    const l = this.lls();
    if (!l.length) return null;
    const left = Math.min(...l.map((x) => x.x - x.width / 2)) - BOX_PAD;
    const right = Math.max(...l.map((x) => x.x + x.width / 2)) + BOX_PAD;
    const top = this.originY() - BOX_PAD;
    const bottom = this.spineEnd() + BOX_PAD;
    return {
      left,
      top,
      width: right - left,
      height: bottom - top,
      right,
      bottom,
      cx: (left + right) / 2,
      cy: (top + bottom) / 2,
    };
  });

  protected readonly canEdit = computed(() => this.store.canEdit());

  // Live drag-connect preview (signal-driven so it re-renders).
  protected readonly connectFromId = signal<string | null>(null);
  protected readonly tempTo = signal<{ x: number; y: number } | null>(null);
  // Live endpoint-reattach preview.
  protected readonly endpointDragInfo = signal<{ id: string; which: 'from' | 'to' } | null>(null);
  protected readonly endpointPreview = computed(() => {
    const info = this.endpointDragInfo();
    const to = this.tempTo();
    if (!info || !to) return null;
    const m = this.msgViews().find((v) => v.id === info.id);
    if (!m) return null;
    const target = this.nearestLifeline(to.x);
    const fixedX = info.which === 'from' ? m.toX : m.fromX;
    const movingX = target ? target.x : to.x;
    return {
      leftX: Math.min(fixedX, movingX),
      width: Math.max(Math.abs(movingX - fixedX), 1),
      headX: movingX,
      dirRight: movingX >= fixedX,
      y: m.y,
    };
  });

  /**
   * Where the message will land while drawing: a horizontal arrow from the source
   * lifeline to the nearest lifeline under the cursor, snapped to the row the
   * message will occupy once dropped (so the indicator shows the real result).
   */
  protected readonly connectPreview = computed(() => {
    const id = this.connectFromId();
    const to = this.tempTo();
    if (!id || !to) return null;
    const from = this.lls().find((x) => x.id === id);
    const target = this.nearestLifeline(to.x);
    if (!from || !target) return null;
    return {
      fromX: from.x,
      toX: target.x,
      y: this.rowY(to.y),
      dirRight: target.x >= from.x,
      valid: target.id !== id,
    };
  });

  /** The eight resize-handle anchor points on the bounding box. */
  protected readonly handles = computed<{ id: Handle; x: number; y: number }[]>(() => {
    const b = this.box();
    if (!b) return [];
    return [
      { id: 'nw', x: b.left, y: b.top },
      { id: 'n', x: b.cx, y: b.top },
      { id: 'ne', x: b.right, y: b.top },
      { id: 'e', x: b.right, y: b.cy },
      { id: 'se', x: b.right, y: b.bottom },
      { id: 's', x: b.cx, y: b.bottom },
      { id: 'sw', x: b.left, y: b.bottom },
      { id: 'w', x: b.left, y: b.cy },
    ];
  });

  // ---- inline label editing ----
  protected readonly editingLifelineId = signal<string | null>(null);
  protected readonly editingMessageId = signal<string | null>(null);
  protected readonly editValue = signal('');

  private drag: Drag | null = null;

  constructor() {
    // The message toolbar's pencil requests an inline label edit; open it here
    // only if the message belongs to this diagram (and then consume the request).
    effect(() => {
      const id = this.store.pendingMessageEditId();
      if (!id) return;
      const m = this.msgViews().find((v) => v.id === id);
      if (m) {
        this.editValue.set(m.label);
        this.editingLifelineId.set(null);
        this.editingMessageId.set(id);
        this.store.clearMessageEditRequest();
      }
    });
  }

  protected headerLeft(l: LifelineModel): number {
    return l.x - l.width / 2;
  }

  protected abs(n: number): number {
    return Math.abs(n);
  }

  private zoom(): number {
    return this.store.viewport().zoom || 1;
  }

  /**
   * Begin tracking a drag on `window` (not via pointer capture): this keeps the
   * drag working when the cursor leaves the small element it started on, and is
   * robust to touch/synthetic pointers where setPointerCapture can fail.
   */
  private startDrag(): void {
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
  }
  private endDrag(): void {
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
  }

  /** Row index of each message in this diagram, for keeping rows fixed through a move/resize. */
  private startRowsMap(): Map<string, number> {
    const hb = this.headerBottom();
    const gap = this.rowSpacing();
    const out = new Map<string, number>();
    for (const m of this.msgs()) out.set(m.id, Math.max(1, Math.round((m.y - hb) / gap)));
    return out;
  }

  // ----- Bounding box: select + move this diagram -----
  protected onBoxDown(event: PointerEvent): void {
    event.stopPropagation();
    this.store.selectSequence(this.diagram().id);
    if (!this.canEdit()) return;
    this.startDrag();
    this.drag = {
      kind: 'diagram',
      startX: event.clientX,
      startY: event.clientY,
      startXs: new Map(this.lls().map((l) => [l.id, l.x])),
      startOriginY: this.originY(),
      startRows: this.startRowsMap(),
    };
  }

  // ----- Bounding box: resize from any side/corner (Shift locks, Alt centers) -----
  protected onResizeDown(event: PointerEvent, handle: Handle): void {
    event.stopPropagation();
    if (!this.canEdit()) return;
    this.store.selectSequence(this.diagram().id);
    this.startDrag();
    const l = this.lls();
    const left = l.length ? Math.min(...l.map((x) => x.x)) : 0;
    const right = l.length ? Math.max(...l.map((x) => x.x)) : 0;
    const top = this.originY();
    const nRows = this.msgs().length + 1;
    const headerH = this.headerH();
    const contentH = headerH + this.rowSpacing() * nRows;
    this.drag = {
      kind: 'resize',
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startXs: new Map(l.map((x) => [x.id, x.x])),
      startRows: this.startRowsMap(),
      left,
      right,
      centerX: (left + right) / 2,
      top,
      contentH,
      centerY: top + contentH / 2,
      headerH,
      nRows,
      startRowSpacing: this.rowSpacing(),
    };
  }

  // ----- Participant header: select + horizontal drag -----
  protected onHeaderDown(event: PointerEvent, l: LifelineModel): void {
    event.stopPropagation();
    this.store.selectLifeline(l.id);
    if (!this.canEdit() || this.editingLifelineId() === l.id) return;
    this.startDrag();
    this.drag = { kind: 'll', id: l.id, start: event.clientX, startVal: l.x };
  }

  // ----- Connect drag: start anywhere on a spine -----
  protected onConnectDown(event: PointerEvent, l: LifelineModel): void {
    event.stopPropagation();
    if (!this.canEdit()) return;
    this.startDrag();
    const fn = this.toWorld();
    const startY = fn ? fn(event.clientX, event.clientY).y : this.headerBottom();
    this.drag = { kind: 'connect', fromId: l.id, startY };
    this.connectFromId.set(l.id);
    this.tempTo.set({ x: l.x, y: startY });
  }

  protected onMove = (event: PointerEvent): void => {
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'll') {
      this.store.moveLifeline(d.id, d.startVal + (event.clientX - d.start) / this.zoom());
    } else if (d.kind === 'msg') {
      // Follow the cursor, snapped to the nearest row so spacing stays even.
      const raw = d.startY + (event.clientY - d.startClientY) / this.zoom();
      this.store.moveMessage(d.id, this.rowY(raw));
    } else if (d.kind === 'diagram') {
      this.shiftDiagram(d, event);
    } else if (d.kind === 'resize') {
      this.applyResize(d, event);
    } else if (d.kind === 'connect' || d.kind === 'endpoint') {
      const fn = this.toWorld();
      if (fn) this.tempTo.set(fn(event.clientX, event.clientY));
    }
  }

  /** Shift the whole diagram, snapping the block to the grid when grid-snap is on. */
  private shiftDiagram(d: Extract<Drag, { kind: 'diagram' }>, event: PointerEvent): void {
    let dx = (event.clientX - d.startX) / this.zoom();
    let dy = (event.clientY - d.startY) / this.zoom();
    const snap = this.snap();
    if (snap && d.startXs.size) {
      // Align the block by its leftmost spine and its origin.
      const refX = Math.min(...d.startXs.values());
      dx = snap(refX + dx) - refX;
      dy = snap(d.startOriginY + dy) - d.startOriginY;
    }
    this.store.shiftSequence(this.diagram().id, d.startXs, dx, d.startOriginY, dy, d.startRows);
  }

  /** Compute new spread + vertical size for a resize drag (Shift locks, Alt centers). */
  private applyResize(d: Extract<Drag, { kind: 'resize' }>, event: PointerEvent): void {
    const dx = (event.clientX - d.startX) / this.zoom();
    const dy = (event.clientY - d.startY) / this.zoom();
    const isLeft = d.handle.includes('w');
    const isRight = d.handle.includes('e');
    const isTop = d.handle.includes('n');
    const isBottom = d.handle.includes('s');
    const factor = event.altKey ? 2 : 1;
    const spanX = d.right - d.left;
    const horiz = (isLeft || isRight) && spanX > 1;

    let newW = horiz ? Math.max(20, spanX + (isLeft ? -dx : dx) * factor) : spanX;
    let newH =
      isTop || isBottom
        ? Math.max(d.headerH + MIN_ROW * d.nRows, d.contentH + (isTop ? -dy : dy) * factor)
        : d.contentH;

    // Shift on a corner locks proportions.
    if (event.shiftKey && horiz && (isTop || isBottom) && d.contentH > 0) {
      const scale = Math.max(newW / spanX, newH / d.contentH);
      newW = spanX * scale;
      newH = d.contentH * scale;
    }

    const scaleX = horiz ? newW / spanX : 1;
    const anchorX = event.altKey ? d.centerX : isLeft ? d.right : d.left;
    const rowSpacing = d.nRows > 0 ? Math.max(MIN_ROW, (newH - d.headerH) / d.nRows) : d.startRowSpacing;

    let originY = d.top;
    if (isTop || isBottom) {
      if (event.altKey) {
        originY = d.centerY - newH / 2;
      } else if (isTop) {
        originY = d.top + d.contentH - newH; // keep the bottom edge fixed
      }
    }
    this.store.resizeSequenceTo(
      this.diagram().id,
      d.startXs,
      anchorX,
      scaleX,
      rowSpacing,
      originY,
      d.startRows,
    );
  }

  protected onUp = (event: PointerEvent): void => {
    this.endDrag();
    const d = this.drag;
    if (d?.kind === 'connect') {
      const fn = this.toWorld();
      const w = fn ? fn(event.clientX, event.clientY) : this.tempTo();
      const target = w ? this.nearestLifeline(w.x) : null;
      if (target && target.id !== d.fromId) {
        void this.store.addMessage(this.diagram().id, d.fromId, target.id, w ? w.y : d.startY);
      }
      this.connectFromId.set(null);
      this.tempTo.set(null);
    } else if (d?.kind === 'endpoint') {
      const fn = this.toWorld();
      const w = fn ? fn(event.clientX, event.clientY) : this.tempTo();
      const target = w ? this.nearestLifeline(w.x) : null;
      if (target) {
        void this.store.updateMessage(
          d.id,
          d.which === 'from' ? { fromLifelineId: target.id } : { toLifelineId: target.id },
        );
      }
      this.endpointDragInfo.set(null);
      this.tempTo.set(null);
    } else if (d?.kind === 'msg') {
      // Finalize at the release position (robust even without intermediate moves).
      const raw = d.startY + (event.clientY - d.startClientY) / this.zoom();
      this.store.moveMessage(d.id, this.rowY(raw));
    } else if (d?.kind === 'diagram' || d?.kind === 'resize') {
      // Apply the final position once more from the release point (covers drags
      // where no intermediate pointermove fired), then persist everything.
      if (d.kind === 'diagram') {
        this.shiftDiagram(d, event);
      } else {
        this.applyResize(d, event);
      }
      for (const l of this.lls()) {
        this.store.moveLifeline(l.id, l.x);
      }
      // Messages moved with the diagram — persist their new rows too.
      for (const m of this.msgs()) {
        this.store.moveMessage(m.id, m.y);
      }
      void this.store.updateSequenceConfig(this.diagram().id, {
        rowSpacing: this.rowSpacing(),
        originY: this.originY(),
      });
    }
    this.drag = null;
  }

  /** Nearest lifeline in THIS diagram to a world x. */
  private nearestLifeline(x: number): LifelineModel | null {
    const l = this.lls();
    if (!l.length) return null;
    return l.reduce((best, cur) => (Math.abs(cur.x - x) < Math.abs(best.x - x) ? cur : best));
  }

  // ----- Inline label edit: lifeline -----
  protected startEditLifeline(event: Event, l: LifelineModel): void {
    event.stopPropagation();
    if (!this.canEdit()) return;
    this.editValue.set(l.label);
    this.editingMessageId.set(null);
    this.editingLifelineId.set(l.id);
  }
  protected commitLifeline(l: LifelineModel): void {
    if (this.editingLifelineId() !== l.id) return;
    this.editingLifelineId.set(null);
    const label = this.editValue().trim();
    if (label && label !== l.label) void this.store.updateLifeline(l.id, { label });
  }

  protected addParticipant(event: Event, side: 'left' | 'right'): void {
    event.stopPropagation();
    void this.store.addLifeline(this.diagram().id, side);
  }

  // ----- Messages: select + vertical drag (snaps to rows; rows may be shared) -----
  protected onMessageDown(event: PointerEvent, m: MessageView): void {
    event.stopPropagation();
    this.store.selectMessage(m.id);
    if (!this.canEdit() || this.editingMessageId() === m.id) return;
    this.startDrag();
    this.drag = { kind: 'msg', id: m.id, startClientY: event.clientY, startY: m.y };
  }

  // ----- Endpoint reattach: drag a message's end onto another participant -----
  protected onEndpointDown(event: PointerEvent, m: MessageView, which: 'from' | 'to'): void {
    event.stopPropagation();
    this.store.selectMessage(m.id);
    if (!this.canEdit()) return;
    this.startDrag();
    this.drag = { kind: 'endpoint', id: m.id, which };
    this.endpointDragInfo.set({ id: m.id, which });
    const fn = this.toWorld();
    this.tempTo.set(
      fn ? fn(event.clientX, event.clientY) : { x: which === 'from' ? m.fromX : m.toX, y: m.y },
    );
  }
  protected startEditMessage(event: Event, m: MessageView): void {
    event.stopPropagation();
    if (!this.canEdit()) return;
    this.editValue.set(m.label);
    this.editingLifelineId.set(null);
    this.editingMessageId.set(m.id);
  }
  protected commitMessage(m: MessageView): void {
    if (this.editingMessageId() !== m.id) return;
    this.editingMessageId.set(null);
    void this.store.updateMessage(m.id, { label: this.editValue().trim() });
  }

  protected onEditInput(value: string): void {
    this.editValue.set(value);
  }
}
