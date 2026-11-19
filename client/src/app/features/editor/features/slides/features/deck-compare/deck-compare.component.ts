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
   output,
   signal,
   untracked,
   viewChild,
} from '@angular/core';
import {
   type CanvasElementModel,
   type ElementBinding,
   type GridData,
   type GridPart,
   type MorphBy,
   clearGridTag,
   effectiveTransition,
   gridMorphPairs,
   gridPartTag,
   matchMorphItems,
   morphMode,
   onlyYourPairs,
   parseGrid,
   serializeGrid,
   setGridPartTag,
   slideMorphKey,
   transitionMorphs,
} from '@devdesigner/shared';
import { lineEnds } from '../../../../helpers/render';
import { type RotatedBox, elementBox } from '../../../../helpers/element-geometry.helper';
import { ProjectStore } from '../../../../state/project/project.store';
import { tableBox } from '../../../../helpers/node-metrics.helper';
import { SlideRenderService } from '../../services/slide-render.service';
import { ComparePreviewPlayer } from './helpers/compare-preview-player';
import { CompareUiState } from './services/compare-ui-state.service';
import { gridMirrorPart, gridPartBox, gridPartLabel, gridZoneAt, samePart } from './grid-zones.helper';
import {
   COL,
   type DragEnd,
   GAP,
   type Hit,
   MIN_ZOOM,
   type MorphPair,
   PAIR_COLORS,
   type PartLine,
   type PctBox,
   type Side,
} from './deck-compare.model';

/**
 * DeckMorph screen. Mapping view: the slide before and after side by side, every
 * object outlined; objects that morph share a colour, a number and a line. Click an
 * object on one slide, then one on the other, to make them morph (only this
 * transition: their own in / out tags). A strip below scrubs the real morph.
 * Mode "pairs" is the list for the right-hand dock.
 */
@Component({
   selector: 'dd-deck-compare',
   changeDetection: ChangeDetectionStrategy.OnPush,

   templateUrl: './deck-compare.component.html',
   styleUrl: './deck-compare.component.scss',
})
export class DeckCompareComponent {
   /** The slide the transition goes into. */
   readonly slide = input.required<CanvasElementModel>();
   /** The slide before it (null for the first slide). */
   readonly previous = input<CanvasElementModel | null>(null);
   /** 1-based number of the previous slide. */
   readonly index = input(1);
   /** The slide before `previous`, and the slide after `slide` (onward / earlier pairing badges). */
   readonly before = input<CanvasElementModel | null>(null);
   readonly after = input<CanvasElementModel | null>(null);
   readonly mode = input<'stage' | 'pairs'>('stage');
   readonly preview = output<void>();

   private readonly store = inject(ProjectStore);
   private readonly destroyRef = inject(DestroyRef);
   protected readonly canEdit = this.store.canEdit;

   // ---- mapping ----
   /** The object picked first (waiting for its partner on the other slide). */
   protected readonly ui = inject(CompareUiState);
   protected readonly armed = this.ui.armed;
   /** The object under the pointer (its partner and line light up too). */
   protected readonly lit = this.ui.lit;
   protected readonly view = this.ui.view;

   /** Keys being looked at (dragged / picked / hovered) and their partners. */
   protected readonly focusKeys = computed<Set<string> | null>(() => {
      const d = this.drag();
      const keys: string[] = [];
      if (d?.active) {
         keys.push(d.from.key);
         if (d.over) keys.push(d.over);
      } else {
         const k = this.armed()?.key ?? this.lit();
         if (k) keys.push(k);
      }
      if (!keys.length) return null;
      const all = [...this.hitsA(), ...this.hitsB()];
      const out = new Set(keys);
      if (!d?.active)
         for (const k of keys) {
            const p = all.find((h) => h.key === k)?.partner;
            if (p) out.add(p);
         }
      return out;
   });
   protected isRel(key: string): boolean {
      return this.focusKeys()?.has(key) ?? false;
   }

   /** × on a line: a pairing you made is removed (back to automatic); an automatic one stops morphing. */
   /** The X on a pair line: no transition for both objects (each just switches). */
   protected removeLine(l: { a: string; b: string; aId: string | null; bId: string | null }): void {
      this.setPairTags(l.aId, l.bId, 'cut');
      this.lit.set(null);
   }

   /** No transition for the selected object and its partner: both just switch. */
   protected cutArmed(): void {
      const { aId, bId } = this.armedIds();
      this.setPairTags(aId, bId, 'cut');
   }

   /** Click a row in the pairs list: select that pair's object on the slides (again to clear). */
   protected selectRow(p: MorphPair): void {
      if (!this.canEdit()) return;
      const key = p.bKey ?? p.aKey;
      if (!key) return;
      const side: 'a' | 'b' = p.bKey ? 'b' : 'a';
      const cur = this.armed();
      this.armed.set(cur && cur.key === key ? null : { side, key });
   }

   /** Pairs-list row that matches what is armed or hovered on the stage. */
   protected rowOn(p: MorphPair): boolean {
      const keys = [this.armed()?.key, this.lit()].filter((k): k is string => !!k);
      return keys.some((k) => k === p.aKey || k === p.bKey);
   }
   protected rowArmed(p: MorphPair): boolean {
      const k = this.armed()?.key;
      return !!k && (k === p.aKey || k === p.bKey);
   }

   private sides(): { A: Side[]; B: Side[] } {
      const prev = this.previous();
      return { A: prev ? this.itemsOf(prev) : [], B: this.itemsOf(this.slide()) };
   }

   /** Matcher result as index pairs, plus the sides it ran on. */
   private readonly matching = computed(() => {
      const { A, B } = this.sides();
      const tr = this.slide().slide?.transition;
      const items = { a: A.map((x) => x.item), b: B.map((x) => x.item) };
      const all = transitionMorphs(tr)
         ? matchMorphItems(items.a, items.b, undefined, false, {
              width: this.slide().width,
              height: this.slide().height,
           })
         : [];
      // Fade / slide / zoom: only the pairs you made (Auto also pairs look-alikes).
      const matches = morphMode(tr) === 'mine' ? onlyYourPairs(items.a, items.b, all) : all;
      return { A, B, matches };
   });

