import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import {
   breakLabelMaxChars,
   isLightFill,
   isSwatchColor,
   themeColorCss,
   messageLabelLines,
   messageLabelMaxChars,
   readableTextSet,
   SEQ_LABEL_CHAR_W,
} from '@devdesigner/shared';
import {
   DEFAULT_THEME,
   presentationOf,
   resolveThemeColor,
   type LifelineModel,
   type SequenceDiagramModel,
} from '@devdesigner/shared';
import { AutofocusDirective } from '../../../../shared/ui/directives/autofocus.directive';
import { ProjectStore, SequenceLayoutSnapshot } from '../../state/project/project.store';
import type { SequenceBounds } from '../../state/project/models/project-state.model';
import { applySequenceBounds, sequenceBoundsFor, sequenceContentBox } from '../../helpers/frame-contents.helper';

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
   /** Max content width (px) of the inline editor so it wraps where the label will; null = no limit. */
   editMaxPx: number | null;
   /** The label as drawn: wrapped so it never hides the arrow (the stored label is unchanged). */
   displayLabel: string;
   dashed: boolean;
   isBreak: boolean;
   spanLeft: number;
   spanWidth: number;
   selected: boolean;
   /** Custom line + arrowhead color; empty = theme default. */
   color: string;
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
/** Smart-guide correction for a diagram drag by (dx, dy) of the given items. */
export type SmartDragFn = (
   diagramId: string,
   items: { diagrams: Iterable<string>; elements: Iterable<string>; tables: Iterable<string> },
   dx: number,
   dy: number
) => { ox: number; oy: number; snappedX: boolean; snappedY: boolean } | null;
export type SmartDragEndFn = () => void;
/** Smart-guide correction for edges of a box being resized (only `xs` / `ys` snap). */
export type SmartEdgesFn = (
   id: string,
   box: { x0: number; y0: number; x1: number; y1: number },
   xs: number[],
   ys: number[]
) => { ox: number; oy: number; snappedX: boolean; snappedY: boolean } | null;
/** Start a resize of the whole multi-selection; false when it isn't one. */
export type GroupResizeFn = (handle: string, event: PointerEvent) => boolean;
/** All eight resize handles, like any other shape. */
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Selected tables/elements that ride along when a diagram is dragged (mixed selections, groups). */
interface Companions {
   tables: Map<string, { x: number; y: number }>;
   elements: Map<string, { x: number; y: number }>;
   /** Manual routes whose both ends move, shifted rigidly with them. */
   waypoints: Map<string, { x: number; y: number }[]>;
}

type Drag =
   | { kind: 'll'; id: string; start: number; startVal: number }
   | { kind: 'llw'; id: string; side: -1 | 1; startClientX: number; startWidth: number }
   | {
        kind: 'msg';
        id: string;
        startClientY: number;
        startY: number;
        /** Start y of every message being moved (the whole selection). */
        startYs: Map<string, number>;
     }
   | {
        kind: 'diagram';
        diagramId: string;
        startX: number;
        startY: number;
        startXs: Map<string, number>;
        startOriginY: number;
        startRows: Map<string, number>;
        /** Other selected diagrams moving along with this one. */
        others: {
           diagramId: string;
           startXs: Map<string, number>;
           startOriginY: number;
           startRows: Map<string, number>;
        }[];
        /** Non-diagram selection members moving along with it. */
        companions: Companions;
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
        /** For Ctrl + resize (scale with content): the starting text scale and widths. */
        startScale: number;
        startWidths: Map<string, number>;
        /** The last Ctrl-scale applied (1 = none), so release knows to persist it. */
        scaled: number;
        /** The content box at the start (Ctrl-resize lines it up with smart guides). */
        startBox: { x0: number; y0: number; x1: number; y1: number } | null;
        /** The drawn outer box at the start (content grown by the stored bounds). */
        startOuter: { x0: number; y0: number; x1: number; y1: number } | null;
        /** Stored bounds at the start (restored when switching resize modes mid-drag). */
        startBounds: SequenceBounds;
     }
   | {
        /** Drag the gap above a message row: changes the spacing of every row. */
        kind: 'gap';
        startY: number;
        /** The row below the dragged gap (it follows the pointer). */
        row: number;
        startRowSpacing: number;
        startXs: Map<string, number>;
        startRows: Map<string, number>;
        top: number;
     }
   | { kind: 'marquee'; start: { x: number; y: number }; moved: boolean }
   | { kind: 'connect'; fromId: string; startY: number }
   | { kind: 'endpoint'; id: string; which: 'from' | 'to' };

const BOX_PAD = 26;
/** Extra room above the participants so the title (or "Add title") never crowds them; mirrored in diagram-svg + frame-contents. */
const TITLE_ROOM = 10;
const MIN_ROW = 20;
const MIN_HEADER_W = 60;
const ZERO_BOUNDS: SequenceBounds = { padLeft: 0, padTop: 0, boxWidth: 0, boxHeight: 0 };

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
   selector: 'dd-sequence-diagram',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [AutofocusDirective],
   // pointerover/out bubble from every child (box, headers, spines, messages, buttons).
   host: {
      '(pointerover)': 'addHover(true)',
      '(pointerout)': 'addHover(false)',
      // Message labels sit on the diagram's own background so they blend with it.
      // Text, label boxes and arrowheads are drawn at the diagram's scale (Ctrl + resize).
      '[style.--seq-k]': 'diagram().scale ?? 1',
      '[style.--seq-bg]': 'css(diagram().backgroundColor)',
      '[style.--seq-border]': 'css(diagram().borderColor)',
      '[style.--seq-fg]': 'fg()?.text || null',
      '[style.--seq-fg-muted]': 'fg()?.muted || null',
      '[style.--seq-fg-soft]': 'fg()?.soft || null',
      '[style.--seq-spine]': 'fg() ? "color-mix(in srgb, " + fg()!.muted + " 55%, transparent)" : null',
   },
   templateUrl: './sequence-diagram.component.html',
   styleUrl: './sequence-diagram.component.scss',
})
export class SequenceDiagramComponent {
   protected readonly store = inject(ProjectStore);
   /** True for custom pale participant colors, which take dark text instead of white. Stock swatches use the theme text. */
   protected readonly isLight = (c: string | undefined | null): boolean => {
      const color = this.themed(c);
      return !isSwatchColor(color) && isLightFill(color);
   };
   protected readonly isSwatch = (c: string | undefined | null): boolean => isSwatchColor(this.themed(c));
   /** CSS for a stored color (resolves the theme sentinels). */
   protected readonly css = (c: string | undefined | null) => themeColorCss(this.themed(c));

