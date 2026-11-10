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
import { matchMorphItems, slideMorphKey, type CanvasElementModel, type MorphItem } from '@devdesigner/shared';
import { ProjectStore } from '../state/project/project.store';
import { tableBox } from '../canvas/helpers/node-metrics.helper';
import { SlideRenderService, type RenderedSlide } from './slide-render.service';
import { MorphStage } from './morph-stage';
import { ease } from './helpers/ease.helper';
import { CompareUiState } from './services/compare-ui-state.service';

interface Side {
   item: MorphItem;
   label: string;
   /** Element id (pairs can be set by hand for elements only; tables pair by name). */
   id: string | null;
}

export interface MorphPair {
   from: string;
   to: string;
   why: 'text' | 'name' | 'tag' | 'look-alike' | 'fades in' | 'fades out';
   /** Item centres relative to their frames. */
   a?: { x: number; y: number };
   b?: { x: number; y: number };
   /** Element ids on the slide before / after (null = table or nothing). */
   aId: string | null;
   bId: string | null;
   /** Set by hand (split in / out tags on these objects). */
   forced: boolean;
   /** Set to "no transition". */
   cut?: boolean;
   /** Stage keys of the two objects ("a3" / "b1"), for highlighting. */
   aKey: string | null;
   bKey: string | null;
   color: string | null;
}

/** One object outline drawn over a slide picture (percent of the slide box). */
interface Hit {
   key: string;
   id: string | null;
   label: string;
   left: number;
   top: number;
   width: number;
   height: number;
   /** Pair number and colour; null = fades in / out. */
   num: number | null;
   color: string | null;
   forced: boolean;
   /** The partner's key on the other slide. */
   partner: string | null;
   /** Set to "no transition" on this side: switches instantly. */
   cut: boolean;
   /** Set to never morph here (fades). */
   solo: boolean;
   /** Also morphs from the slide before the before-slide (a side) / into the slide after (b side). */
   chain: string | null;
}