   private hits(side: 'a' | 'b'): Hit[] {
      const { A, B, matches } = this.matching();
      const list = side === 'a' ? A : B;
      const frame = side === 'a' ? this.previous() : this.slide();
      if (!frame) return [];
      const pairOf = new Map<number, { n: number; other: number }>();
      matches.forEach(([i, j], n) => pairOf.set(side === 'a' ? i : j, { n, other: side === 'a' ? j : i }));
      const otherKey = (k: number): string => (side === 'a' ? `b${k}` : `a${k}`);
      return list.map((s, k) => {
         const p = pairOf.get(k);
         const it = s.item;
         const own = side === 'a' ? it.keyOut : it.keyIn;
         const forced = !!own && own.startsWith('tag:pair-');
         const chainMap = side === 'a' ? this.chainA() : this.chainB();
         const el = s.id ? this.store.elements().find((e) => e.id === s.id) : undefined;
         let line: Hit['line'] = null;
         if (el && (el.type === 'line' || el.type === 'arrow')) {
            const pts = lineEnds(el, this.targetBox);
            const p0 = pts[0];
            const p1 = pts[pts.length - 1];
            if (p0 && p1) {
               const dx = p1.x - p0.x;
               const dy = p1.y - p0.y;
               line = {
                  cx: (((p0.x + p1.x) / 2 - frame.x) / frame.width) * 100,
                  cy: (((p0.y + p1.y) / 2 - frame.y) / frame.height) * 100,
                  len: (Math.hypot(dx, dy) / frame.width) * 100,
                  angle: (Math.atan2(dy, dx) * 180) / Math.PI,
               };
            }
         }
         let grid: Hit['grid'] = null;
         if (el?.type === 'grid') {
            const g = parseGrid(el.text);
            grid = { rows: g.rows, cols: g.cols };
         }
         return {
            line,
            grid,
            key: `${side}${k}`,
            id: s.id,
            label: s.label,
            left: ((it.cx - it.w / 2) / frame.width) * 100,
            top: ((it.cy - it.h / 2) / frame.height) * 100,
            width: (it.w / frame.width) * 100,
            height: (it.h / frame.height) * 100,
            // Any part past the slide's edges (not only wholly off it): the slide's dashed
            // reach then takes it in and the view never clips it.
            outside:
               it.cx - it.w / 2 < -0.5 ||
               it.cy - it.h / 2 < -0.5 ||
               it.cx + it.w / 2 > frame.width + 0.5 ||
               it.cy + it.h / 2 > frame.height + 0.5,
            num: p ? p.n + 1 : null,
            color: p ? PAIR_COLORS[p.n % PAIR_COLORS.length] : null,
            forced,
            partner: p ? otherKey(p.other) : null,
            cut: !!own && own.startsWith('tag:cut-'),
            solo: !!own && own.startsWith('tag:solo-'),
            chain: s.id ? (chainMap.get(s.id) ?? null) : null,
         };
      });
   }

   /** Pairs of a neighbouring transition: element id on `side` -> partner label. */
   private neighbourPairs(
      from: CanvasElementModel | null,
      to: CanvasElementModel | null,
      side: 'from' | 'to'
   ): Map<string, string> {
      const out = new Map<string, string>();
      if (!from || !to || !transitionMorphs(to.slide?.transition)) return out;
      const A = this.itemsOf(from);
      const B = this.itemsOf(to);
      const all = matchMorphItems(
         A.map((x) => x.item),
         B.map((x) => x.item)
      );
      const mode = morphMode(to.slide?.transition);
      for (const [i, j] of mode === 'mine'
         ? onlyYourPairs(
              A.map((x) => x.item),
              B.map((x) => x.item),
              all
           )
         : all) {
         const mine = side === 'from' ? A[i] : B[j];
         const other = side === 'from' ? B[j] : A[i];
         if (mine.id) out.set(mine.id, other.label);
      }
      return out;
   }
   /** Before-slide objects that came from the slide before it. */
   private readonly chainA = computed(() => this.neighbourPairs(this.before(), this.previous(), 'to'));
   /** After-slide objects that go on into the next slide. */
   private readonly chainB = computed(() => this.neighbourPairs(this.slide(), this.after(), 'from'));
   protected readonly hitsA = computed(() => this.hits('a'));
   protected readonly hitsB = computed(() => this.hits('b'));
   /**
    * How far the slides' content reaches past the pair view's outer edges, as fractions of
    * its width (its margins, so the scroll area covers it at any zoom).
    */
   protected readonly overhang = computed(() => {
      const t = this.total();
      const hx = (pct: number) => ((Math.max(0, pct) / 100) * COL) / t;
      const hy = (pct: number) => ((Math.max(0, pct) / 100) * this.viewH()) / t;
      const all = [...this.hitsA(), ...this.hitsB()];
      const pad = 0.03;
      return {
         left: hx(-Math.min(0, ...this.hitsA().map((h) => h.left))) + pad,
         right: hx(Math.max(100, ...this.hitsB().map((h) => h.left + h.width)) - 100) + pad,
         top: hy(-Math.min(0, ...all.map((h) => h.top))) + pad,
         bottom: hy(Math.max(100, ...all.map((h) => h.top + h.height)) - 100) + pad,
      };
   });
   protected readonly reachA = computed(() => this.reach(this.hitsA()));
   protected readonly reachB = computed(() => this.reach(this.hitsB()));

   /** The box (in % of the slide) around a slide and its objects off its edges; null when none are. */
   private reach(hits: readonly Hit[]): { left: number; top: number; width: number; height: number } | null {
      if (!hits.some((h) => h.outside)) return null;
      const pad = 1.5;
      const x0 = Math.min(0, ...hits.map((h) => h.left)) - pad;
      const y0 = Math.min(0, ...hits.map((h) => h.top)) - pad;
      const x1 = Math.max(100, ...hits.map((h) => h.left + h.width)) + pad;
      const y1 = Math.max(100, ...hits.map((h) => h.top + h.height)) + pad;
      return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
   }

   protected readonly animateByOptions = [
      { value: 'default', label: 'Default' },
      { value: 'character', label: 'Char' },
      { value: 'word', label: 'Word' },
      { value: 'object', label: 'Object' },
   ] as const;

   /**
    * The selected pair's "animate by": stored on this (the later) slide against its own
    * object, so the after-slide end of the pair is the key whichever end is selected.
    */
   protected readonly armedAnimateBy = computed<{ id: string; by: string } | null>(() => {
      const a = this.armed();
      const h = this.armedHit();
      if (!a || !h?.partner) return null;
      const bHit = a.side === 'b' ? h : this.hitsB().find((x) => x.key === h.partner);
      if (!bHit?.id) return null;
      return { id: bHit.id, by: this.slide().slide?.transition?.morphByItems?.[bHit.id] ?? 'default' };
   });

   protected setArmedAnimateBy(id: string, by: string): void {
      const f = this.slide();
      if (!f.slide || !this.canEdit()) return;
      const t = effectiveTransition(f.slide);
      const { [id]: _old, ...rest } = t.morphByItems ?? {};
      const items = by === 'default' ? rest : { ...rest, [id]: by as MorphBy };
      void this.store.updateElement(f.id, {
         slide: { ...f.slide, transition: { ...t, morphByItems: Object.keys(items).length ? items : undefined } },
      });
   }

