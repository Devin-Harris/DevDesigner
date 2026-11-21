import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import {
   DEFAULT_THEME,
   type LifelineModel,
   SEQ_LABEL_CHAR_W,
   type SequenceDiagramModel,
   breakLabelMaxChars,
   isLightFill,
   isSwatchColor,
   messageLabelLines,
   messageLabelMaxChars,
   presentationOf,
   readableTextSet,
   resolveThemeColor,
   themeColorCss,
} from '@devdesigner/shared';
import { AutofocusDirective } from '../../../../shared/ui/directives/autofocus.directive';
import { ProjectStore, SequenceLayoutSnapshot } from '../../state/project/project.store';
import type { SequenceBounds } from '../../state/project/models/project-state.model';
import { applySequenceBounds, sequenceContentBox } from '../../helpers/frame-contents.helper';
import { CallPipe, HasPipe } from '../../../../shared/ui/pipes/collection.pipes';
import {
   BOX_PAD,
   type BoundingBox,
   type Companions,
   type Drag,
   type GroupResizeFn,
   type Handle,
   type MessageView,
   type SmartDragEndFn,
   type SmartDragFn,
   type SmartEdgesFn,
   type SnapFn,
   TITLE_ROOM,
   type WorldFn,
} from './sequence-diagram.helpers';
import { SequenceResize } from './sequence-resize';
import { SequenceGestures } from './sequence-gestures';

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
   imports: [CallPipe, HasPipe, AutofocusDirective],
   // pointerover/out bubble from every child (box, headers, spines, messages, buttons).
   host: {
      '(pointerover)': 'addHover(true)',
      '(pointerout)': 'addHover(false)',
      // Message labels sit on the diagram's own background so they blend with it.
      // Text, label boxes and arrowheads are drawn at the diagram's scale (Ctrl + resize).
      '[style.--seq-k]': 'diagram$().scale ?? 1',
      '[style.--seq-bg]': 'css(diagram$().backgroundColor)',
      '[style.--seq-border]': 'css(diagram$().borderColor)',
      '[style.--seq-fg]': 'fg$()?.text || null',
      '[style.--seq-fg-muted]': 'fg$()?.muted || null',
      '[style.--seq-fg-soft]': 'fg$()?.soft || null',
      '[style.--seq-spine]': 'fg$() ? "color-mix(in srgb, " + fg$()!.muted + " 55%, transparent)" : null',
   },
   templateUrl: './sequence-diagram.component.html',
   styleUrl: './sequence-diagram.component.scss',
})
export class SequenceDiagramComponent {
   /** Methods moved to sequence-gestures.ts. */
   private readonly sequenceGestures = new SequenceGestures(this);

   /** Methods moved to sequence-resize.ts. */
   private readonly sequenceResize = new SequenceResize(this);

   readonly store = inject(ProjectStore);
   /** True for custom pale participant colors, which take dark text instead of white. Stock swatches use the theme text. */
   protected readonly isLight = (c: string | undefined | null): boolean => {
      const color = this.themed(c);
      return !isSwatchColor(color) && isLightFill(color);
   };
   protected readonly isSwatch = (c: string | undefined | null): boolean => isSwatchColor(this.themed(c));
   /** CSS for a stored color (resolves the theme sentinels). */
   protected readonly css = (c: string | undefined | null) => themeColorCss(this.themed(c));
   /** The same three helpers for the template, bound to the current deck theme. */
   protected readonly css$ = computed(() => {
      const theme = this.deckTheme();
      return (c: string | undefined | null) => themeColorCss(c ? resolveThemeColor(c, theme) : c);
   });
   protected readonly isLight$ = computed(() => {
      const theme = this.deckTheme();
      return (c: string | undefined | null): boolean => {
         const color = c ? resolveThemeColor(c, theme) : c;
         return !isSwatchColor(color) && isLightFill(color);
      };
   });
   protected readonly isSwatch$ = computed(() => {
      const theme = this.deckTheme();
      return (c: string | undefined | null): boolean => isSwatchColor(c ? resolveThemeColor(c, theme) : c);
   });

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
   protected readonly k$ = computed(() => this.diagram$().scale ?? 1);