   /** The id of the diagram this instance renders. */
   readonly diagramId = input.required<string>();
   /** Screen→world mapping supplied by the editor (for drag-connect drop targets). */
   readonly toWorld = input<WorldFn | null>(null);
   /** Snap a world coordinate to the grid (identity when grid-snap is off). */
   readonly snap = input<SnapFn | null>(null);
   /** Smart-guide snapping against nearby items, supplied by the editor. */
   readonly smartDrag = input<SmartDragFn | null>(null);
   readonly smartDragEnd = input<SmartDragEndFn | null>(null);
   readonly smartEdges = input<SmartEdgesFn | null>(null);
   /** Editor hook: resize the whole multi-selection together (false when not multi). */
   readonly groupResize = input<GroupResizeFn | null>(null);

   /**
    * This diagram's record, read straight from the store signal (not via an input)
    * so a config change — including one made from a window-listener drag — re-renders
    * this component the same way a lifeline change does.
    */
   /** The diagram's text / arrowhead scale (Ctrl + resize). */
   protected readonly k = computed(() => this.diagram().scale ?? 1);

   protected readonly diagram = computed<SequenceDiagramModel>(
      () =>
         this.store.sequenceDiagrams().find((d) => d.id === this.diagramId()) ?? {
            id: this.diagramId(),
            lifelineSpacing: 160,
            rowSpacing: 48,
            headerHeight: 42,
            originY: 0,
            zIndex: -1,
         }
   );

   /** The deck theme of the slide this diagram is on. */
   private readonly deckTheme = computed(() => {
      const frame = this.store.slideFrames().find((f) => f.id === this.diagram().slideId);
      return (frame && this.store.presentationThemes().get(presentationOf(frame))) || DEFAULT_THEME;
   });
   /** A stored color with theme tokens resolved. */
   private themed<C extends string | undefined | null>(c: C): C | string {
      return c ? resolveThemeColor(c, this.deckTheme()) : c;
   }

   /** Text colors that stay readable on a custom background; null = theme defaults. */
   protected readonly fg = computed(() => readableTextSet(this.themed(this.diagram().backgroundColor) ?? undefined));

   protected readonly originY = computed(() => this.diagram().originY);
   protected readonly headerH = computed(() => this.diagram().headerHeight);
   protected readonly headerBottom = computed(() => this.originY() + this.headerH());
   protected readonly rowSpacing = computed(() => this.diagram().rowSpacing);

   /** This diagram's lifelines, left-to-right. */
   protected readonly lls = computed(() =>
      this.store
         .lifelines()
         .filter((l) => l.diagramId === this.diagram().id)
         .sort((a, b) => a.x - b.x)
   );
   private readonly msgs = computed(() =>
      this.store.sequenceMessages().filter((m) => m.diagramId === this.diagram().id)
   );

   protected readonly selectedLifelineIds = computed(() => new Set(this.store.selectedLifelineIds()));
   protected readonly sequenceSelected = computed(() => this.store.selectedDiagramIds().includes(this.diagram().id));
   /** In a group that hasn't been entered: parts act as the whole group, not individually. */
   private groupLocked(): boolean {
      const gid = this.store.groupIdOf(this.diagram().id);
      return !!gid && gid !== this.store.enteredGroupId();
   }