   /** Publish the selection and its actions for the side panel. */
   private readonly publishSelection = effect(() => {
      const h = this.armedHit();
      const ab = this.armedAnimateBy();
      const partner = this.partnerLabel();
      untracked(() =>
         this.ui.selection.set(
            h
               ? {
                    label: h.label,
                    partnerLabel: partner,
                    paired: !!h.partner,
                    forced: h.forced,
                    cut: h.cut,
                    solo: h.solo,
                    animateBy: ab?.by ?? null,
                    setAnimateBy: (by) => ab && this.setArmedAnimateBy(ab.id, by),
                    fade: () => this.fadeArmed(),
                    unpair: () => this.unpairArmed(),
                    cut_: () => this.cutArmed(),
                    reset: () => this.resetArmed(),
                    done: () => this.armed.set(null),
                 }
               : null
         )
      );
   });

   /** Don't morph: the earlier slide's object fades out, the later one's fades in. */
   protected fadeArmed(): void {
      const { aId, bId } = this.armedIds();
      this.setPairTags(aId, bId, 'solo');
   }

   protected readonly armedHit = computed(() => {
      const a = this.armed();
      if (!a) return null;
      return (a.side === 'a' ? this.hitsA() : this.hitsB()).find((h) => h.key === a.key) ?? null;
   });
   protected readonly partnerLabel = computed(() => {
      const h = this.armedHit();
      if (!h?.partner) return '';
      return [...this.hitsA(), ...this.hitsB()].find((x) => x.key === h.partner)?.label ?? '';
   });
   protected isArmed(side: 'a' | 'b', h: Hit): boolean {
      const a = this.armed();
      return !!a && a.side === side && a.key === h.key;
   }

   // ---- drag to pair ----
   private readonly pairView = viewChild<ElementRef<HTMLElement>>('pairView');
   /**
    * A connector being dragged: it starts at `from` (an object, or the fixed end of an
    * existing pair) and follows the pointer; dropping on an object on the other slide
    * pairs the two.
    */
   protected readonly drag = signal<{
      from: DragEnd;
      /** The grid part under the pointer on the other slide (when dragging from a part). */
      overPart: GridPart | null;
      /** The pair line being re-aimed (drawn faint while dragging). */
      moving: string | null;
      sx: number;
      sy: number;
      active: boolean;
      path: string;
      over: string | null;
      /** The live line's colour: the pair's own, else the app accent. */
      color: string;
   } | null>(null);
   private suppressClick = false;

   /** A grid part's box in % of its slide (like a hit). */
   protected partRect(h: Hit, part: GridPart): PctBox {
      const b = h.grid ? gridPartBox(h.grid.rows, h.grid.cols, part) : { x: 0, y: 0, w: 1, h: 1 };
      return {
         left: h.left + b.x * h.width,
         top: h.top + b.y * h.height,
         width: b.w * h.width,
         height: b.h * h.height,
      };
   }

   /** Centre of an object (or one of a grid's parts) in pair-view units. */
   private centerOf(side: 'a' | 'b', key: string, part?: GridPart | null): { x: number; y: number } | null {
      const h = (side === 'a' ? this.hitsA() : this.hitsB()).find((x) => x.key === key);
      if (!h) return null;
      const r = part && h.grid ? this.partRect(h, part) : null;
      // A line/arrow's link sits at the middle of the drawn line.
      const cx = r ? r.left + r.width / 2 : h.line ? h.line.cx : h.left + h.width / 2;
      const cy = r ? r.top + r.height / 2 : h.line ? h.line.cy : h.top + h.height / 2;
      return {
         x: (cx / 100) * COL + (side === 'b' ? COL + this.gap() : 0),
         y: (cy / 100) * this.viewH(),
      };
   }

   private toUnits(clientX: number, clientY: number): { x: number; y: number } | null {
      const el = this.pairView()?.nativeElement;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { x: ((clientX - r.left) / r.width) * this.total(), y: ((clientY - r.top) / r.height) * this.viewH() };
   }

   protected startDrag(event: PointerEvent, side: 'a' | 'b', h: Hit): void {
      if (!this.canEdit() || !h.id || event.button !== 0) return;
      // On a grid table the zone under the pointer picks the level: the band round it is
      // the whole table, the top / left strips a column / row, inside a cell (Alt: cells only).
      const part = h.grid ? this.zoneAt(side, h, event.clientX, event.clientY, { cellOnly: event.altKey }) : undefined;
      this.beginDrag(event, { side, key: h.key, part }, null, false);
   }

   /** The screen element of a hit's outline. */
   private hitEl(side: 'a' | 'b', key: string): HTMLElement | null {
      return (
         this.pairView()?.nativeElement.querySelector<HTMLElement>(
            `.hit[data-side="${side}"][data-key="${CSS.escape(key)}"]`
         ) ?? null
      );
   }

   /** The grid part under a screen point (null = the whole table); see gridZoneAt. */
   private zoneAt(
      side: 'a' | 'b',
      h: Hit,
      clientX: number,
      clientY: number,
      opts: { level?: GridPart['kind']; cellOnly?: boolean }
   ): GridPart | null {
      const el = this.hitEl(side, h.key);
      if (!el || !h.grid) return null;
      const r = el.getBoundingClientRect();
      return gridZoneAt(
         h.grid.rows,
         h.grid.cols,
         (clientX - r.left) / (r.width || 1),
         (clientY - r.top) / (r.height || 1),
         r.width,
         r.height,
         opts
      );
   }

   /** The grid zone under the pointer while not dragging (shows what a drag would pick). */
   protected readonly hoverZone = signal<{ side: 'a' | 'b'; key: string; part: GridPart | null } | null>(null);
   protected onHitMove(event: PointerEvent, side: 'a' | 'b', h: Hit): void {
      if (!h.grid || this.drag() || !this.canEdit() || !h.id) return;
      const part = this.zoneAt(side, h, event.clientX, event.clientY, { cellOnly: event.altKey });
      const cur = this.hoverZone();
      if (cur && cur.side === side && cur.key === h.key && samePart(cur.part, part)) return;
      this.hoverZone.set({ side, key: h.key, part });
   }
   protected onHitLeave(h: Hit): void {
      // Mid-drag the highlight stays put: changing it toggles the focus view, which clips
      // objects off the slide's edge out from under the pointer (they flashed on and off).
      if (this.drag()) return;
      this.lit.set(null);
      if (this.hoverZone()?.key === h.key) this.hoverZone.set(null);
   }