   readonly diagram$ = computed<SequenceDiagramModel>(
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
      const frame = this.store.slideFrames().find((f) => f.id === this.diagram$().slideId);
      return (frame && this.store.presentationThemes().get(presentationOf(frame))) || DEFAULT_THEME;
   });
   /** A stored color with theme tokens resolved. */
   private themed<C extends string | undefined | null>(c: C): C | string {
      return c ? resolveThemeColor(c, this.deckTheme()) : c;
   }

   /** Text colors that stay readable on a custom background; null = theme defaults. */
   protected readonly fg$ = computed(() => readableTextSet(this.themed(this.diagram$().backgroundColor) ?? undefined));

   readonly originY$ = computed(() => this.diagram$().originY);
   readonly headerH$ = computed(() => this.diagram$().headerHeight);
   protected readonly headerBottom$ = computed(() => this.originY$() + this.headerH$());
   readonly rowSpacing = computed(() => this.diagram$().rowSpacing);

   /** This diagram's lifelines, left-to-right. */
   readonly lls$ = computed(() =>
      this.store
         .lifelines()
         .filter((l) => l.diagramId === this.diagram$().id)
         .sort((a, b) => a.x - b.x)
   );
   readonly msgs = computed(() => this.store.sequenceMessages().filter((m) => m.diagramId === this.diagram$().id));

   protected readonly selectedLifelineIds$ = computed(() => new Set(this.store.selectedLifelineIds()));
   protected readonly sequenceSelected$ = computed(() => this.store.selectedDiagramIds().includes(this.diagram$().id));
   /** In a group that hasn't been entered: parts act as the whole group, not individually. */
   groupLocked(): boolean {
      const gid = this.store.groupIdOf(this.diagram$().id);
      return !!gid && gid !== this.store.enteredGroupId();
   }

   /** Resize handles show when this diagram is selected (alone, or with others to scale together). */
   protected readonly soleSelected$ = computed(
      () => this.store.selectedDiagramId() === this.diagram$().id || this.sequenceSelected$()
   );

   /** Snap a world-y to its row centre on the grid (row 1 is the first below the header). */
   rowY(y: number): number {
      const hb = this.headerBottom$();
      const gap = this.rowSpacing();
      return hb + gap * Math.max(1, Math.round((y - hb) / gap));
   }

   /** Messages, each at its own snapped row — several may share a row (simultaneous). */
   readonly msgViews$ = computed<MessageView[]>(() => {
      const ll = this.lls$();
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
            editMaxPx: this.editMaxPx(
               m.wrap !== false,
               isBreak,
               (isBreak ? maxX - minX : Math.abs(toX - fromX)) / this.k$()
            ),
            displayLabel: messageLabelLines(
               m.label ?? '',
               // Wider glyphs at a larger scale: wrap as if the span were that much narrower.
               (isBreak ? maxX - minX : Math.abs(toX - fromX)) / this.k$(),
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
            : messageLabelMaxChars(span) * SEQ_LABEL_CHAR_W) * this.k$()
      );
   }

   /** Highest occupied row, for sizing the spines and box. */
   protected readonly maxRow = computed(() => {
      const hb = this.headerBottom$();
      const gap = this.rowSpacing();
      const rows = this.msgs().map((m) => Math.max(1, Math.round((m.y - hb) / gap)));
      return rows.length ? Math.max(...rows) : 0;
   });

   /** Content spine end: one row past the lowest message, leaving room below. */
   private readonly contentSpineEnd = computed(() => this.headerBottom$() + this.rowSpacing() * (this.maxRow() + 1));

   /** Rounded bounding box around this diagram (for move/resize/select); may be bigger than its content. */
   protected readonly box$ = computed<BoundingBox | null>(() => {
      const l = this.lls$();
      if (!l.length) return null;
      const b = applySequenceBounds(this.diagram$(), {
         x0: Math.min(...l.map((x) => x.x - x.width / 2)) - BOX_PAD,
         x1: Math.max(...l.map((x) => x.x + x.width / 2)) + BOX_PAD,
         y0: this.originY$() - BOX_PAD - TITLE_ROOM,
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
   protected readonly spineEnd$ = computed(() => (this.box$()?.bottom ?? this.contentSpineEnd() + BOX_PAD) - BOX_PAD);

   /**
    * Invisible bands across the gaps above each occupied message row (drag one to change
    * the row spacing; the row below follows the pointer). Active when the diagram is selected.
    */
   protected readonly gaps$ = computed<{ row: number; y: number; x: number; w: number }[]>(() => {
      const b = this.box$();
      if (!b) return [];
      const hb = this.headerBottom$();
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

   readonly canEdit$ = computed(() => this.store.canEdit());
   /** Endpoint handles only make sense for a single selected message. */
   protected readonly singleMessage$ = computed(() => this.store.selectedMessageIds().length === 1);

   // Live drag-connect preview (signal-driven so it re-renders).
   readonly connectFromId = signal<string | null>(null);
   readonly tempTo = signal<{ x: number; y: number } | null>(null);
   // Live endpoint-reattach preview.
   readonly endpointDragInfo = signal<{ id: string; which: 'from' | 'to' } | null>(null);
   protected readonly endpointPreview$ = computed(() => {
      const info = this.endpointDragInfo();
      const to = this.tempTo();
      if (!info || !to) return null;
      const m = this.msgViews$().find((v) => v.id === info.id);
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
   protected readonly connectPreview$ = computed(() => {
      const id = this.connectFromId();
      const to = this.tempTo();
      if (!id || !to) return null;
      const from = this.lls$().find((x) => x.id === id);
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
   protected readonly handles$ = computed<{ id: Handle; x: number; y: number }[]>(() => {
      const b = this.box$();
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
   readonly editingLifelineId$ = signal<string | null>(null);
   protected readonly editingMessageId$ = signal<string | null>(null);
   protected readonly editValue$ = signal('');
   /** The diagram title is being edited inline (draft lives in `editValue`). */
   protected readonly editingTitle$ = signal(false);
   protected readonly title$ = computed(() => this.diagram$().title ?? '');

   drag: Drag | null = null;
   /** Alt-drag duplication state: set once the drag has switched to a copy. */
   dragCopied = false;
   duplicating = false;
   lastPointer: PointerEvent | null = null;

   constructor() {
      // The message toolbar's pencil requests an inline label edit; open it here
      // only if the message belongs to this diagram (and then consume the request).
      effect(() => {
         const id = this.store.pendingMessageEditId();
         if (!id) return;
         const m = this.msgViews$().find((v) => v.id === id);
         if (m) {
            this.editValue$.set(m.label);
            this.editingLifelineId$.set(null);
            this.editingMessageId$.set(id);
            this.store.clearMessageEditRequest();
         }
      });
      // Same for the participant toolbar's pencil (a lifeline inline rename).
      effect(() => {
         const id = this.store.pendingLifelineEditId();
         if (!id) return;
         const l = this.lls$().find((x) => x.id === id);
         if (l) {
            this.editValue$.set(l.label);
            this.editingMessageId$.set(null);
            this.editingLifelineId$.set(id);
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

   zoom(): number {
      return this.store.viewport().zoom || 1;
   }

   /**
    * Begin tracking a drag on `window` (not via pointer capture): this keeps the
    * drag working when the cursor leaves the small element it started on, and is
    * robust to touch/synthetic pointers where setPointerCapture can fail.
    */
   startDrag(): void {
      this.dragCopied = false;
      this.duplicating = false;
      this.lastPointer = null;
      window.addEventListener('keydown', this.onKey);
      window.addEventListener('pointermove', this.onMove);
      window.addEventListener('pointerup', this.onUp);
      window.addEventListener('pointercancel', this.onUp);
   }
   endDrag(): void {
      window.removeEventListener('keydown', this.onKey);
      window.removeEventListener('pointermove', this.onMove);
      window.removeEventListener('pointerup', this.onUp);
      window.removeEventListener('pointercancel', this.onUp);
   }

   /** Row index of each message in this diagram, for keeping rows fixed through a move/resize. */
   startRowsMap(): Map<string, number> {
      const hb = this.headerBottom$();
      const gap = this.rowSpacing();
      const out = new Map<string, number>();
      for (const m of this.msgs()) out.set(m.id, Math.max(1, Math.round((m.y - hb) / gap)));
      return out;
   }

   /** Layout at gesture start, recorded for undo when a move/resize ends. */
   layoutBefore: SequenceLayoutSnapshot | null = null;
   /** Same, for the other diagrams moved along in a group drag. */
   othersBefore = new Map<string, SequenceLayoutSnapshot>();

   boundsOf(cfg: SequenceDiagramModel | undefined): SequenceBounds {
      return {
         padLeft: cfg?.padLeft ?? 0,
         padTop: cfg?.padTop ?? 0,
         boxWidth: cfg?.boxWidth ?? 0,
         boxHeight: cfg?.boxHeight ?? 0,
      };
   }

   /** The diagram's content box right now (no stored bounds). */
   contentBox(): { x0: number; y0: number; x1: number; y1: number } | null {
      return sequenceContentBox(this.diagram$(), this.store.lifelines(), this.store.sequenceMessages());
   }

   /** Double-click a side/corner: shrink the box back to its content on that axis (like grid tables). */
   protected onHandleDblClick(event: MouseEvent, handle: Handle): void {
      event.stopPropagation();
      if (!this.canEdit$()) return;
      this.store.fitSequenceToContent(this.diagram$().id, {
         x: /[ew]/.test(handle),
         y: /[ns]/.test(handle),
      });
   }

   // ----- Connect drag: start anywhere on a spine -----
   protected onConnectDown(event: PointerEvent, l: LifelineModel): void {
      if (this.groupLocked()) {
         this.onBoxDown(event);
         return;
      }
      event.stopPropagation();
      if (!this.canEdit$()) return;
      this.startDrag();
      const fn = this.toWorld();
      const startY = fn ? fn(event.clientX, event.clientY).y : this.headerBottom$();
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

   // Live message-marquee rectangle (world coords).
   readonly marqueeEnd = signal<{ x: number; y: number } | null>(null);
   marqueeStart: { x: number; y: number } | null = null;
   readonly marqueeRect$ = computed(() => {
      const e = this.marqueeEnd();
      const s = this.marqueeStart;
      if (!e || !s) return null;
      const left = Math.min(s.x, e.x);
      const top = Math.min(s.y, e.y);
      return { left, top, width: Math.abs(e.x - s.x), height: Math.abs(e.y - s.y) };
   });

   /** Nearest lifeline in THIS diagram to a world x. */
   nearestLifeline(x: number): LifelineModel | null {
      const l = this.lls$();
      if (!l.length) return null;
      return l.reduce((best, cur) => (Math.abs(cur.x - x) < Math.abs(best.x - x) ? cur : best));
   }

   // ----- Inline edit: diagram title (top-left of the box) -----
   protected startEditTitle(event: Event): void {
      event.stopPropagation();
      if (this.groupLocked()) {
         this.store.enterGroup('diagram', this.diagram$().id);
         return;
      }
      if (!this.canEdit$()) return;
      this.editValue$.set(this.title$());
      this.editingLifelineId$.set(null);
      this.editingMessageId$.set(null);
      this.editingTitle$.set(true);
   }
   protected commitTitle(): void {
      if (!this.editingTitle$()) return;
      this.editingTitle$.set(false);
      const next = this.editValue$().trim();
      if (next !== this.title$()) {
         void this.store.updateSequenceConfig(this.diagram$().id, { title: next });
      }
   }

   // ----- Inline label edit: lifeline -----
   protected startEditLifeline(event: Event, l: LifelineModel): void {
      event.stopPropagation();
      if (this.groupLocked()) {
         // First double-click steps into the group, selecting just this participant.
         this.store.enterGroup('diagram', this.diagram$().id);
         this.store.selectLifeline(l.id);
         return;
      }
      if (!this.canEdit$()) return;
      this.editValue$.set(l.label);
      this.editingMessageId$.set(null);
      this.editingLifelineId$.set(l.id);
   }
   protected commitLifeline(l: LifelineModel): void {
      if (this.editingLifelineId$() !== l.id) return;
      this.editingLifelineId$.set(null);
      const label = this.editValue$().trim();
      if (label && label !== l.label) void this.store.updateLifeline(l.id, { label });
   }

   protected addParticipant(event: Event, at: number): void {
      event.stopPropagation();
      void this.store.addLifeline(this.diagram$().id, at);
   }

   /** Plus buttons appear while the pointer is over the participant headers. */
   protected readonly showAddButtons$ = signal(false);
   private hideAddTimer: ReturnType<typeof setTimeout> | null = null;
   addHover(on: boolean): void {
      if (this.hideAddTimer) clearTimeout(this.hideAddTimer);
      this.hideAddTimer = null;
      if (on) this.showAddButtons$.set(true);
      else this.hideAddTimer = setTimeout(() => this.showAddButtons$.set(false), 150);
   }

   /** Two insert slots, centered on the diagram's left and right edges. */
   protected readonly addSlots$ = computed<{ key: string; at: number; x: number }[]>(() => {
      const b = this.box$();
      if (!b) return [];
      return [
         { key: 'left', at: 0, x: b.left },
         { key: 'right', at: this.lls$().length, x: b.right },
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
      if (!this.canEdit$() || this.editingMessageId$() === m.id) return;
      this.startDrag();
      const startYs = new Map<string, number>();
      const sel = new Set(this.store.selectedMessageIds());
      for (const v of this.msgViews$()) if (sel.has(v.id)) startYs.set(v.id, v.y);
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
   moveMessages(d: Extract<Drag, { kind: 'msg' }>, clientY: number): void {
      const raw = d.startY + (clientY - d.startClientY) / this.zoom();
      let delta = this.rowY(raw) - d.startY;
      // Don't let the group slide above the first row.
      const minStart = Math.min(...d.startYs.values());
      delta = Math.max(delta, this.headerBottom$() + this.rowSpacing() - minStart);
      for (const [id, y] of d.startYs) this.store.moveMessage(id, y + delta);
   }

   // ----- Endpoint reattach: drag a message's end onto another participant -----
   protected onEndpointDown(event: PointerEvent, m: MessageView, which: 'from' | 'to'): void {
      event.stopPropagation();
      this.store.selectMessage(m.id);
      if (!this.canEdit$()) return;
      this.startDrag();
      this.drag = { kind: 'endpoint', id: m.id, which };
      this.endpointDragInfo.set({ id: m.id, which });
      const fn = this.toWorld();
      this.tempTo.set(fn ? fn(event.clientX, event.clientY) : { x: which === 'from' ? m.fromX : m.toX, y: m.y });
   }
   protected startEditMessage(event: Event, m: MessageView): void {
      event.stopPropagation();
      if (this.groupLocked()) {
         this.store.enterGroup('diagram', this.diagram$().id);
         this.store.selectMessage(m.id);
         return;
      }
      if (!this.canEdit$()) return;
      this.editValue$.set(m.label);
      this.editingLifelineId$.set(null);
      this.editingMessageId$.set(m.id);
   }
   protected commitMessage(m: MessageView): void {
      if (this.editingMessageId$() !== m.id) return;
      this.editingMessageId$.set(null);
      void this.store.updateMessage(m.id, { label: this.editValue$().trim() });
   }

   protected onEditInput(value: string): void {
      this.editValue$.set(value);
   }

   /** Enter commits; Shift+Enter falls through to the textarea's own newline. */
   protected onMessageEnter(event: Event, m: MessageView): void {
      event.preventDefault();
      this.commitMessage(m);
   }

   /** Visible line count of the message editor, so the textarea grows with its text. */
   protected readonly editRows$ = computed(() => Math.min(8, this.editValue$().split(/\r?\n/).length));

   // ---- delegates to sequence-resize.ts ----
   snapshotLayout(diagramId: string): SequenceLayoutSnapshot {
      return this.sequenceResize.snapshotLayout(diagramId);
   }
   shiftDiagram(d: Extract<Drag, { kind: 'diagram' }>, event: PointerEvent): void {
      return this.sequenceResize.shiftDiagram(d, event);
   }
   captureCompanions(): Companions {
      return this.sequenceResize.captureCompanions();
   }
   applyResize(d: Extract<Drag, { kind: 'resize' }>, event: PointerEvent): void {
      return this.sequenceResize.applyResize(d, event);
   }
   layoutChanged(a: SequenceLayoutSnapshot, b: SequenceLayoutSnapshot): boolean {
      return this.sequenceResize.layoutChanged(a, b);
   }

   // ---- delegates to sequence-gestures.ts ----
   protected onBoxDown(event: PointerEvent): void {
      return this.sequenceGestures.onBoxDown(event);
   }
   protected onResizeDown(event: PointerEvent, handle: Handle): void {
      return this.sequenceGestures.onResizeDown(event, handle);
   }
   protected onGapDown(event: PointerEvent, row: number): void {
      return this.sequenceGestures.onGapDown(event, row);
   }
   protected onHeaderDown(event: PointerEvent, l: LifelineModel): void {
      return this.sequenceGestures.onHeaderDown(event, l);
   }
   protected onWidthDown(event: PointerEvent, l: LifelineModel, side: -1 | 1): void {
      return this.sequenceGestures.onWidthDown(event, l, side);
   }
   private duplicateDrag(): Promise<void> {
      return this.sequenceGestures.duplicateDrag();
   }
   protected get onMove() {
      return this.sequenceGestures.onMove;
   }
   protected get onUp() {
      return this.sequenceGestures.onUp;
   }
}
export type { SmartDragFn, SmartDragEndFn, SmartEdgesFn, GroupResizeFn } from './sequence-diagram.helpers';