   /** Resize handles show when this diagram is selected (alone, or with others to scale together). */
   protected readonly soleSelected = computed(
      () => this.store.selectedDiagramId() === this.diagram().id || this.sequenceSelected()
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
            editMaxPx: this.editMaxPx(m.wrap !== false, isBreak, (isBreak ? maxX - minX : Math.abs(toX - fromX)) / this.k()),
            displayLabel: messageLabelLines(
               m.label ?? '',
               // Wider glyphs at a larger scale: wrap as if the span were that much narrower.
               (isBreak ? maxX - minX : Math.abs(toX - fromX)) / this.k(),
               isBreak,
               m.wrap !== false
            ).join('\n'),
            dashed: m.style === 'dashed',
            isBreak,
            spanLeft: minX,
            spanWidth: Math.max(maxX - minX, 1),
            selected: sel.has(m.id),
            color: m.color ?? '',
         });
      });
      return out;
   });

   /** Width the inline editor wraps at, mirroring how the finished label wraps. */
   private editMaxPx(wrap: boolean, isBreak: boolean, span: number): number | null {
      if (!wrap) return null;
      return (
         (isBreak
            ? breakLabelMaxChars(span) * (SEQ_LABEL_CHAR_W + 0.44)
            : messageLabelMaxChars(span) * SEQ_LABEL_CHAR_W) * this.k()
      );
   }

   /** Highest occupied row, for sizing the spines and box. */
   protected readonly maxRow = computed(() => {
      const hb = this.headerBottom();
      const gap = this.rowSpacing();
      const rows = this.msgs().map((m) => Math.max(1, Math.round((m.y - hb) / gap)));
      return rows.length ? Math.max(...rows) : 0;
   });

   /** Content spine end: one row past the lowest message, leaving room below. */
   private readonly contentSpineEnd = computed(
      () => this.headerBottom() + this.rowSpacing() * (this.maxRow() + 1)
   );

   /** Rounded bounding box around this diagram (for move/resize/select); may be bigger than its content. */
   protected readonly box = computed<BoundingBox | null>(() => {
      const l = this.lls();
      if (!l.length) return null;
      const b = applySequenceBounds(this.diagram(), {
         x0: Math.min(...l.map((x) => x.x - x.width / 2)) - BOX_PAD,
         x1: Math.max(...l.map((x) => x.x + x.width / 2)) + BOX_PAD,
         y0: this.originY() - BOX_PAD - TITLE_ROOM,
         y1: this.contentSpineEnd() + BOX_PAD,
      });
      const { x0: left, x1: right, y0: top, y1: bottom } = b;
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

   /** Spines run to the bottom of the box (which a plain resize can make taller than the content). */
   protected readonly spineEnd = computed(() => (this.box()?.bottom ?? this.contentSpineEnd() + BOX_PAD) - BOX_PAD);

   /**
    * Invisible bands across the gaps above each occupied message row (drag one to change
    * the row spacing; the row below follows the pointer). Active when the diagram is selected.
    */
   protected readonly gaps = computed<{ row: number; y: number; x: number; w: number }[]>(() => {
      const b = this.box();
      if (!b) return [];
      const hb = this.headerBottom();
      const gap = this.rowSpacing();
      const rows = [...new Set(this.msgs().map((m) => Math.max(1, Math.round((m.y - hb) / gap))))].sort(
         (a, c) => a - c
      );
      return rows.map((row, i) => ({
         row,
         y: hb + (gap * ((i ? rows[i - 1] : 0) + row)) / 2,
         x: b.left + BOX_PAD / 2,
         w: b.width - BOX_PAD,
      }));
   });

   protected readonly canEdit = computed(() => this.store.canEdit());
   /** Endpoint handles only make sense for a single selected message. */
   protected readonly singleMessage = computed(() => this.store.selectedMessageIds().length === 1);

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
   /** The diagram title is being edited inline (draft lives in `editValue`). */
   protected readonly editingTitle = signal(false);
   protected readonly title = computed(() => this.diagram().title ?? '');

   private drag: Drag | null = null;
   /** Alt-drag duplication state: set once the drag has switched to a copy. */
   private dragCopied = false;
   private duplicating = false;
   private lastPointer: PointerEvent | null = null;

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
      // Same for the participant toolbar's pencil (a lifeline inline rename).
      effect(() => {
         const id = this.store.pendingLifelineEditId();
         if (!id) return;
         const l = this.lls().find((x) => x.id === id);
         if (l) {
            this.editValue.set(l.label);
            this.editingMessageId.set(null);
            this.editingLifelineId.set(id);
            this.store.clearLifelineEditRequest();
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
      this.dragCopied = false;
      this.duplicating = false;
      this.lastPointer = null;
      window.addEventListener('keydown', this.onKey);
      window.addEventListener('pointermove', this.onMove);
      window.addEventListener('pointerup', this.onUp);
      window.addEventListener('pointercancel', this.onUp);
   }
   private endDrag(): void {
      window.removeEventListener('keydown', this.onKey);
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

   /** Layout at gesture start, recorded for undo when a move/resize ends. */
   private layoutBefore: SequenceLayoutSnapshot | null = null;
   /** Same, for the other diagrams moved along in a group drag. */
   private othersBefore = new Map<string, SequenceLayoutSnapshot>();

   private snapshotLayout(diagramId: string): SequenceLayoutSnapshot {
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
         headerHeight: cfg?.headerHeight,
         scale: cfg?.scale ?? 1,
         lifelineWidths: new Map(
            this.store
               .lifelines()
               .filter((l) => l.diagramId === diagramId)
               .map((l) => [l.id, l.width])
         ),
         bounds: this.boundsOf(cfg),
      };
   }

   private boundsOf(cfg: SequenceDiagramModel | undefined): SequenceBounds {
      return {
         padLeft: cfg?.padLeft ?? 0,
         padTop: cfg?.padTop ?? 0,
         boxWidth: cfg?.boxWidth ?? 0,
         boxHeight: cfg?.boxHeight ?? 0,
      };
   }

   /** The diagram's content box right now (no stored bounds). */
   private contentBox(): { x0: number; y0: number; x1: number; y1: number } | null {
      return sequenceContentBox(this.diagram(), this.store.lifelines(), this.store.sequenceMessages());
   }

   // ----- Bounding box: select + move this diagram -----
   protected onBoxDown(event: PointerEvent): void {
      event.stopPropagation();
      const id = this.diagram().id;
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
         const fn = this.toWorld();
         if (event.shiftKey && !event.ctrlKey && !event.metaKey && fn) {
            // Shift+drag inside the diagram marquee-selects its messages; a plain
            // shift-click (no movement) still toggles the diagram, decided on release.
            const p = fn(event.clientX, event.clientY);
            this.startDrag();
            this.drag = { kind: 'marquee', start: p, moved: false };
            this.marqueeEnd.set(p);
            return;
         }
         // Toggle into/out of the selection; no drag so the gesture stays a pure click.
         this.store.toggleSequence(id);
         return;
      }
      // Pressing an already-selected diagram keeps the group so it can be dragged together.
      if (!this.store.selectedDiagramIds().includes(id)) this.store.selectSequence(id);
      if (!this.canEdit()) return;
      const others = this.store
         .selectedDiagramIds()
         .filter((x) => x !== id)
         .map((x) => this.store.sequenceDiagramSnapshot(x))
         .filter((x) => x !== null);
      this.layoutBefore = this.snapshotLayout(id);
      this.othersBefore = new Map(others.map((o) => [o.diagramId, this.snapshotLayout(o.diagramId)]));
      this.startDrag();
      this.drag = {
         others,
         companions: this.captureCompanions(),
         kind: 'diagram',
         diagramId: this.diagram().id,
         startX: event.clientX,
         startY: event.clientY,
         startXs: new Map(this.lls().map((l) => [l.id, l.x])),
         startOriginY: this.originY(),
         startRows: this.startRowsMap(),
      };
      if (event.altKey) void this.duplicateDrag();
   }

   // ----- Bounding box: resize from any side/corner (Shift locks, Alt centers) -----
   protected onResizeDown(event: PointerEvent, handle: Handle): void {
      event.stopPropagation();
      if (!this.canEdit()) return;
      if (this.groupResize()?.(handle, event)) return;
      this.store.selectSequence(this.diagram().id);
      this.layoutBefore = this.snapshotLayout(this.diagram().id);
      this.startDrag();
      const l = this.lls();
      const left = l.length ? Math.min(...l.map((x) => x.x)) : 0;
      const right = l.length ? Math.max(...l.map((x) => x.x)) : 0;
      const top = this.originY();
      const nRows = this.msgs().length + 1;
      const headerH = this.headerH();
      const contentH = headerH + this.rowSpacing() * nRows;
      const content = this.contentBox();
      this.drag = {
         kind: 'resize',
         handle,
         startX: event.clientX,
         startY: event.clientY,
         startXs: new Map(l.map((x) => [x.id, x.x])),
         startWidths: new Map(l.map((x) => [x.id, x.width])),
         startScale: this.diagram().scale ?? 1,
         scaled: 1,
         startBox: content,
         startOuter: content ? applySequenceBounds(this.diagram(), content) : null,
         startBounds: this.boundsOf(this.diagram()),
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

   /** Double-click a side/corner: shrink the box back to its content on that axis (like grid tables). */
   protected onHandleDblClick(event: MouseEvent, handle: Handle): void {
      event.stopPropagation();
      if (!this.canEdit()) return;
      this.store.fitSequenceToContent(this.diagram().id, {
         x: /[ew]/.test(handle),
         y: /[ns]/.test(handle),
      });
   }

   // ----- Row gap: drag to change the spacing between messages (box grows only if needed) -----
   protected onGapDown(event: PointerEvent, row: number): void {
      event.stopPropagation();
      if (!this.canEdit()) return;
      this.layoutBefore = this.snapshotLayout(this.diagram().id);
      this.startDrag();
      this.drag = {
         kind: 'gap',
         startY: event.clientY,
         row,
         startRowSpacing: this.rowSpacing(),
         startXs: new Map(this.lls().map((l) => [l.id, l.x])),
         startRows: this.startRowsMap(),
         top: this.originY(),
      };
   }

   private applyGap(d: Extract<Drag, { kind: 'gap' }>, event: PointerEvent): void {
      const dy = (event.clientY - d.startY) / this.zoom();
      const row = Math.max(1, d.row);
      let spacing = Math.max(MIN_ROW, d.startRowSpacing + dy / row);
      const snap = this.snap();
      if (snap) {
         // Land the dragged row on the grid.
         const hb = d.top + this.headerH();
         spacing = Math.max(MIN_ROW, (snap(hb + spacing * row) - hb) / row);
      }
      this.store.resizeSequenceTo(this.diagram().id, d.startXs, 0, 1, spacing, d.top, d.startRows);
   }

   // ----- Participant header: select + horizontal drag -----
   protected onHeaderDown(event: PointerEvent, l: LifelineModel): void {
      if (this.groupLocked()) {
         this.onBoxDown(event);
         return;
      }
      event.stopPropagation();
      this.store.selectLifeline(l.id);
      if (!this.canEdit() || this.editingLifelineId() === l.id) return;
      this.startDrag();
      this.drag = { kind: 'll', id: l.id, start: event.clientX, startVal: l.x };
      if (event.altKey) void this.duplicateDrag();
   }

   // ----- Participant header: drag a side handle to widen/narrow it (symmetric about the spine) -----
   protected onWidthDown(event: PointerEvent, l: LifelineModel, side: -1 | 1): void {
      event.stopPropagation();
      if (!this.canEdit()) return;
      this.startDrag();
      this.drag = { kind: 'llw', id: l.id, side, startClientX: event.clientX, startWidth: l.width };
   }

   private applyWidth(d: Extract<Drag, { kind: 'llw' }>, clientX: number): void {
      const dx = ((clientX - d.startClientX) / this.zoom()) * d.side;
      let w = Math.max(MIN_HEADER_W, d.startWidth + dx * 2);
      const snap = this.snap();
      if (snap) w = Math.max(MIN_HEADER_W, Math.round(snap(w)));
      this.store.setLifelineWidthLocal(d.id, Math.round(w));
   }

   // ----- Connect drag: start anywhere on a spine -----
   protected onConnectDown(event: PointerEvent, l: LifelineModel): void {
      if (this.groupLocked()) {
         this.onBoxDown(event);
         return;
      }
      event.stopPropagation();
      if (!this.canEdit()) return;
      this.startDrag();
      const fn = this.toWorld();
      const startY = fn ? fn(event.clientX, event.clientY).y : this.headerBottom();
      this.drag = { kind: 'connect', fromId: l.id, startY };
      this.connectFromId.set(l.id);
      this.tempTo.set({ x: l.x, y: startY });
   }

   /** Pressing Alt mid-drag switches from moving the original to dragging a copy. */
   private onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Alt') {
         event.preventDefault(); // keep Alt from focusing the browser menu
         void this.duplicateDrag();
      }
   };

   /**
    * Leave the original where the drag began and continue the drag on a fresh copy
    * (diagram, participant or message). The copy is positioned from the same drag
    * origin, so it jumps to the cursor.
    */
   private async duplicateDrag(): Promise<void> {
      const d = this.drag;
      if (!d || this.dragCopied || this.duplicating || !this.canEdit()) return;
      if (d.kind !== 'diagram' && d.kind !== 'll' && d.kind !== 'msg') return;
      if (d.kind === 'diagram' && (d.others.length || d.companions.tables.size || d.companions.elements.size)) {
         return; // no group duplication
      }
      this.duplicating = true;
      let next: Drag | null = null;
      if (d.kind === 'diagram') {
         // Put the original back (it only moved locally), then clone it in place.
         this.store.shiftSequence(d.diagramId, d.startXs, 0, d.startOriginY, 0, d.startRows);
         const id = this.store.cloneItems(new Set(), new Set([d.diagramId]), [], 0, 0).diagrams.get(d.diagramId);
         if (id) this.store.setSelection([], [], [], [], [], [id]);
         const copy = this.store.sequenceDiagrams().find((x) => x.id === id);
         if (id && copy) {
            const base = copy.originY + copy.headerHeight;
            const startRows = new Map<string, number>();
            for (const m of this.store.sequenceMessages().filter((x) => x.diagramId === id)) {
               startRows.set(m.id, Math.max(1, Math.round((m.y - base) / copy.rowSpacing)));
            }
            next = {
               ...d,
               diagramId: id,
               startXs: new Map(
                  this.store
                     .lifelines()
                     .filter((l) => l.diagramId === id)
                     .map((l) => [l.id, l.x])
               ),
               startOriginY: copy.originY,
               startRows,
            };
         }
      } else if (d.kind === 'll') {
         this.store.moveLifeline(d.id, d.startVal);
         const id = await this.store.duplicateLifeline(d.id, 0);
         if (id) next = { ...d, id };
      } else {
         // Alt-drag copies just the grabbed message: put the whole group back first.
         for (const [mid, y] of d.startYs) this.store.moveMessage(mid, y);
         const id = await this.store.duplicateMessage(d.id, 0);
         if (id) next = { ...d, id, startYs: new Map([[id, d.startY]]) };
      }
      this.duplicating = false;
      if (this.drag !== d) return; // released while the copy was being created
      if (!next) return;
      this.dragCopied = true;
      this.drag = next;
      if (this.lastPointer) this.onMove(this.lastPointer);
   }

   // Live message-marquee rectangle (world coords).
   private readonly marqueeEnd = signal<{ x: number; y: number } | null>(null);
   private marqueeStart: { x: number; y: number } | null = null;
   protected readonly marqueeRect = computed(() => {
      const e = this.marqueeEnd();
      const s = this.marqueeStart;
      if (!e || !s) return null;
      const left = Math.min(s.x, e.x);
      const top = Math.min(s.y, e.y);
      return { left, top, width: Math.abs(e.x - s.x), height: Math.abs(e.y - s.y) };
   });

   /** Select the messages of this diagram whose line crosses the rect (added to the current selection). */
   private selectMessagesIn(rect: { left: number; top: number; width: number; height: number }): void {
      const right = rect.left + rect.width;
      const bottom = rect.top + rect.height;
      const hits = this.msgViews()
         .filter((m) => {
            const l = m.isBreak ? m.spanLeft : m.leftX;
            const r = l + (m.isBreak ? m.spanWidth : m.width);
            return l <= right && r >= rect.left && m.y >= rect.top && m.y <= bottom;
         })
         .map((m) => m.id);
      if (!hits.length) return;
      const id = this.diagram().id;
      this.store.setSelection(
         this.store.selectedTableIds(),
         this.store.selectedRelationshipIds(),
         this.store.selectedElementIds(),
         [...new Set([...this.store.selectedMessageIds(), ...hits])],
         this.store.selectedLifelineIds(),
         this.store.selectedDiagramIds().filter((x) => x !== id)
      );
   }

   protected onMove = (event: PointerEvent): void => {
      this.lastPointer = event;
      const d = this.drag;
      if (!d || this.duplicating) return;
      if (d.kind === 'marquee') {
         const fn = this.toWorld();
         if (!fn) return;
         const p = fn(event.clientX, event.clientY);
         if (Math.hypot(p.x - d.start.x, p.y - d.start.y) * this.zoom() > 4) d.moved = true;
         if (d.moved) {
            this.marqueeStart = d.start;
            this.marqueeEnd.set(p);
         }
         return;
      }
      if (d.kind === 'll') {
         this.store.moveLifeline(d.id, d.startVal + (event.clientX - d.start) / this.zoom());
      } else if (d.kind === 'llw') {
         this.applyWidth(d, event.clientX);
      } else if (d.kind === 'msg') {
         // Follow the cursor, snapped to the nearest row so spacing stays even.
         this.moveMessages(d, event.clientY);
      } else if (d.kind === 'diagram') {
         this.shiftDiagram(d, event);
      } else if (d.kind === 'resize') {
         this.applyResize(d, event);
      } else if (d.kind === 'gap') {
         this.applyGap(d, event);
      } else if (d.kind === 'connect' || d.kind === 'endpoint') {
         const fn = this.toWorld();
         if (fn) this.tempTo.set(fn(event.clientX, event.clientY));
      }
   };

   /** Shift the whole diagram, snapping the block to the grid when grid-snap is on. */
   private shiftDiagram(d: Extract<Drag, { kind: 'diagram' }>, event: PointerEvent): void {
      // A plain click (pointer within jitter range) must not snap an unaligned diagram.
      if (Math.hypot(event.clientX - d.startX, event.clientY - d.startY) < 3) return;
      let dx = (event.clientX - d.startX) / this.zoom();
      let dy = (event.clientY - d.startY) / this.zoom();
      const smart = this.smartDrag()?.(
         d.diagramId,
         {
            diagrams: [d.diagramId, ...d.others.map((o) => o.diagramId)],
            elements: d.companions.elements.keys(),
            tables: d.companions.tables.keys(),
         },
         dx,
         dy
      );
      dx += smart?.ox ?? 0;
      dy += smart?.oy ?? 0;
      const snap = this.snap();
      if (snap && d.startXs.size) {
         // Align the block by its leftmost spine and its origin (axes a smart guide caught stay put).
         const refX = Math.min(...d.startXs.values());
         if (!smart?.snappedX) dx = snap(refX + dx) - refX;
         if (!smart?.snappedY) dy = snap(d.startOriginY + dy) - d.startOriginY;
      }
      this.store.shiftSequence(d.diagramId, d.startXs, dx, d.startOriginY, dy, d.startRows);
      for (const o of d.others) {
         this.store.shiftSequence(o.diagramId, o.startXs, dx, o.startOriginY, dy, o.startRows);
      }
      this.moveCompanions(d.companions, dx, dy);
   }

   /** Snapshot the selected tables/elements (and routes between them) to drag with the diagram. */
   private captureCompanions(): Companions {
      const tableIds = new Set(this.store.selectedTableIds());
      const elementIds = new Set(this.store.selectedElementIds());
      const tables = new Map(
         this.store
            .tables()
            .filter((t) => tableIds.has(t.id))
            .map((t) => [t.id, { x: t.x, y: t.y }] as const)
      );
      const elements = new Map(
         this.store
            .elements()
            .filter((e) => elementIds.has(e.id))
            .map((e) => [e.id, { x: e.x, y: e.y }] as const)
      );
      const waypoints = new Map<string, { x: number; y: number }[]>();
      if (tables.size > 1) {
         const owner = new Map<string, string>();
         for (const t of this.store.tables()) for (const c of t.columns) owner.set(c.id, t.id);
         for (const r of this.store.relationships()) {
            const a = owner.get(r.sourceColumnId);
            const b = owner.get(r.targetColumnId);
            if (a && b && tables.has(a) && tables.has(b) && r.waypoints?.length) {
               waypoints.set(
                  r.id,
                  r.waypoints.map((w) => ({ ...w }))
               );
            }
         }
      }
      return { tables, elements, waypoints };
   }

   private moveCompanions(c: Companions, dx: number, dy: number): void {
      const by = (p: { x: number; y: number }) => ({ x: Math.round(p.x + dx), y: Math.round(p.y + dy) });
      this.store.moveItemsLocal({
         tables: new Map([...c.tables].map(([id, p]) => [id, by(p)])),
         elements: new Map([...c.elements].map(([id, p]) => [id, by(p)])),
         waypoints: new Map([...c.waypoints].map(([id, wp]) => [id, wp.map(by)])),
      });
   }

   /**
    * Ctrl-resize: the scale at which the dragged edge of the drawn box lands on a smart
    * guide, or null when nothing snaps. The box is modelled as a function of the scale
    * (lifelines, header and rows scale about the anchor; the outer padding does not),
    * which is linear in k, so a snapped edge position inverts straight to a scale.
    */
   private smartScale(
      d: Extract<Drag, { kind: 'resize' }>,
      k: number,
      centred: boolean,
      horiz: boolean,
      isLeft: boolean,
      vert: boolean,
      isTop: boolean
   ): number | null {
      const hook = this.smartEdges();
      const b0 = d.startBox;
      if (!hook || !b0) return null;
      const anchorX = centred ? d.centerX : isLeft ? d.right : d.left;
      const below = b0.y1 - BOX_PAD - d.top; // origin -> bottom edge, minus the padding
      const above = d.top - b0.y0; // padding + title room above the origin (fixed)
      const box = (s: number) => {
         const originY = centred ? d.centerY - (d.contentH * s) / 2 : isTop ? d.top + d.contentH - d.contentH * s : d.top;
         return {
            x0: anchorX + (b0.x0 + BOX_PAD - anchorX) * s - BOX_PAD,
            x1: anchorX + (b0.x1 - BOX_PAD - anchorX) * s + BOX_PAD,
            y0: originY - above,
            y1: originY + below * s + BOX_PAD,
         };
      };
      const now = box(k);
      const ex = isLeft ? 'x0' : 'x1';
      const ey = isTop ? 'y0' : 'y1';
      const snap = hook(this.diagram().id, now, horiz ? [now[ex]] : [], vert ? [now[ey]] : []);
      const invert = (edge: 'x0' | 'x1' | 'y0' | 'y1', target: number): number | null => {
         const at0 = box(0)[edge];
         const slope = box(1)[edge] - at0;
         return Math.abs(slope) > 1e-6 ? (target - at0) / slope : null;
      };
      if (snap?.snappedX) return invert(ex, now[ex] + snap.ox);
      if (snap?.snappedY) return invert(ey, now[ey] + snap.oy);
      return null;
   }

   /**
    * A resize drag. Plain: the box grows/shrinks around the content (never below it)
    * and the spacing is untouched. Alt: the content is respaced to fill the box (the
    * participants spread and the rows stretch). Ctrl: everything scales together.
    * Shift locks proportions.
    */
   private applyResize(d: Extract<Drag, { kind: 'resize' }>, event: PointerEvent): void {
      const ctrl = event.ctrlKey || event.metaKey;
      if (!ctrl && !event.altKey) {
         this.applyBoundsResize(d, event);
         return;
      }
      // Respacing / scaling: the box hugs the content again (Ctrl scales the bounds along).
      this.store.setSequenceBoundsLocal(this.diagram().id, ctrl ? d.startBounds : ZERO_BOUNDS);
      this.applyRespaceResize(d, event);
   }

   /** Plain resize: move the dragged edges of the outer box, clamped to the content. */
   private applyBoundsResize(d: Extract<Drag, { kind: 'resize' }>, event: PointerEvent): void {
      const c = d.startBox;
      const b0 = d.startOuter;
      if (!c || !b0) return;
      // Undo any Alt / Ctrl change made earlier in this drag.
      if (d.scaled !== 1) {
         d.scaled = 1;
         this.store.scaleSequenceLocal(this.diagram().id, d.headerH, d.startScale, d.startWidths);
      }
      this.store.resizeSequenceTo(this.diagram().id, d.startXs, 0, 1, d.startRowSpacing, d.top, d.startRows);
      const dx = (event.clientX - d.startX) / this.zoom();
      const dy = (event.clientY - d.startY) / this.zoom();
      const isLeft = d.handle.includes('w');
      const isRight = d.handle.includes('e');
      const isTop = d.handle.includes('n');
      const isBottom = d.handle.includes('s');
      const b = { ...b0 };
      if (isLeft) b.x0 += dx;
      if (isRight) b.x1 += dx;
      if (isTop) b.y0 += dy;
      if (isBottom) b.y1 += dy;
      if (event.shiftKey && (isLeft || isRight) && (isTop || isBottom)) {
         const w0 = b0.x1 - b0.x0;
         const h0 = b0.y1 - b0.y0;
         const k = Math.max((b.x1 - b.x0) / w0, (b.y1 - b.y0) / h0);
         if (isLeft) b.x0 = b0.x1 - w0 * k;
         else b.x1 = b0.x0 + w0 * k;
         if (isTop) b.y0 = b0.y1 - h0 * k;
         else b.y1 = b0.y0 + h0 * k;
      } else {
         // Smart guides, then the grid, on the dragged edges.
         const xs = isLeft ? [b.x0] : isRight ? [b.x1] : [];
         const ys = isTop ? [b.y0] : isBottom ? [b.y1] : [];
         const smart = this.smartEdges()?.(this.diagram().id, b, xs, ys);
         const snap = this.snap();
         const fix = (v: number, snapped: boolean | undefined, off: number) =>
            snapped ? v + off : snap ? snap(v) : v;
         if (isLeft) b.x0 = fix(b.x0, smart?.snappedX, smart?.ox ?? 0);
         if (isRight) b.x1 = fix(b.x1, smart?.snappedX, smart?.ox ?? 0);
         if (isTop) b.y0 = fix(b.y0, smart?.snappedY, smart?.oy ?? 0);
         if (isBottom) b.y1 = fix(b.y1, smart?.snappedY, smart?.oy ?? 0);
      }
      // Never smaller than the content.
      b.x0 = Math.min(b.x0, c.x0);
      b.y0 = Math.min(b.y0, c.y0);
      b.x1 = Math.max(b.x1, c.x1);
      b.y1 = Math.max(b.y1, c.y1);
      this.store.setSequenceBoundsLocal(this.diagram().id, sequenceBoundsFor(c, b));
   }

   /** Alt / Ctrl resize: new spread + vertical size for the content itself (Shift locks). */
   private applyRespaceResize(d: Extract<Drag, { kind: 'resize' }>, event: PointerEvent): void {
      const dx = (event.clientX - d.startX) / this.zoom();
      const dy = (event.clientY - d.startY) / this.zoom();
      const isLeft = d.handle.includes('w');
      const isRight = d.handle.includes('e');
      const isTop = d.handle.includes('n');
      const isBottom = d.handle.includes('s');
      // Alt now selects respacing, so it no longer resizes from the center.
      const centred = false;
      const factor = 1;
      const spanX = d.right - d.left;
      const horiz = (isLeft || isRight) && spanX > 1;

      let newW = horiz ? Math.max(20, spanX + (isLeft ? -dx : dx) * factor) : spanX;
      let newH =
         isTop || isBottom
            ? Math.max(d.headerH + MIN_ROW * d.nRows, d.contentH + (isTop ? -dy : dy) * factor)
            : d.contentH;

      // Ctrl (Cmd): scale the diagram with its content — spacing, header boxes and text
      // all grow or shrink together, proportions kept (like Ctrl + resize on shapes).
      if ((event.ctrlKey || event.metaKey) && d.contentH > 0) {
         const kx = horiz ? newW / spanX : 0;
         const ky = isTop || isBottom ? newH / d.contentH : 0;
         let k = Math.max(kx, ky) || 1;
         // Never below a readable size or the minimum row height.
         k = Math.max(k, 0.3 / d.startScale, MIN_ROW / Math.max(1, d.startRowSpacing));
         k = Math.min(k, 8 / d.startScale);
         k = this.smartScale(d, k, centred, horiz, isLeft, isTop || isBottom, isTop) ?? k;
         k = Math.max(k, 0.3 / d.startScale, MIN_ROW / Math.max(1, d.startRowSpacing));
         k = Math.min(k, 8 / d.startScale);
         const anchorX = centred ? d.centerX : isLeft ? d.right : d.left;
         const newContent = d.contentH * k;
         const originY = centred ? d.centerY - newContent / 2 : isTop ? d.top + d.contentH - newContent : d.top;
         d.scaled = k;
         this.store.scaleSequenceLocal(
            this.diagram().id,
            d.headerH * k,
            d.startScale * k,
            new Map([...d.startWidths].map(([id, w]) => [id, Math.round(w * k)]))
         );
         // Extra room around the content scales along with it.
         this.store.setSequenceBoundsLocal(this.diagram().id, {
            padLeft: Math.round(d.startBounds.padLeft * k),
            padTop: Math.round(d.startBounds.padTop * k),
            boxWidth: Math.round(d.startBounds.boxWidth * k),
            boxHeight: Math.round(d.startBounds.boxHeight * k),
         });
         this.store.resizeSequenceTo(this.diagram().id, d.startXs, anchorX, spanX > 1 ? k : 1, d.startRowSpacing * k, originY, d.startRows);
         return;
      }
      this.smartDragEnd()?.();
      if (d.scaled !== 1) {
         // Ctrl let go mid-drag: back to the starting content size.
         d.scaled = 1;
         this.store.scaleSequenceLocal(this.diagram().id, d.headerH, d.startScale, d.startWidths);
      }

      // Shift on a corner locks proportions.
      if (event.shiftKey && horiz && (isTop || isBottom) && d.contentH > 0) {
         const scale = Math.max(newW / spanX, newH / d.contentH);
         newW = spanX * scale;
         newH = d.contentH * scale;
      }

      // Grid snap: land the dragged edge(s) on the grid (skipped when Shift locks
      // proportions, since snapping each axis would break the ratio).
      const snap = this.snap();
      if (snap && !event.shiftKey) {
         const minH = d.headerH + MIN_ROW * d.nRows;
         if (horiz) {
            if (centred) {
               newW = Math.max(20, 2 * Math.abs(snap(d.centerX + newW / 2) - d.centerX));
            } else if (isRight) {
               newW = Math.max(20, snap(d.left + newW) - d.left);
            } else {
               newW = Math.max(20, d.right - snap(d.right - newW));
            }
         }
         if (isTop || isBottom) {
            if (centred) {
               newH = Math.max(minH, 2 * Math.abs(snap(d.centerY + newH / 2) - d.centerY));
            } else if (isBottom) {
               newH = Math.max(minH, snap(d.top + newH) - d.top);
            } else {
               const bottom = d.top + d.contentH;
               newH = Math.max(minH, bottom - snap(bottom - newH));
            }
         }
      }

      const scaleX = horiz ? newW / spanX : 1;
      const anchorX = centred ? d.centerX : isLeft ? d.right : d.left;
      const rowSpacing = d.nRows > 0 ? Math.max(MIN_ROW, (newH - d.headerH) / d.nRows) : d.startRowSpacing;

      let originY = d.top;
      if (isTop || isBottom) {
         if (centred) {
            originY = d.centerY - newH / 2;
         } else if (isTop) {
            originY = d.top + d.contentH - newH; // keep the bottom edge fixed
         }
      }
      this.store.resizeSequenceTo(this.diagram().id, d.startXs, anchorX, scaleX, rowSpacing, originY, d.startRows);
   }

   protected onUp = (event: PointerEvent): void => {
      this.endDrag();
      const d = this.drag;
      if (this.duplicating) {
         // Released before the copy existed: leave the original put and the copy in place.
         if (d?.kind === 'diagram') this.smartDragEnd()?.();
         this.drag = null;
         return;
      }
      if (d?.kind === 'marquee') {
         const rect = d.moved ? this.marqueeRect() : null;
         this.marqueeEnd.set(null);
         this.marqueeStart = null;
         if (rect) this.selectMessagesIn(rect);
         else this.store.toggleSequence(this.diagram().id);
      } else if (d?.kind === 'llw') {
         this.applyWidth(d, event.clientX);
         const l = this.store.lifelines().find((x) => x.id === d.id);
         if (l && l.width !== d.startWidth) {
            void this.store.updateLifeline(d.id, { width: l.width }, { width: d.startWidth });
         }
      } else if (d?.kind === 'connect') {
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
         // Both ends on one participant would leave no arrow, so that drop is ignored.
         const msg = this.msgs().find((x) => x.id === d.id);
         const otherId = d.which === 'from' ? msg?.toLifelineId : msg?.fromLifelineId;
         if (target && target.id !== otherId) {
            void this.store.updateMessage(
               d.id,
               d.which === 'from' ? { fromLifelineId: target.id } : { toLifelineId: target.id }
            );
         }
         this.endpointDragInfo.set(null);
         this.tempTo.set(null);
      } else if (d?.kind === 'msg') {
         // Finalize at the release position (robust even without intermediate moves).
         this.moveMessages(d, event.clientY);
         if (!this.dragCopied) {
            const byId = new Map(this.store.sequenceMessages().map((m) => [m.id, m.y] as const));
            const moves = [...d.startYs]
               .map(([id, from]) => ({ id, from, to: byId.get(id) ?? from }))
               .filter((m) => this.rowY(m.from) !== this.rowY(m.to));
            this.store.recordMessageMoves(moves);
         }
      } else if (d?.kind === 'll') {
         if (!this.dragCopied) {
            const now = this.store.lifelines().find((x) => x.id === d.id);
            if (now && Math.abs(now.x - d.startVal) > 0.5) {
               this.store.recordLifelineMove(d.id, d.startVal, now.x);
            }
         }
      } else if (d?.kind === 'diagram' || d?.kind === 'resize' || d?.kind === 'gap') {
         // Apply the final position once more from the release point (covers drags
         // where no intermediate pointermove fired), then persist everything.
         if (d.kind === 'diagram') {
            this.shiftDiagram(d, event);
            // Only now: the final shift above still snaps against the drag's start box.
            this.smartDragEnd()?.();
         } else if (d.kind === 'gap') {
            this.applyGap(d, event);
         } else {
            this.applyResize(d, event);
            this.smartDragEnd()?.();
         }
         const ids = d.kind === 'diagram' ? [d.diagramId, ...d.others.map((o) => o.diagramId)] : [this.diagram().id];
         for (const id of ids) {
            for (const l of this.store.lifelines().filter((x) => x.diagramId === id)) {
               this.store.moveLifeline(l.id, l.x);
            }
            // Messages moved with the diagram — persist their new rows too.
            for (const m of this.store.sequenceMessages().filter((x) => x.diagramId === id)) {
               this.store.moveMessage(m.id, m.y);
            }
            const cfg = this.store.sequenceDiagrams().find((x) => x.id === id);
            if (cfg) {
               void this.store.updateSequenceConfig(id, {
                  rowSpacing: cfg.rowSpacing,
                  originY: cfg.originY,
                  ...(d.kind === 'resize' && d.scaled !== 1
                     ? { headerHeight: cfg.headerHeight, scale: cfg.scale ?? 1 }
                     : {}),
                  ...(d.kind === 'resize' ? this.boundsOf(cfg) : {}),
               }, false);
            }
            if (d.kind === 'resize' && d.scaled !== 1) {
               for (const l of this.store.lifelines().filter((x) => x.diagramId === id)) {
                  const was = d.startWidths.get(l.id);
                  if (was !== undefined && was !== l.width) {
                     void this.store.updateLifeline(l.id, { width: l.width }, undefined, false);
                  }
               }
            }
         }
         if (d.kind === 'diagram' && !this.dragCopied) {
            const moves: { id: string; from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
            for (const [id, from] of d.companions.elements) {
               const el = this.store.elements().find((e) => e.id === id);
               if (el && (el.x !== from.x || el.y !== from.y)) {
                  moves.push({ id, from, to: { x: el.x, y: el.y } });
               }
            }
            this.store.recordElementMove(moves);
         }
         const own = d.kind === 'diagram' ? d.diagramId : this.diagram().id;
         const befores = new Map(this.othersBefore);
         if (this.layoutBefore) befores.set(own, this.layoutBefore);
         for (const [dId, before] of befores) {
            const after = this.snapshotLayout(dId);
            if (!this.dragCopied && this.layoutChanged(before, after)) {
               this.store.recordSequenceLayout(dId, before, after);
            }
         }
         this.layoutBefore = null;
         this.othersBefore = new Map();
      }
      this.drag = null;
   };

   private layoutChanged(a: SequenceLayoutSnapshot, b: SequenceLayoutSnapshot): boolean {
      if (a.originY !== b.originY || a.rowSpacing !== b.rowSpacing) return true;
      if (a.headerHeight !== b.headerHeight || a.scale !== b.scale) return true;
      if (JSON.stringify(a.bounds) !== JSON.stringify(b.bounds)) return true;
      for (const [id, w] of a.lifelineWidths ?? []) if (b.lifelineWidths?.get(id) !== w) return true;
      for (const [id, x] of a.lifelineXs) if (b.lifelineXs.get(id) !== x) return true;
      for (const [id, y] of a.messageYs) if (b.messageYs.get(id) !== y) return true;
      return false;
   }

   /** Nearest lifeline in THIS diagram to a world x. */
   private nearestLifeline(x: number): LifelineModel | null {
      const l = this.lls();
      if (!l.length) return null;
      return l.reduce((best, cur) => (Math.abs(cur.x - x) < Math.abs(best.x - x) ? cur : best));
   }

   // ----- Inline edit: diagram title (top-left of the box) -----
   protected startEditTitle(event: Event): void {
      event.stopPropagation();
      if (this.groupLocked()) {
         this.store.enterGroup('diagram', this.diagram().id);
         return;
      }
      if (!this.canEdit()) return;
      this.editValue.set(this.title());
      this.editingLifelineId.set(null);
      this.editingMessageId.set(null);
      this.editingTitle.set(true);
   }
   protected commitTitle(): void {
      if (!this.editingTitle()) return;
      this.editingTitle.set(false);
      const next = this.editValue().trim();
      if (next !== this.title()) {
         void this.store.updateSequenceConfig(this.diagram().id, { title: next });
      }
   }

   // ----- Inline label edit: lifeline -----
   protected startEditLifeline(event: Event, l: LifelineModel): void {
      event.stopPropagation();
      if (this.groupLocked()) {
         // First double-click steps into the group, selecting just this participant.
         this.store.enterGroup('diagram', this.diagram().id);
         this.store.selectLifeline(l.id);
         return;
      }
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

   protected addParticipant(event: Event, at: number): void {
      event.stopPropagation();
      void this.store.addLifeline(this.diagram().id, at);
   }

   /** Plus buttons appear while the pointer is over the participant headers. */
   protected readonly showAddButtons = signal(false);
   private hideAddTimer: ReturnType<typeof setTimeout> | null = null;
   addHover(on: boolean): void {
      if (this.hideAddTimer) clearTimeout(this.hideAddTimer);
      this.hideAddTimer = null;
      if (on) this.showAddButtons.set(true);
      else this.hideAddTimer = setTimeout(() => this.showAddButtons.set(false), 150);
   }

   /** Two insert slots, centered on the diagram's left and right edges. */
   protected readonly addSlots = computed<{ key: string; at: number; x: number }[]>(() => {
      const b = this.box();
      if (!b) return [];
      return [
         { key: 'left', at: 0, x: b.left },
         { key: 'right', at: this.lls().length, x: b.right },
      ];
   });

   // ----- Messages: select + vertical drag (snaps to rows; rows may be shared) -----
   protected onMessageDown(event: PointerEvent, m: MessageView): void {
      if (this.groupLocked()) {
         this.onBoxDown(event);
         return;
      }
      event.stopPropagation();
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
         // Toggle into/out of the selection; no drag so the gesture stays a pure click.
         const own = new Set(this.msgs().map((x) => x.id));
         const others = this.store.selectedMessageIds().filter((id) => !own.has(id));
         if (others.length) this.store.selectMessage(m.id);
         else this.store.toggleMessage(m.id);
         return;
      }
      // Pressing an already-selected message keeps the group so it can be dragged together.
      if (!this.store.selectedMessageIds().includes(m.id)) this.store.selectMessage(m.id);
      if (!this.canEdit() || this.editingMessageId() === m.id) return;
      this.startDrag();
      const startYs = new Map<string, number>();
      const sel = new Set(this.store.selectedMessageIds());
      for (const v of this.msgViews()) if (sel.has(v.id)) startYs.set(v.id, v.y);
      this.drag = {
         kind: 'msg',
         id: m.id,
         startClientY: event.clientY,
         startY: m.y,
         startYs,
      };
      if (event.altKey) void this.duplicateDrag();
   }

   /** Move every message in the drag by the same row delta as the grabbed one. */
   private moveMessages(d: Extract<Drag, { kind: 'msg' }>, clientY: number): void {
      const raw = d.startY + (clientY - d.startClientY) / this.zoom();
      let delta = this.rowY(raw) - d.startY;
      // Don't let the group slide above the first row.
      const minStart = Math.min(...d.startYs.values());
      delta = Math.max(delta, this.headerBottom() + this.rowSpacing() - minStart);
      for (const [id, y] of d.startYs) this.store.moveMessage(id, y + delta);
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
      this.tempTo.set(fn ? fn(event.clientX, event.clientY) : { x: which === 'from' ? m.fromX : m.toX, y: m.y });
   }
   protected startEditMessage(event: Event, m: MessageView): void {
      event.stopPropagation();
      if (this.groupLocked()) {
         this.store.enterGroup('diagram', this.diagram().id);
         this.store.selectMessage(m.id);
         return;
      }
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

   /** Enter commits; Shift+Enter falls through to the textarea's own newline. */
   protected onMessageEnter(event: Event, m: MessageView): void {
      event.preventDefault();
      this.commitMessage(m);
   }

   /** Visible line count of the message editor, so the textarea grows with its text. */
   protected editRows(): number {
      return Math.min(8, this.editValue().split(/\r?\n/).length);
   }
}