   /** Grid parts to outline over the slides: the hovered zone and both ends of a part drag. */
   protected readonly zones = computed(() => {
      const out: Array<{
         side: 'a' | 'b';
         key: string;
         box: PctBox;
         label: string;
         kind: 'hover' | 'from' | 'over';
         color: string;
      }> = [];
      const add = (
         side: 'a' | 'b',
         key: string,
         part: GridPart | null,
         kind: 'hover' | 'from' | 'over',
         color: string
      ): void => {
         const h = (side === 'a' ? this.hitsA() : this.hitsB()).find((x) => x.key === key);
         if (!h?.grid) return;
         const box = part ? this.partRect(h, part) : { left: h.left, top: h.top, width: h.width, height: h.height };
         out.push({ side, key: `${kind}-${key}`, box, label: gridPartLabel(part), kind, color });
      };
      const d = this.drag();
      if (d?.active) {
         if (d.from.part !== undefined) add(d.from.side, d.from.key, d.from.part, 'from', d.color);
         if (d.over && (d.from.part !== undefined || d.overPart))
            add(d.from.side === 'a' ? 'b' : 'a', d.over, d.overPart, 'over', d.color);
      } else if (!d) {
         const z = this.hoverZone();
         if (z) add(z.side, z.key, z.part, 'hover', 'var(--dd-primary)');
      }
      return out;
   });
   protected zonesOf(side: string): ReturnType<DeckCompareComponent['zones']> {
      return this.zones().filter((z) => z.side === side);
   }

   /** What a drag from a table part would pair, for the tip line. */
   protected readonly dragTip = computed(() => {
      const d = this.drag();
      if (d?.active && !d.from.part && d.over && d.overPart) {
         return `${gridPartLabel(d.overPart)} pairs with the same spot of the other table · move that end after if needed`;
      }
      if (!d?.active || !d.from.part) return '';
      const kind = d.from.part.kind === 'row' ? 'row' : d.from.part.kind === 'col' ? 'column' : 'cell';
      if (d.over && !d.overPart) return 'Not a table: the two whole objects will morph';
      return d.over
         ? `${gridPartLabel(d.from.part)} morphs ${d.from.side === 'a' ? 'into' : 'from'} ${gridPartLabel(d.overPart)}`
         : `${gridPartLabel(d.from.part)}: drop on a ${kind} of a table on the other slide`;
   });