const PAIR_COLORS = ['#2bb3a8', '#6f8bff', '#e0a84a', '#ef6b6b', '#9b7bff', '#3fb950', '#e879c6', '#5ac8fa'];
/** Slide width and gap as parts of the 100-unit pair view. */
const COL = 46;
const GAP = 8;

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
   private readonly render = inject(SlideRenderService);
   private readonly destroyRef = inject(DestroyRef);
   protected readonly canEdit = this.store.canEdit;

   // ---- mapping ----
   /** The object picked first (waiting for its partner on the other slide). */
   private readonly ui = inject(CompareUiState);
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
   protected removeLine(l: { a: string; b: string; aId: string | null; bId: string | null }): void {
      const b = this.hitsB().find((h) => h.key === l.b);
      if (b?.forced) {
         void this.store.batchHistory(async () => {
            if (l.aId) await this.store.updateElement(l.aId, { morphOut: null });
            if (l.bId) await this.store.updateElement(l.bId, { morphIn: null });
         });
      } else if (l.bId) {
         void this.store.updateElement(l.bId, { morphIn: `tag:solo-in-${l.bId.slice(0, 8)}` });
      }
      this.lit.set(null);
   }

   /** No transition for the picked object on this side: it switches instantly. */
   protected cutArmed(): void {
      const h = this.armedHit();
      const side = this.armed()?.side;
      if (!h?.id || !side) return;
      const tag = `tag:cut-${side === 'a' ? 'out' : 'in'}-${h.id.slice(0, 8)}`;
      void this.store.batchHistory(async () => {
         await this.store.updateElement(h.id!, side === 'a' ? { morphOut: tag } : { morphIn: tag });
         // A pair made by hand loses its other half too.
         const partner = this.idOfKey(h.partner);
         if (h.forced && partner)
            await this.store.updateElement(partner, side === 'a' ? { morphIn: null } : { morphOut: null });
      });
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
      const morph = this.slide().slide?.transition?.type === 'morph';
      const matches = morph
         ? matchMorphItems(
              A.map((x) => x.item),
              B.map((x) => x.item)
           )
         : [];
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
         return {
            key: `${side}${k}`,
            id: s.id,
            label: s.label,
            left: ((it.cx - it.w / 2) / frame.width) * 100,
            top: ((it.cy - it.h / 2) / frame.height) * 100,
            width: (it.w / frame.width) * 100,
            height: (it.h / frame.height) * 100,
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
      if (!from || !to || to.slide?.transition?.type !== 'morph') return out;
      const A = this.itemsOf(from);
      const B = this.itemsOf(to);
      for (const [i, j] of matchMorphItems(
         A.map((x) => x.item),
         B.map((x) => x.item)
      )) {
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
      from: { side: 'a' | 'b'; key: string };
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

   /** Centre of an object in pair-view units. */
   private centerOf(side: 'a' | 'b', key: string): { x: number; y: number } | null {
      const h = (side === 'a' ? this.hitsA() : this.hitsB()).find((x) => x.key === key);
      if (!h) return null;
      return {
         x: ((h.left + h.width / 2) / 100) * COL + (side === 'b' ? COL + GAP : 0),
         y: ((h.top + h.height / 2) / 100) * this.viewH(),
      };
   }

   private toUnits(clientX: number, clientY: number): { x: number; y: number } | null {
      const el = this.pairView()?.nativeElement;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: ((clientX - r.left) / r.width) * 100, y: ((clientY - r.top) / r.height) * this.viewH() };
   }

   protected startDrag(event: PointerEvent, side: 'a' | 'b', h: Hit): void {
      if (!this.canEdit() || !h.id || event.button !== 0) return;
      this.beginDrag(event, { side, key: h.key }, null, false);
   }

   /** Grab one end of a pair line: the other end stays, this end follows the pointer. */
   protected startEndDrag(event: PointerEvent, fixedSide: 'a' | 'b', fixedKey: string, line: string): void {
      if (!this.canEdit() || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.beginDrag(event, { side: fixedSide, key: fixedKey }, line, true);
   }

   private beginDrag(
      event: PointerEvent,
      from: { side: 'a' | 'b'; key: string },
      moving: string | null,
      active: boolean
   ): void {
      const fromHit = (from.side === 'a' ? this.hitsA() : this.hitsB()).find((x) => x.key === from.key);
      const color = this.lines().find((l) => l.key === moving)?.color ?? fromHit?.color ?? 'var(--dd-primary)';
      this.drag.set({ from, moving, sx: event.clientX, sy: event.clientY, active, path: '', over: null, color });
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
         const target = d.over ? { side: other, key: d.over } : this.targetAt(e.clientX, e.clientY, d.from.side);
         if (!target) return;
         const fromHit = (d.from.side === 'a' ? this.hitsA() : this.hitsB()).find((x) => x.key === d.from.key);
         const toHit = (target.side === 'a' ? this.hitsA() : this.hitsB()).find((x) => x.key === target.key);
         if (!fromHit?.id || !toHit?.id) return;
         const [aId, bId] = d.from.side === 'a' ? [fromHit.id, toHit.id] : [toHit.id, fromHit.id];
         this.force(aId, bId);
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
      const start = this.centerOf(d.from.side, d.from.key);
      const end = this.toUnits(clientX, clientY);
      if (!start || !end) return;
      const target = this.targetAt(clientX, clientY, d.from.side);
      const snap = target ? this.centerOf(target.side, target.key) : null;
      const e = snap ?? end;
      const mx = (start.x + e.x) / 2;
      this.drag.set({
         ...d,
         over: target?.key ?? null,
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

   /** Smaller objects sit above larger ones, so things inside others stay pickable. */
   protected hitZ(h: Hit): number {
      return Math.max(1, 10001 - Math.round(h.width * h.height));
   }

   /** The object on the OTHER slide under the pointer, if it can be paired. */
   private targetAt(clientX: number, clientY: number, fromSide: 'a' | 'b'): { side: 'a' | 'b'; key: string } | null {
      // The smallest object under the pointer (the innermost one).
      const el = document
         .elementsFromPoint(clientX, clientY)
         // Only this view's object outlines: the canvas underneath has "hit" boxes too.
         .filter(
            (n) =>
               (n as HTMLElement).classList?.contains('hit') &&
               !!(n as HTMLElement).dataset['side'] &&
               this.pairView()?.nativeElement.contains(n)
         )
         .sort((p, q) => p.clientWidth * p.clientHeight - q.clientWidth * q.clientHeight)[0] as HTMLElement | undefined;
      const side = el?.dataset['side'] as 'a' | 'b' | undefined;
      const key = el?.dataset['key'];
      if (!side || !key || side === fromSide) return null;
      const h = (side === 'a' ? this.hitsA() : this.hitsB()).find((x) => x.key === key);
      return h?.id ? { side, key } : null;
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
      if (t?.closest('.hit, .end, .cut-line, .actions, .pr')) return;
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

   protected resetArmed(): void {
      const h = this.armedHit();
      const side = this.armed()?.side;
      if (!h) return;
      const aId = side === 'a' ? h.id : h.forced ? this.idOfKey(h.partner) : null;
      const bId = side === 'b' ? h.id : h.forced ? this.idOfKey(h.partner) : null;
      void this.store.batchHistory(async () => {
         if (aId) await this.store.updateElement(aId, { morphOut: null });
         if (bId) await this.store.updateElement(bId, { morphIn: null });
      });
   }

   /** Make `aId` (slide before) morph into `bId` (this slide) for this transition only. */
   protected force(aId: string, bId: string): void {
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
      void this.store.batchHistory(async () => {
         for (const e of stale) {
            await this.store.updateElement(e.id, e.morphIn === oldOut ? { morphIn: null } : { morphOut: null });
         }
         await this.store.updateElement(aId, { morphOut: tag });
         await this.store.updateElement(bId, { morphIn: tag });
      });
   }

   /** Drop the hand-set in / out tags of a pairing: back to automatic matching. */
   protected resetPair(p: MorphPair): void {
      void this.store.batchHistory(async () => {
         if (p.aId) await this.store.updateElement(p.aId, { morphOut: null });
         if (p.bId) await this.store.updateElement(p.bId, { morphIn: null });
      });
   }

   // ---- geometry of the pair view: two slides of COL units with a GAP between ----
   protected readonly viewH = computed(() => (COL * this.slide().height) / (this.slide().width || 1));
   protected readonly viewRatio = computed(() => `${100} / ${this.viewH()}`);
   protected readonly lines = computed(() => {
      const prev = this.previous();
      const cur = this.slide();
      if (!prev) return [];
      const ka = COL / (prev.width || 1);
      const kb = COL / (cur.width || 1);
      const { A, B, matches } = this.matching();
      return matches.map(([i, j], n) => {
         const a = A[i].item;
         const b = B[j].item;
         const x1 = a.cx * ka;
         const y1 = a.cy * ka;
         const x2 = COL + GAP + b.cx * kb;
         const y2 = b.cy * kb;
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
   protected setZoom(z: number): void {
      this.zoom.set(Math.min(4, Math.max(1, Math.round(z * 100) / 100)));
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
   protected readonly srcs = signal<(string | null)[]>([null, null]);
   /** Scrubbed position, 0 = the slide before, 1 = this slide (linear time). */
   protected readonly progress = signal(1);
   protected readonly playing = signal(false);
   /** Opening the Preview tab starts the scrubber at the beginning. */
   private readonly previewStart = effect(() => {
      if (this.view() !== 'preview') return;
      untracked(() => {
         this.stop();
         this.show(0);
      });
   });
   protected readonly isMorph = computed(() => this.slide().slide?.transition?.type === 'morph');
   protected readonly ratio = computed(() => `${this.slide().width} / ${this.slide().height}`);
   protected readonly duration = computed(() => this.slide().slide?.transition?.duration ?? 300);
   protected readonly nowMs = computed(() => Math.round(this.progress() * this.duration()));
   private readonly stageHost = viewChild<ElementRef<HTMLElement>>('stageHost');
   private readonly bigHost = viewChild<ElementRef<HTMLElement>>('bigHost');
   /** Put the live morph scene (or the cross-fade pictures) in the visible player. */
   private readonly placeScene = effect(() => {
      const big = this.bigHost()?.nativeElement;
      const small = this.stageHost()?.nativeElement;
      const host = this.view() === 'preview' ? big : small;
      if (host && this.morph && this.morph.svg.parentElement !== host) host.appendChild(this.morph.svg);
   });
   private morph: MorphStage | null = null;
   private raf = 0;

   protected scrub(p: number): void {
      this.stop();
      this.show(p);
   }

   private show(p: number): void {
      this.progress.set(Math.min(1, Math.max(0, p)));
      const easing = this.slide().slide?.transition?.easing ?? 'ease-in-out';
      this.morph?.update(ease(easing, this.progress()));
   }

   protected togglePlay(): void {
      if (this.playing()) {
         this.stop();
         return;
      }
      // At the end, "Restart" just rewinds; pressing again plays.
      if (this.progress() >= 1) {
         this.show(0);
         return;
      }
      const total = this.duration() || 300;
      const from = this.progress();
      const begin = performance.now() - from * total;
      this.playing.set(true);
      const tick = (now: number): void => {
         if (!this.playing()) return;
         const lin = Math.min(1, (now - begin) / total);
         this.show(lin);
         if (lin < 1) this.raf = requestAnimationFrame(tick);
         else this.playing.set(false);
      };
      this.raf = requestAnimationFrame(tick);
   }

   private stop(): void {
      cancelAnimationFrame(this.raf);
      this.playing.set(false);
   }

   private async buildMorph(rendered: RenderedSlide[]): Promise<void> {
      const host = (this.view() === 'preview' ? this.bigHost() : this.stageHost())?.nativeElement;
      if (!host) return;
      this.morph?.svg.remove();
      this.morph = null;
      if (rendered.length < 2 || !this.isMorph()) return;
      const stage = new MorphStage(rendered[0], rendered[1]);
      host.appendChild(stage.svg);
      await stage.prepare();
      this.morph = stage;
      this.show(this.progress());
   }

   private token = 0;
   /** Ids of the slide pair the current pictures belong to. */
   private drawnKey = '';
   /**
    * Rendered slides by frame id, valid until the project data changes. Neighbouring
    * slides are rendered ahead of time so stepping between pairs swaps pictures at once.
    */
   private cache = new Map<string, { r: RenderedSlide; url: string }>();
   private cacheData: unknown[] = [];

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
      effect((onCleanup) => {
         if (this.mode() !== 'stage') return;
         const frames = [this.previous(), this.slide()];
         const data = [this.store.elements(), this.store.tables(), this.store.relationships()];
         const edited = data.some((d, i) => d !== this.cacheData[i]);
         if (edited) {
            this.cacheData = data;
            this.clearCache();
         }
         const key = frames.map((f) => f?.id ?? '').join('|');
         const switched = key !== this.drawnKey;
         if (switched) {
            this.drawnKey = key;
            this.token += 1;
            untracked(() => {
               // Already rendered (the usual case when stepping): swap at once.
               if (this.showCached(frames)) return;
               // Not ready yet: never leave the previous pair's pictures up.
               this.srcs.set([null, null]);
               this.morph?.svg.remove();
               this.morph = null;
            });
            if (!edited && untracked(() => frames.every((f) => !f || this.cache.has(f.id)))) {
               untracked(() => this.prefetch());
               return;
            }
         }
         const timer = setTimeout(() => void untracked(() => this.draw(frames)), switched ? 0 : 200);
         onCleanup(() => clearTimeout(timer));
      });
      // Capture phase: the editor stops pointerdown from bubbling out of this screen.
      const outside = (e: Event): void => this.onOutside(e);
      document.addEventListener('pointerdown', outside, true);
      this.destroyRef.onDestroy(() => document.removeEventListener('pointerdown', outside, true));
      this.destroyRef.onDestroy(() => {
         this.stop();
         this.token += 1;
         this.clearCache();
      });
   }

   private clearCache(): void {
      this.cache.forEach((c) => URL.revokeObjectURL(c.url));
      this.cache = new Map();
   }

   /** Show the pair from the cache; false when a slide is not rendered yet. */
   private showCached(frames: (CanvasElementModel | null)[]): boolean {
      if (!frames.every((f) => !f || this.cache.has(f.id))) return false;
      const hits = frames.map((f) => (f ? this.cache.get(f.id)! : null));
      void this.buildMorph(hits.filter((h) => !!h).map((h) => h!.r));
      this.srcs.set(hits.map((h) => h?.url ?? null));
      return true;
   }

   private async renderMissing(frames: (CanvasElementModel | null)[]): Promise<boolean> {
      const missing = frames.filter((f): f is CanvasElementModel => !!f && !this.cache.has(f.id));
      if (!missing.length) return true;
      const cache = this.cache;
      const rendered = await this.render.render(missing, { fonts: true });
      if (cache !== this.cache) return false;
      for (const r of rendered) {
         if (cache.has(r.id)) continue;
         cache.set(r.id, { r, url: URL.createObjectURL(new Blob([r.svg], { type: 'image/svg+xml;charset=utf-8' })) });
      }
      return true;
   }

   private async draw(frames: (CanvasElementModel | null)[]): Promise<void> {
      const t = ++this.token;
      const data = this.cacheData;
      await this.renderMissing(frames);
      if (t !== this.token || data !== this.cacheData) return;
      this.showCached(frames);
      this.prefetch();
   }

   /** Render the slides either side of this pair in the background. */
   private prefetch(): void {
      const data = this.cacheData;
      setTimeout(() => {
         if (data !== this.cacheData) return;
         void this.renderMissing([this.before(), this.after()]);
      }, 50);
   }
}