   /** Grab one end of a pair line: the other end stays, this end follows the pointer. */
   protected startEndDrag(
      event: PointerEvent,
      fixedSide: 'a' | 'b',
      fixedKey: string,
      line: string,
      fixedPart?: GridPart
   ): void {
      if (!this.canEdit() || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.beginDrag(event, { side: fixedSide, key: fixedKey, part: fixedPart }, line, true);
   }

   private beginDrag(event: PointerEvent, from: DragEnd, moving: string | null, active: boolean): void {
      const fromHit = (from.side === 'a' ? this.hitsA() : this.hitsB()).find((x) => x.key === from.key);
      const color = this.lines().find((l) => l.key === moving)?.color ?? fromHit?.color ?? 'var(--dd-primary)';
      this.hoverZone.set(null);
      this.drag.set({
         from,
         moving,
         sx: event.clientX,
         sy: event.clientY,
         active,
         path: '',
         over: null,
         overPart: null,
         color,
      });
      if (active) this.dragTo(event.clientX, event.clientY);
      const move = (e: PointerEvent): void => {
         const d = this.drag();
         if (!d) return;
         if (!d.active && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
         if (!d.active) this.drag.set({ ...d, active: true });
         this.dragTo(e.clientX, e.clientY);
      };
      const up = (e: PointerEvent): void => {
         window.removeEventListener('pointermove', move);
         window.removeEventListener('pointerup', up);
         window.removeEventListener('pointercancel', up);
         const d = this.drag();
         this.drag.set(null);
         if (!d?.active) return;
         this.suppressClick = true;
         setTimeout(() => (this.suppressClick = false), 0);
         // Drop on the object that was highlighted while dragging (what you see is what
         // you get); else whatever is under the pointer now.
         const other: 'a' | 'b' = d.from.side === 'a' ? 'b' : 'a';
         const target: DragEnd | null = d.over
            ? { side: other, key: d.over, part: d.overPart }
            : this.targetAt(e.clientX, e.clientY, d.from);
         if (!target) return;
         const fromHit = (d.from.side === 'a' ? this.hitsA() : this.hitsB()).find((x) => x.key === d.from.key);
         const toHit = (target.side === 'a' ? this.hitsA() : this.hitsB()).find((x) => x.key === target.key);
         if (!fromHit?.id || !toHit?.id) return;
         const [aId, bId] = d.from.side === 'a' ? [fromHit.id, toHit.id] : [toHit.id, fromHit.id];
         // Re-aiming a whole-table line onto a row / column / cell: the fixed end takes the
         // part at the same spot of its own table (its end can be re-aimed in turn).
         const fromPart =
            d.from.part ??
            (target.part && fromHit.grid && toHit.grid
               ? gridMirrorPart(toHit.grid, fromHit.grid, target.part)
               : undefined);
         if (fromPart && target.part) {
            const [aPart, bPart] = d.from.side === 'a' ? [fromPart, target.part] : [target.part, fromPart];
            this.forcePart(aId, aPart, bId, bPart, fromHit.partner === toHit.key);
         } else {
            this.force(aId, bId);
         }
         // Keep the new pair selected, so it is clear what changed.
         this.armed.set({ side: target.side, key: target.key });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
   }

   private dragTo(clientX: number, clientY: number): void {
      const d = this.drag();
      if (!d) return;
      const start = this.centerOf(d.from.side, d.from.key, d.from.part);
      const end = this.toUnits(clientX, clientY);
      if (!start || !end) return;
      const target = this.targetAt(clientX, clientY, d.from);
      const snap = target ? this.centerOf(target.side, target.key, target.part) : null;
      const e = snap ?? end;
      const mx = (start.x + e.x) / 2;
      this.drag.set({
         ...d,
         over: target?.key ?? null,
         overPart: target?.part ?? null,
         path: `M${start.x} ${start.y} C ${mx} ${start.y}, ${mx} ${e.y}, ${e.x} ${e.y}`,
      });
   }

   /**
    * Line ends at the same spot: the selected pair's end wins, then the end on the
    * smaller (inner) object.
    */
   protected endZ(side: 'a' | 'b', key: string, rel: boolean): number {
      const h = (side === 'a' ? this.hitsA() : this.hitsB()).find((x) => x.key === key);
      return 2 + (rel ? 20000 : 0) + (h ? this.hitZ(h) : 0);
   }

   /** Smaller objects sit above larger ones, so things inside others stay pickable; lines on top. */
   protected hitZ(h: Hit): number {
      if (h.line) return 10002;
      return Math.max(1, 10001 - Math.round(h.width * h.height));
   }

   /** Where a bound line end attaches, in world space (for drawing line hits). */
   private readonly targetBox = (bd: ElementBinding): RotatedBox | null => {
      if (bd.targetKind === 'table') {
         const t = this.store.tables().find((x) => x.id === bd.targetId);
         return t ? tableBox(t) : null;
      }
      const e = bd.targetKind === 'element' ? this.store.elements().find((x) => x.id === bd.targetId) : undefined;
      return e ? { ...elementBox(e), angle: e.angle } : null;
   };

   /** The object on the OTHER slide under the pointer, if it can be paired. */
   private targetAt(clientX: number, clientY: number, from: DragEnd): DragEnd | null {
      const fromSide = from.side;
      // Geometry first: the smallest object box on the other slide that holds the pointer
      // (the innermost one, like clicking nested objects on the canvas). It works the same
      // for objects past the slide's edges, whose outlines may be clipped on screen.
      const geo = this.innermostAt(fromSide === 'a' ? 'b' : 'a', clientX, clientY);
      const el = geo
         ? (this.hitEl(fromSide === 'a' ? 'b' : 'a', geo.key) ?? undefined)
         : (document
              .elementsFromPoint(clientX, clientY)
              // Only this view's object outlines: the canvas underneath has "hit" boxes too.
              .filter(
                 (n) =>
                    (n as HTMLElement).classList?.contains('hit') &&
                    !!(n as HTMLElement).dataset['side'] &&
                    this.pairView()?.nativeElement.contains(n)
              )
              .sort((p, q) => p.clientWidth * p.clientHeight - q.clientWidth * q.clientHeight)[0] as
              HTMLElement | undefined);
      const side = el?.dataset['side'] as 'a' | 'b' | undefined;
      const key = el?.dataset['key'];
      if (!side || !key || side === fromSide) return null;
      const h = (side === 'a' ? this.hitsA() : this.hitsB()).find((x) => x.key === key);
      if (!h?.id) return null;
      // From a row / column / cell: only a part of the same kind, of a table, will do.
      // Over anything that is not a table, the drag pairs the whole objects instead.
      if (from.part) {
         if (!h.grid) return { side, key };
         return { side, key, part: this.zoneAt(side, h, clientX, clientY, { level: from.part.kind }) };
      }
      // Re-aiming a table-to-table line: the zones pick a part (the band round it: the table).
      const fromHit = (fromSide === 'a' ? this.hitsA() : this.hitsB()).find((x) => x.key === from.key);
      if (this.drag()?.moving && from.part === undefined && fromHit?.grid && h.grid) {
         return { side, key, part: this.zoneAt(side, h, clientX, clientY, {}) };
      }
      return { side, key };
   }

   /**
    * The object on `side` a click there would pick on the canvas: from the topmost object
    * under the pointer down, see-through (unfilled) shapes let the pointer through to
    * smaller things inside them, and the first solid object stops the search. So a code
    * block inside a rectangle is picked even when it overflows the rectangle.
    */
   private innermostAt(side: 'a' | 'b', clientX: number, clientY: number): Hit | null {
      const u = this.toUnits(clientX, clientY);
      if (!u) return null;
      const x = ((u.x - (side === 'b' ? COL + this.gap() : 0)) / COL) * 100;
      const y = (u.y / this.viewH()) * 100;
      const byId = new Map(this.store.elements().map((e) => [e.id, e] as const));
      const under = (side === 'a' ? this.hitsA() : this.hitsB())
         .filter(
            (h) => !h.line && !!h.id && x >= h.left && x <= h.left + h.width && y >= h.top && y <= h.top + h.height
         )
         .sort((p, q) => (byId.get(q.id!)?.zIndex ?? 0) - (byId.get(p.id!)?.zIndex ?? 0));
      const seeThrough = (h: Hit): boolean => {
         const e = byId.get(h.id!);
         return (
            !!e &&
            (e.type === 'rectangle' || e.type === 'ellipse' || e.type === 'diamond') &&
            (e.fillStyle === 'none' || !e.backgroundColor || e.backgroundColor === 'transparent')
         );
      };
      let best: Hit | null = null;
      for (const h of under) {
         if (!best || h.width * h.height < best.width * best.height) best = h;
         if (!seeThrough(h)) {
            // A solid object on top wins over anything bigger beneath it.
            if (best !== h && !seeThrough(best)) best = h;
            break;
         }
      }
      return best;
   }

   /** Select an object to see what it does and change it. Pairs are only made by dragging. */
   protected clickHit(side: 'a' | 'b', h: Hit): void {
      if (this.suppressClick) return;
      if (!this.canEdit() || !h.id) return;
      const a = this.armed();
      this.armed.set(a && a.side === side && a.key === h.key ? null : { side, key: h.key });
   }

   /** Clicking anywhere but an object, a pair handle or the action bar finishes the selection. */
   protected onOutside(event: Event): void {
      if (this.mode() !== 'stage' || !this.armed()) return;
      const t = event.target as HTMLElement | null;
      // The pair controls under the pairs list act on the selection: clicking them keeps it.
      if (t?.closest('.hit, .end, .cut-line, .actions, .pr, .sel-ctl')) return;
      this.armed.set(null);
   }

   @HostListener('document:keydown.escape', ['$event'])
   protected onEsc(event: Event): void {
      if (this.armed()) {
         this.armed.set(null);
         event.stopPropagation();
         event.preventDefault();
      }
   }

   private idOfKey(key: string | null): string | null {
      if (!key) return null;
      return [...this.hitsA(), ...this.hitsB()].find((x) => x.key === key)?.id ?? null;
   }

   protected unpairArmed(): void {
      const h = this.armedHit();
      const side = this.armed()?.side;
      if (!h) return;
      const aId = side === 'a' ? h.id : this.idOfKey(h.partner);
      const bId = side === 'b' ? h.id : this.idOfKey(h.partner);
      if (h.forced) {
         // A pairing you made: remove its tags, back to automatic.
         void this.store.batchHistory(async () => {
            if (aId) await this.store.updateElement(aId, { morphOut: null });
            if (bId) await this.store.updateElement(bId, { morphIn: null });
         });
         return;
      }
      // Only the later slide's side changes: its object fades in this time.
      if (bId) void this.store.updateElement(bId, { morphIn: `tag:solo-in-${bId.slice(0, 8)}` });
   }

   /**
    * Back to automatic for both objects: they pair with their look-alikes again (or,
    * when those are claimed by pairs you set, they fade out / in).
    */
   protected resetArmed(): void {
      const { aId, bId } = this.armedIds();
      // A pair turned into fade / no transition is no longer paired: find the other end
      // by the shared id the tags carry, and clear it too.
      const ids = [aId, bId].filter((x): x is string => !!x).map((x) => x.slice(0, 8));
      const linked = (k: string | null | undefined): boolean =>
         !!k && /^tag:(solo|cut)-(in|out)-/.test(k) && ids.some((id) => k.includes(id));
      void this.store.batchHistory(async () => {
         for (const e of this.store.elements()) {
            const patch: { morphIn?: null; morphOut?: null } = {};
            if (e.id === bId || linked(e.morphIn)) patch.morphIn = null;
            if (e.id === aId || linked(e.morphOut)) patch.morphOut = null;
            if ((patch.morphIn === null && e.morphIn) || (patch.morphOut === null && e.morphOut)) {
               await this.store.updateElement(e.id, patch);
            }
         }
      });
   }

   /** The selected object (and its partner, if paired): earlier-slide and later-slide ids. */
   private armedIds(): { aId: string | null; bId: string | null } {
      const h = this.armedHit();
      const side = this.armed()?.side;
      if (!h || !side) return { aId: null, bId: null };
      const other = this.idOfKey(h.partner);
      return side === 'a' ? { aId: h.id ?? null, bId: other } : { aId: other, bId: h.id ?? null };
   }

   /**
    * One undo step for both ends: 'solo' = fade out / fade in, 'cut' = no transition,
    * null = automatic. The earlier slide's object speaks with its "out" key, the later
    * slide's with its "in" key.
    */
   private setPairTags(aId: string | null, bId: string | null, kind: 'solo' | 'cut' | null): void {
      if (!aId && !bId) return;
      // Both ends carry both short ids, so Reset on either end can find the other.
      const pair = [aId, bId].map((x) => x?.slice(0, 8) ?? '').join('_');
      void this.store.batchHistory(async () => {
         if (aId) await this.store.updateElement(aId, { morphOut: kind ? `tag:${kind}-out-${pair}` : null });
         if (bId) await this.store.updateElement(bId, { morphIn: kind ? `tag:${kind}-in-${pair}` : null });
      });
   }

   /** Make `aId` (slide before) morph into `bId` (this slide) for this transition only. */
   protected force(aId: string, bId: string): void {
      void this.store.batchHistory(() => this.forceOps(aId, bId));
   }

   private async forceOps(aId: string, bId: string): Promise<void> {
      const tag = `tag:pair-${aId.slice(0, 6)}-${bId.slice(0, 6)}`;
      const els = this.store.elements();
      const oldOut = els.find((e) => e.id === aId)?.morphOut;
      const oldIn = els.find((e) => e.id === bId)?.morphIn;
      // The objects these two were hand-paired with before lose that pairing too,
      // so no stale half-tag is left behind.
      const stale = els.filter(
         (e) =>
            e.id !== aId &&
            e.id !== bId &&
            ((!!oldOut && oldOut.startsWith('tag:pair-') && e.morphIn === oldOut) ||
               (!!oldIn && oldIn.startsWith('tag:pair-') && e.morphOut === oldIn))
      );
      for (const e of stale) {
         await this.store.updateElement(e.id, e.morphIn === oldOut ? { morphIn: null } : { morphOut: null });
      }
      await this.store.updateElement(aId, { morphOut: tag });
      await this.store.updateElement(bId, { morphIn: tag });
   }

   /**
    * Make a row / column / cell of grid `aId` (slide before) morph into one of grid
    * `bId`: split `out` / `in` tags in the grids' own JSON. The two tables are paired
    * too when they were not already.
    */
   protected forcePart(aId: string, aPart: GridPart, bId: string, bPart: GridPart, tablesPaired: boolean): void {
      const tag = `pair-${Math.random().toString(36).slice(2, 10)}`;
      const els = this.store.elements();
      const ea = els.find((x) => x.id === aId);
      const eb = els.find((x) => x.id === bId);
      if (ea?.type !== 'grid' || eb?.type !== 'grid') return;
      const oldOut = gridPartTag(parseGrid(ea.text), aPart, 'out');
      const oldIn = gridPartTag(parseGrid(eb.text), bPart, 'in');
      // The parts these two were paired with before lose that pairing too.
      const frames = new Set([this.previous()?.id, this.slide().id]);
      const grids = new Map<string, GridData>();
      for (const e of els) {
         if (e.type !== 'grid' || !e.slideId || !frames.has(e.slideId)) continue;
         const g = parseGrid(e.text);
         let m = g.morph;
         if (oldOut) m = clearGridTag(m, 'in', oldOut);
         if (oldIn) m = clearGridTag(m, 'out', oldIn);
         if (e.id === aId) m = setGridPartTag(m, aPart, 'out', tag);
         if (e.id === bId) m = setGridPartTag(m, bPart, 'in', tag);
         grids.set(e.id, { ...g, morph: m });
      }
      void this.store.batchHistory(async () => {
         if (!tablesPaired) await this.forceOps(aId, bId);
         for (const [id, g] of grids) {
            const text = serializeGrid(g);
            if (text !== els.find((x) => x.id === id)?.text) await this.store.updateElement(id, { text });
         }
      });
   }

   /** Remove a row / column / cell pairing (back to automatic). */
   protected removePartLine(l: PartLine): void {
      const els = this.store.elements();
      void this.store.batchHistory(async () => {
         for (const [id, dir] of [
            [l.aId, 'out'],
            [l.bId, 'in'],
         ] as const) {
            const e = els.find((x) => x.id === id);
            if (!e) continue;
            const g = parseGrid(e.text);
            await this.store.updateElement(id, {
               text: serializeGrid({ ...g, morph: clearGridTag(g.morph, dir, l.tag) }),
            });
         }
      });
      this.lit.set(null);
   }

   /** Rows, columns and cells paired by hand between two paired tables, as lines. */
   protected readonly partLines = computed<PartLine[]>(() => {
      if (!this.previous()) return [];
      const els = new Map(this.store.elements().map((e) => [e.id, e] as const));
      const out: PartLine[] = [];
      const { A, B, matches } = this.matching();
      matches.forEach(([i, j], n) => {
         const ea = A[i].id ? els.get(A[i].id!) : undefined;
         const eb = B[j].id ? els.get(B[j].id!) : undefined;
         if (ea?.type !== 'grid' || eb?.type !== 'grid') return;
         const ga = parseGrid(ea.text);
         const gb = parseGrid(eb.text);
         if (!ga.morph || !gb.morph) return;
         const p = gridMorphPairs(ga, gb);
         const parts: Array<[GridPart, GridPart]> = [
            ...p.rows.map(([x, y]): [GridPart, GridPart] => [
               { kind: 'row', i: x },
               { kind: 'row', i: y },
            ]),
            ...p.cols.map(([x, y]): [GridPart, GridPart] => [
               { kind: 'col', i: x },
               { kind: 'col', i: y },
            ]),
            ...p.cells.map(([x, y]): [GridPart, GridPart] => [
               { kind: 'cell', r: x[0], c: x[1] },
               { kind: 'cell', r: y[0], c: y[1] },
            ]),
         ];
         for (const [pa, pb] of parts) {
            const s = this.centerOf('a', `a${i}`, pa);
            const e = this.centerOf('b', `b${j}`, pb);
            if (!s || !e) continue;
            const mx = (s.x + e.x) / 2;
            out.push({
               key: `${i}-${j}-${JSON.stringify(pa)}`,
               pa,
               pb,
               a: `a${i}`,
               b: `b${j}`,
               aId: ea.id,
               bId: eb.id,
               tag: gridPartTag(ga, pa, 'out')!,
               color: PAIR_COLORS[n % PAIR_COLORS.length],
               label: `${gridPartLabel(pa)} → ${gridPartLabel(pb)}`,
               x1: s.x,
               y1: s.y,
               x2: e.x,
               y2: e.y,
               d: `M${s.x} ${s.y} C ${mx} ${s.y}, ${mx} ${e.y}, ${e.x} ${e.y}`,
            });
         }
      });
      return out;
   });

   /** Drop the hand-set in / out tags of a pairing: back to automatic matching. */
   protected resetPair(p: MorphPair): void {
      void this.store.batchHistory(async () => {
         if (p.aId) await this.store.updateElement(p.aId, { morphOut: null });
         if (p.bId) await this.store.updateElement(p.bId, { morphIn: null });
      });
   }

   // ---- geometry of the pair view: two slides of COL units with a GAP between ----
   protected readonly viewH = computed(() => (COL * this.slide().height) / (this.slide().width || 1));
   /**
    * Space between the two previews: wider by however far objects hang off the facing
    * edges (the first slide's right, the second's left), so they never land on the
    * other slide.
    */
   protected readonly gap = computed(() => {
      const right = Math.max(0, ...this.hitsA().map((h) => h.left + h.width - 100));
      const left = Math.max(0, ...this.hitsB().map((h) => -h.left));
      return right || left ? GAP + ((right + left) / 100) * COL + 2 : GAP;
   });
   /** Width of the pair view in units (two slides and the gap). */
   protected readonly total = computed(() => 2 * COL + this.gap());
   protected readonly colPct = computed(() => `${(COL / this.total()) * 100}%`);
   protected readonly gapPct = computed(() => `${(this.gap() / this.total()) * 100}%`);
   protected readonly viewRatio = computed(() => `${this.total()} / ${this.viewH()}`);
   protected readonly lines = computed(() => {
      const prev = this.previous();
      const cur = this.slide();
      if (!prev) return [];
      const ka = COL / (prev.width || 1);
      const kb = COL / (cur.width || 1);
      const { A, B, matches } = this.matching();
      // Tables whose rows / columns / cells are paired show those links instead.
      const parted = new Set(this.partLines().map((l) => `${l.a}-${l.b}`));
      return matches.flatMap(([i, j], n) => {
         if (parted.has(`a${i}-b${j}`)) return [];
         const a = A[i].item;
         const b = B[j].item;
         // A line/arrow's link end sits at the middle of the drawn line.
         const la = this.hitsA()[i]?.line;
         const lb = this.hitsB()[j]?.line;
         const x1 = la ? (la.cx / 100) * COL : a.cx * ka;
         const y1 = la ? (la.cy / 100) * prev.height * ka : a.cy * ka;
         const x2 = COL + this.gap() + (lb ? (lb.cx / 100) * COL : b.cx * kb);
         const y2 = lb ? (lb.cy / 100) * cur.height * kb : b.cy * kb;
         const mx = (x1 + x2) / 2;
         return {
            key: `${i}-${j}`,
            a: `a${i}`,
            b: `b${j}`,
            aId: A[i].id,
            bId: B[j].id,
            x1,
            y1,
            x2,
            y2,
            color: PAIR_COLORS[n % PAIR_COLORS.length],
            d: `M${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`,
         };
      });
   });

   // ---- the pairs list (right dock) ----
   protected readonly pairs = computed<MorphPair[]>(() => {
      const { A, B, matches } = this.matching();
      const usedA = new Set(matches.map(([i]) => i));
      const usedB = new Set(matches.map(([, j]) => j));
      const out: MorphPair[] = matches.map(([i, j], n) => {
         const a = A[i].item;
         const b = B[j].item;
         const forced = !!a.keyOut && a.keyOut === b.keyIn;
         const why: MorphPair['why'] =
            forced || ((a.keyOut ?? a.key) === (b.keyIn ?? b.key) && (b.keyIn ?? b.key).startsWith('tag:'))
               ? 'tag'
               : b.type === 'text'
                 ? 'text'
                 : a.text && a.text === b.text
                   ? 'name'
                   : 'look-alike';
         return {
            from: A[i].label,
            to: B[j].label,
            why,
            a: { x: a.cx, y: a.cy },
            b: { x: b.cx, y: b.cy },
            aId: A[i].id,
            bId: B[j].id,
            forced,
            aKey: `a${i}`,
            bKey: `b${j}`,
            color: PAIR_COLORS[n % PAIR_COLORS.length],
         };
      });
      B.forEach((b, j) => {
         if (!usedB.has(j))
            out.push({
               from: '—',
               to: b.label,
               why: 'fades in',
               aId: null,
               bId: b.id,
               forced: !!b.item.keyIn,
               cut: !!b.item.keyIn?.startsWith('tag:cut-'),
               aKey: null,
               bKey: `b${j}`,
               color: null,
            });
      });
      A.forEach((a, i) => {
         if (!usedA.has(i))
            out.push({
               from: a.label,
               to: '—',
               why: 'fades out',
               aId: a.id,
               bId: null,
               forced: !!a.item.keyOut,
               cut: !!a.item.keyOut?.startsWith('tag:cut-'),
               aKey: `a${i}`,
               bKey: null,
               color: null,
            });
      });
      return out;
   });
   protected readonly matched = computed(() => this.pairs().filter((p) => p.a).length);
   protected readonly fresh = computed(() => this.pairs().filter((p) => p.why === 'fades in').length);

   private itemsOf(frame: CanvasElementModel): Side[] {
      const byId = new Map(this.store.elements().map((e) => [e.id, e] as const));
      const out: Side[] = [];
      for (const e of this.store.elements()) {
         if (e.slideId !== frame.id || e.type === 'frame' || (e.placeholder && !(e.text ?? '').trim())) continue;
         const text = (e.text ?? '').trim();
         out.push({
            item: {
               key: slideMorphKey(e, (id) => byId.get(id)),
               keyIn: e.morphIn ?? undefined,
               keyOut: e.morphOut ?? undefined,
               kind: 'element',
               type: e.type,
               text: e.type === 'grid' ? '' : (e.text ?? ''),
               cx: e.x + e.width / 2 - frame.x,
               cy: e.y + e.height / 2 - frame.y,
               w: e.width,
               h: e.height,
            },
            label: (e.type === 'grid' ? '' : text.split('\n')[0].slice(0, 28)) || e.fileName || e.type,
            id: e.id,
         });
      }
      for (const t of this.store.tables()) {
         if (t.slideId !== frame.id) continue;
         const b = tableBox(t);
         out.push({
            item: {
               key: t.morphId ?? t.id,
               kind: 'table',
               type: 'table',
               text: t.name,
               cx: (b.x0 + b.x1) / 2 - frame.x,
               cy: (b.y0 + b.y1) / 2 - frame.y,
               w: b.x1 - b.x0,
               h: b.y1 - b.y0,
            },
            label: t.name,
            id: null,
         });
      }
      return out;
   }

   // ---- zoom (Map pairs) ----
   protected readonly zoom = signal(1);
   /** Below 100% the objects sitting off the slides' edges come into view. */
   protected readonly minZoom = MIN_ZOOM;
   protected setZoom(z: number): void {
      this.zoom.set(Math.min(4, Math.max(MIN_ZOOM, Math.round(z * 100) / 100)));
   }
   /** The wheel zooms around the pointer, like the canvas. */
   protected onZoomWheel(e: WheelEvent): void {
      e.preventDefault();
      const fit = e.currentTarget as HTMLElement;
      const view = this.pairView()?.nativeElement;
      if (!view) return;
      const before = view.getBoundingClientRect();
      const fx = (e.clientX - before.left) / before.width;
      const fy = (e.clientY - before.top) / before.height;
      this.setZoom(this.zoom() * Math.exp(-e.deltaY * 0.0025));
      requestAnimationFrame(() => {
         const after = view.getBoundingClientRect();
         fit.scrollLeft += after.left + fx * after.width - e.clientX;
         fit.scrollTop += after.top + fy * after.height - e.clientY;
      });
   }

   /** The number shown on the pair's objects. */
   protected pairNum(p: MorphPair): number | null {
      const k = p.bKey ?? p.aKey;
      if (!k) return null;
      return (k.startsWith('a') ? this.hitsA() : this.hitsB()).find((h) => h.key === k)?.num ?? null;
   }

   /** Middle-button drag pans the zoomed view. */
   protected startPan(e: PointerEvent): void {
      if (e.button !== 1) return;
      e.preventDefault();
      const fit = e.currentTarget as HTMLElement;
      const sx = e.clientX,
         sy = e.clientY,
         l = fit.scrollLeft,
         t = fit.scrollTop;
      fit.classList.add('panning');
      const move = (m: PointerEvent): void => {
         fit.scrollLeft = l - (m.clientX - sx);
         fit.scrollTop = t - (m.clientY - sy);
      };
      const up = (): void => {
         fit.classList.remove('panning');
         window.removeEventListener('pointermove', move);
         window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
   }

   // ---- preview strip ----
   private readonly stageHost = viewChild<ElementRef<HTMLElement>>('stageHost');
   private readonly bigHost = viewChild<ElementRef<HTMLElement>>('bigHost');
   /** The visible player: the big one on the Preview tab, else the strip. */
   private readonly playerHost = (): HTMLElement | undefined =>
      (this.view() === 'preview' ? this.bigHost() : this.stageHost())?.nativeElement;
   private readonly player = new ComparePreviewPlayer({
      render: inject(SlideRenderService),
      host: this.playerHost,
      easing: () => this.slide().slide?.transition?.easing ?? 'ease-in-out',
      duration: () => this.duration(),
      morphs: () => this.isMorph(),
      neighbours: () => [this.before(), this.after()],
   });
   protected readonly srcs = this.player.srcs;
   /** Scrubbed position, 0 = the slide before, 1 = this slide (linear time). */
   protected readonly progress = this.player.progress;
   protected readonly playing = this.player.playing;
   /** Opening the Preview tab starts the scrubber at the beginning. */
   private readonly previewStart = effect(() => {
      if (this.view() !== 'preview') return;
      untracked(() => this.player.scrub(0));
   });
   /**
    * The preview plays the real transition on a live stage for every type (fade, slide,
    * zoom, a cut, with or without morph), not just a cross-fade of two pictures.
    */
   protected readonly isMorph = computed(() => !!this.previous());
   /** The transition into this slide is None: a cut, nothing morphs, so no pairs. */
   protected readonly isCut = computed(() => !transitionMorphs(this.slide().slide?.transition));
   protected readonly ratio = computed(() => `${this.slide().width} / ${this.slide().height}`);
   protected readonly duration = computed(() => this.slide().slide?.transition?.duration ?? 300);
   protected readonly nowMs = computed(() => Math.round(this.progress() * this.duration()));
   /** Put the live morph scene (or the cross-fade pictures) in the visible player. */
   private readonly placeScene = effect(() => {
      this.view();
      this.bigHost();
      this.stageHost();
      untracked(() => this.player.place(this.playerHost()));
   });

   /** Embedders read the play state and press play through CompareUiState. */
   private readonly mirrorPlaying = effect(() => {
      const playing = this.playing();
      untracked(() => this.ui.previewPlaying.set(playing));
   });
   private playRequestsSeen = untracked(() => this.ui.previewPlayRequests());
   private readonly playOnRequest = effect(() => {
      const n = this.ui.previewPlayRequests();
      if (n === this.playRequestsSeen || this.mode() !== 'stage') return;
      this.playRequestsSeen = n;
      untracked(() => this.player.togglePlay());
   });

   protected scrub(p: number): void {
      this.player.scrub(p);
   }

   protected togglePlay(): void {
      this.player.togglePlay();
   }

   private readonly hostEl = inject(ElementRef<HTMLElement>);
   private readonly followRow = effect(() => {
      if (this.mode() !== 'pairs') return;
      this.armed();
      this.lit();
      setTimeout(
         () =>
            (this.hostEl.nativeElement as HTMLElement)
               .querySelector('.pr.armedrow, .pr.on')
               ?.scrollIntoView({ block: 'nearest' }),
         0
      );
   });

   constructor() {
      // Re-render the pair when it changes or the project data does (debounced while editing).
      effect((onCleanup) => {
         if (this.mode() !== 'stage') return;
         const frames = [this.previous(), this.slide()];
         const data = [this.store.elements(), this.store.tables(), this.store.relationships()];
         const delay = untracked(() => this.player.update(frames, data));
         if (delay === null) return;
         const timer = setTimeout(() => void untracked(() => this.player.draw(frames)), delay);
         onCleanup(() => clearTimeout(timer));
      });
      // Capture phase: the editor stops pointerdown from bubbling out of this screen.
      const outside = (e: Event): void => this.onOutside(e);
      document.addEventListener('pointerdown', outside, true);
      this.destroyRef.onDestroy(() => document.removeEventListener('pointerdown', outside, true));
      this.destroyRef.onDestroy(() => this.player.dispose());
   }
}
