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
   type GridPart,
   type MorphBy,
   effectiveTransition,
   matchMorphItems,
   morphMode,
   onlyYourPairs,
   transitionMorphs,
} from '@devdesigner/shared';
import { type RotatedBox, elementBox } from '../../../../helpers/element-geometry.helper';
import { ProjectStore } from '../../../../state/project/project.store';
import { tableBox } from '../../../../helpers/node-metrics.helper';
import { SlideRenderService } from '../../services/slide-render.service';
import { ComparePreviewPlayer } from './helpers/compare-preview-player';
import { CompareUiState } from './services/compare-ui-state.service';
import { gridPartBox, gridPartLabel, samePart } from './grid-zones.helper';
import {
   COL,
   type DragEnd,
   GAP,
   type Hit,
   MIN_ZOOM,
   type MorphPair,
   type PartLine,
   type PctBox,
   type Side,
} from './deck-compare.model';
import { DecimalPipe } from '@angular/common';
import { AtPipe, CallPipe, HasPipe } from '../../../../../../shared/ui/pipes/collection.pipes';
import { DeckCompareHits } from './deck-compare-hits';
import { DeckCompareDrag } from './deck-compare-drag';

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
   imports: [HasPipe, AtPipe, CallPipe, DecimalPipe],

   templateUrl: './deck-compare.component.html',
   styleUrl: './deck-compare.component.scss',
})
export class DeckCompareComponent {
   /** Methods moved to deck-compare-drag.ts. */
   private readonly deckCompareDrag = new DeckCompareDrag(this);

   /** Methods moved to deck-compare-hits.ts. */
   private readonly deckCompareHits = new DeckCompareHits(this);

   /** The slide the transition goes into. */
   readonly slide = input.required<CanvasElementModel>();
   /** The slide before it (null for the first slide). */
   readonly previous = input<CanvasElementModel | null>(null);
   /** 1-based number of the previous slide. */
   readonly index$ = input(1, { alias: 'index' });
   /** The slide before `previous`, and the slide after `slide` (onward / earlier pairing badges). */
   readonly before = input<CanvasElementModel | null>(null);
   readonly after = input<CanvasElementModel | null>(null);
   readonly mode$ = input<'stage' | 'pairs'>('stage', { alias: 'mode' });
   readonly preview = output<void>();

   readonly store = inject(ProjectStore);
   private readonly destroyRef = inject(DestroyRef);
   protected readonly canEdit$ = this.store.canEdit;

   // ---- mapping ----
   /** The object picked first (waiting for its partner on the other slide). */
   protected readonly ui = inject(CompareUiState);
   readonly armed$ = this.ui.armed;
   /** The object under the pointer (its partner and line light up too). */
   readonly lit$ = this.ui.lit;
   protected readonly view$ = this.ui.view$;

   /** Keys being looked at (dragged / picked / hovered) and their partners. */
   protected readonly focusKeys$ = computed<Set<string> | null>(() => {
      const d = this.drag$();
      const keys: string[] = [];
      if (d?.active) {
         keys.push(d.from.key);
         if (d.over) keys.push(d.over);
      } else {
         const k = this.armed$()?.key ?? this.lit$();
         if (k) keys.push(k);
      }
      if (!keys.length) return null;
      const all = [...this.hitsA$(), ...this.hitsB$()];
      const out = new Set(keys);
      if (!d?.active)
         for (const k of keys) {
            const p = all.find((h) => h.key === k)?.partner;
            if (p) out.add(p);
         }
      return out;
   });
   /** × on a line: a pairing you made is removed (back to automatic); an automatic one stops morphing. */
   /** The X on a pair line: no transition for both objects (each just switches). */
   protected removeLine(l: { a: string; b: string; aId: string | null; bId: string | null }): void {
      this.setPairTags(l.aId, l.bId, 'cut');
      this.lit$.set(null);
   }

   /** No transition for the selected object and its partner: both just switch. */
   protected cutArmed(): void {
      const { aId, bId } = this.armedIds();
      this.setPairTags(aId, bId, 'cut');
   }

   /** Click a row in the pairs list: select that pair's object on the slides (again to clear). */
   protected selectRow(p: MorphPair): void {
      if (!this.canEdit$()) return;
      const key = p.bKey ?? p.aKey;
      if (!key) return;
      const side: 'a' | 'b' = p.bKey ? 'b' : 'a';
      const cur = this.armed$();
      this.armed$.set(cur && cur.key === key ? null : { side, key });
   }

   /** The picked and hovered objects' keys (a pairs-list row lights up when it holds one). */
   protected readonly rowFocusKeys$ = computed(
      () => new Set([this.armed$()?.key, this.lit$()].filter((k): k is string => !!k))
   );

   private sides(): { A: Side[]; B: Side[] } {
      const prev = this.previous();
      return { A: prev ? this.itemsOf(prev) : [], B: this.itemsOf(this.slide()) };
   }

   /** Matcher result as index pairs, plus the sides it ran on. */
   readonly matching = computed(() => {
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
   /** Before-slide objects that came from the slide before it. */
   readonly chainA = computed(() => this.neighbourPairs(this.before(), this.previous(), 'to'));
   /** After-slide objects that go on into the next slide. */
   readonly chainB = computed(() => this.neighbourPairs(this.slide(), this.after(), 'from'));
   readonly hitsA$ = computed(() => this.hits('a'));
   readonly hitsB$ = computed(() => this.hits('b'));
   /**
    * How far the slides' content reaches past the pair view's outer edges, as fractions of
    * its width (its margins, so the scroll area covers it at any zoom).
    */
   protected readonly overhang$ = computed(() => {
      const t = this.total$();
      const hx = (pct: number) => ((Math.max(0, pct) / 100) * COL) / t;
      const hy = (pct: number) => ((Math.max(0, pct) / 100) * this.viewH$()) / t;
      const all = [...this.hitsA$(), ...this.hitsB$()];
      const pad = 0.03;
      return {
         left: hx(-Math.min(0, ...this.hitsA$().map((h) => h.left))) + pad,
         right: hx(Math.max(100, ...this.hitsB$().map((h) => h.left + h.width)) - 100) + pad,
         top: hy(-Math.min(0, ...all.map((h) => h.top))) + pad,
         bottom: hy(Math.max(100, ...all.map((h) => h.top + h.height)) - 100) + pad,
      };
   });
   protected readonly reachA$ = computed(() => this.reach(this.hitsA$()));
   protected readonly reachB$ = computed(() => this.reach(this.hitsB$()));

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
      const a = this.armed$();
      const h = this.armedHit$();
      if (!a || !h?.partner) return null;
      const bHit = a.side === 'b' ? h : this.hitsB$().find((x) => x.key === h.partner);
      if (!bHit?.id) return null;
      return { id: bHit.id, by: this.slide().slide?.transition?.morphByItems?.[bHit.id] ?? 'default' };
   });

   protected setArmedAnimateBy(id: string, by: string): void {
      const f = this.slide();
      if (!f.slide || !this.canEdit$()) return;
      const t = effectiveTransition(f.slide);
      const { [id]: _old, ...rest } = t.morphByItems ?? {};
      const items = by === 'default' ? rest : { ...rest, [id]: by as MorphBy };
      void this.store.updateElement(f.id, {
         slide: { ...f.slide, transition: { ...t, morphByItems: Object.keys(items).length ? items : undefined } },
      });
   }

   /** Publish the selection and its actions for the side panel. */
   private readonly publishSelection = effect(() => {
      const h = this.armedHit$();
      const ab = this.armedAnimateBy();
      const partner = this.partnerLabel$();
      untracked(() =>
         this.ui.selection$.set(
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
                    done: () => this.armed$.set(null),
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

   readonly armedHit$ = computed(() => {
      const a = this.armed$();
      if (!a) return null;
      return (a.side === 'a' ? this.hitsA$() : this.hitsB$()).find((h) => h.key === a.key) ?? null;
   });
   protected readonly partnerLabel$ = computed(() => {
      const h = this.armedHit$();
      if (!h?.partner) return '';
      return [...this.hitsA$(), ...this.hitsB$()].find((x) => x.key === h.partner)?.label ?? '';
   });
   // ---- drag to pair ----
   readonly pairView = viewChild<ElementRef<HTMLElement>>('pairView');
   /**
    * A connector being dragged: it starts at `from` (an object, or the fixed end of an
    * existing pair) and follows the pointer; dropping on an object on the other slide
    * pairs the two.
    */
   readonly drag$ = signal<{
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
   suppressClick = false;

   /** A grid part's box in % of its slide (like a hit). */
   partRect(h: Hit, part: GridPart): PctBox {
      const b = h.grid ? gridPartBox(h.grid.rows, h.grid.cols, part) : { x: 0, y: 0, w: 1, h: 1 };
      return {
         left: h.left + b.x * h.width,
         top: h.top + b.y * h.height,
         width: b.w * h.width,
         height: b.h * h.height,
      };
   }

   /** Centre of an object (or one of a grid's parts) in pair-view units. */
   centerOf(side: 'a' | 'b', key: string, part?: GridPart | null): { x: number; y: number } | null {
      const h = (side === 'a' ? this.hitsA$() : this.hitsB$()).find((x) => x.key === key);
      if (!h) return null;
      const r = part && h.grid ? this.partRect(h, part) : null;
      // A line/arrow's link sits at the middle of the drawn line.
      const cx = r ? r.left + r.width / 2 : h.line ? h.line.cx : h.left + h.width / 2;
      const cy = r ? r.top + r.height / 2 : h.line ? h.line.cy : h.top + h.height / 2;
      return {
         x: (cx / 100) * COL + (side === 'b' ? COL + this.gap() : 0),
         y: (cy / 100) * this.viewH$(),
      };
   }

   toUnits(clientX: number, clientY: number): { x: number; y: number } | null {
      const el = this.pairView()?.nativeElement;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { x: ((clientX - r.left) / r.width) * this.total$(), y: ((clientY - r.top) / r.height) * this.viewH$() };
   }

   protected startDrag(event: PointerEvent, side: 'a' | 'b', h: Hit): void {
      if (!this.canEdit$() || !h.id || event.button !== 0) return;
      // On a grid table the zone under the pointer picks the level: the band round it is
      // the whole table, the top / left strips a column / row, inside a cell (Alt: cells only).
      const part = h.grid ? this.zoneAt(side, h, event.clientX, event.clientY, { cellOnly: event.altKey }) : undefined;
      this.beginDrag(event, { side, key: h.key, part }, null, false);
   }

   /** The screen element of a hit's outline. */
   hitEl(side: 'a' | 'b', key: string): HTMLElement | null {
      return (
         this.pairView()?.nativeElement.querySelector<HTMLElement>(
            `.hit[data-side="${side}"][data-key="${CSS.escape(key)}"]`
         ) ?? null
      );
   }

   /** The grid zone under the pointer while not dragging (shows what a drag would pick). */
   readonly hoverZone = signal<{ side: 'a' | 'b'; key: string; part: GridPart | null } | null>(null);
   protected onHitMove(event: PointerEvent, side: 'a' | 'b', h: Hit): void {
      if (!h.grid || this.drag$() || !this.canEdit$() || !h.id) return;
      const part = this.zoneAt(side, h, event.clientX, event.clientY, { cellOnly: event.altKey });
      const cur = this.hoverZone();
      if (cur && cur.side === side && cur.key === h.key && samePart(cur.part, part)) return;
      this.hoverZone.set({ side, key: h.key, part });
   }
   protected onHitLeave(h: Hit): void {
      // Mid-drag the highlight stays put: changing it toggles the focus view, which clips
      // objects off the slide's edge out from under the pointer (they flashed on and off).
      if (this.drag$()) return;
      this.lit$.set(null);
      if (this.hoverZone()?.key === h.key) this.hoverZone.set(null);
   }
   /** Grid-table zones per side ('a' / 'b'). */
   protected readonly zonesBySide$ = computed(() => {
      const out = new Map<string, ReturnType<DeckCompareComponent['zones']>>();
      for (const z of this.zones()) out.set(z.side, [...(out.get(z.side) ?? []), z]);
      return out;
   });

   /** What a drag from a table part would pair, for the tip line. */
   protected readonly dragTip$ = computed(() => {
      const d = this.drag$();
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
      if (!this.canEdit$() || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.beginDrag(event, { side: fixedSide, key: fixedKey, part: fixedPart }, line, true);
   }

   /** Z-order of each object's line end, by `side:key` (relation lines add 20000 on top). */
   protected readonly endZs$ = computed(() => {
      const out = new Map<string, number>();
      for (const h of this.hitsA$()) out.set(`a:${h.key}`, this.hitZ(h));
      for (const h of this.hitsB$()) out.set(`b:${h.key}`, this.hitZ(h));
      return out;
   });

   /** Smaller objects sit above larger ones, so things inside others stay pickable; lines on top. */
   protected hitZ(h: Hit): number {
      if (h.line) return 10002;
      return Math.max(1, 10001 - Math.round(h.width * h.height));
   }

   /** Where a bound line end attaches, in world space (for drawing line hits). */
   readonly targetBox = (bd: ElementBinding): RotatedBox | null => {
      if (bd.targetKind === 'table') {
         const t = this.store.tables().find((x) => x.id === bd.targetId);
         return t ? tableBox(t) : null;
      }
      const e = bd.targetKind === 'element' ? this.store.elements().find((x) => x.id === bd.targetId) : undefined;
      return e ? { ...elementBox(e), angle: e.angle } : null;
   };

   /** Select an object to see what it does and change it. Pairs are only made by dragging. */
   protected clickHit(side: 'a' | 'b', h: Hit): void {
      if (this.suppressClick) return;
      if (!this.canEdit$() || !h.id) return;
      const a = this.armed$();
      this.armed$.set(a && a.side === side && a.key === h.key ? null : { side, key: h.key });
   }

   /** Clicking anywhere but an object, a pair handle or the action bar finishes the selection. */
   protected onOutside(event: Event): void {
      if (this.mode$() !== 'stage' || !this.armed$()) return;
      const t = event.target as HTMLElement | null;
      // The pair controls under the pairs list act on the selection: clicking them keeps it.
      if (t?.closest('.hit, .end, .cut-line, .actions, .pr, .sel-ctl')) return;
      this.armed$.set(null);
   }

   @HostListener('document:keydown.escape', ['$event'])
   protected onEsc(event: Event): void {
      if (this.armed$()) {
         this.armed$.set(null);
         event.stopPropagation();
         event.preventDefault();
      }
   }

   idOfKey(key: string | null): string | null {
      if (!key) return null;
      return [...this.hitsA$(), ...this.hitsB$()].find((x) => x.key === key)?.id ?? null;
   }

   /** The selected object (and its partner, if paired): earlier-slide and later-slide ids. */
   armedIds(): { aId: string | null; bId: string | null } {
      const h = this.armedHit$();
      const side = this.armed$()?.side;
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
   force(aId: string, bId: string): void {
      void this.store.batchHistory(() => this.forceOps(aId, bId));
   }

   /** Drop the hand-set in / out tags of a pairing: back to automatic matching. */
   protected resetPair(p: MorphPair): void {
      void this.store.batchHistory(async () => {
         if (p.aId) await this.store.updateElement(p.aId, { morphOut: null });
         if (p.bId) await this.store.updateElement(p.bId, { morphIn: null });
      });
   }

   // ---- geometry of the pair view: two slides of COL units with a GAP between ----
   readonly viewH$ = computed(() => (COL * this.slide().height) / (this.slide().width || 1));
   /**
    * Space between the two previews: wider by however far objects hang off the facing
    * edges (the first slide's right, the second's left), so they never land on the
    * other slide.
    */
   readonly gap = computed(() => {
      const right = Math.max(0, ...this.hitsA$().map((h) => h.left + h.width - 100));
      const left = Math.max(0, ...this.hitsB$().map((h) => -h.left));
      return right || left ? GAP + ((right + left) / 100) * COL + 2 : GAP;
   });
   /** Width of the pair view in units (two slides and the gap). */
   protected readonly total$ = computed(() => 2 * COL + this.gap());
   protected readonly colPct$ = computed(() => `${(COL / this.total$()) * 100}%`);
   protected readonly gapPct$ = computed(() => `${(this.gap() / this.total$()) * 100}%`);
   protected readonly viewRatio$ = computed(() => `${this.total$()} / ${this.viewH$()}`);
   protected readonly matched$ = computed(() => this.pairs$().filter((p) => p.a).length);
   protected readonly fresh$ = computed(() => this.pairs$().filter((p) => p.why === 'fades in').length);

   // ---- zoom (Map pairs) ----
   readonly zoom$ = signal(1);
   /** Below 100% the objects sitting off the slides' edges come into view. */
   protected readonly minZoom = MIN_ZOOM;
   setZoom(z: number): void {
      this.zoom$.set(Math.min(4, Math.max(MIN_ZOOM, Math.round(z * 100) / 100)));
   }

   /** Pair numbers by object key (both slides), for the pairs list. */
   protected readonly hitNums$ = computed(() => {
      const out = new Map<string | null | undefined, number | null>();
      for (const h of [...this.hitsA$(), ...this.hitsB$()]) out.set(h.key, h.num ?? null);
      return out;
   });

   // ---- preview strip ----
   private readonly stageHost = viewChild<ElementRef<HTMLElement>>('stageHost');
   private readonly bigHost = viewChild<ElementRef<HTMLElement>>('bigHost');
   /** The visible player: the big one on the Preview tab, else the strip. */
   private readonly playerHost = (): HTMLElement | undefined =>
      (this.view$() === 'preview' ? this.bigHost() : this.stageHost())?.nativeElement;
   private readonly player = new ComparePreviewPlayer({
      render: inject(SlideRenderService),
      host: this.playerHost,
      easing: () => this.slide().slide?.transition?.easing ?? 'ease-in-out',
      duration: () => this.duration$(),
      morphs: () => this.isMorph$(),
      neighbours: () => [this.before(), this.after()],
   });
   protected readonly srcs$ = this.player.srcs;
   /** Scrubbed position, 0 = the slide before, 1 = this slide (linear time). */
   protected readonly progress$ = this.player.progress;
   protected readonly playing$ = this.player.playing;
   /** Opening the Preview tab starts the scrubber at the beginning. */
   private readonly previewStart = effect(() => {
      if (this.view$() !== 'preview') return;
      untracked(() => this.player.scrub(0));
   });
   /**
    * The preview plays the real transition on a live stage for every type (fade, slide,
    * zoom, a cut, with or without morph), not just a cross-fade of two pictures.
    */
   protected readonly isMorph$ = computed(() => !!this.previous());
   /** The transition into this slide is None: a cut, nothing morphs, so no pairs. */
   protected readonly isCut$ = computed(() => !transitionMorphs(this.slide().slide?.transition));
   protected readonly ratio$ = computed(() => `${this.slide().width} / ${this.slide().height}`);
   protected readonly duration$ = computed(() => this.slide().slide?.transition?.duration ?? 300);
   protected readonly nowMs = computed(() => Math.round(this.progress$() * this.duration$()));
   /** Put the live morph scene (or the cross-fade pictures) in the visible player. */
   private readonly placeScene = effect(() => {
      this.view$();
      this.bigHost();
      this.stageHost();
      untracked(() => this.player.place(this.playerHost()));
   });

   /** Embedders read the play state and press play through CompareUiState. */
   private readonly mirrorPlaying = effect(() => {
      const playing = this.playing$();
      untracked(() => this.ui.previewPlaying.set(playing));
   });
   private playRequestsSeen = untracked(() => this.ui.previewPlayRequests());
   private readonly playOnRequest = effect(() => {
      const n = this.ui.previewPlayRequests();
      if (n === this.playRequestsSeen || this.mode$() !== 'stage') return;
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
      if (this.mode$() !== 'pairs') return;
      this.armed$();
      this.lit$();
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
         if (this.mode$() !== 'stage') return;
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

   // ---- delegates to deck-compare-hits.ts ----
   private hits(side: 'a' | 'b'): Hit[] {
      return this.deckCompareHits.hits(side);
   }
   private neighbourPairs(
      from: CanvasElementModel | null,
      to: CanvasElementModel | null,
      side: 'from' | 'to'
   ): Map<string, string> {
      return this.deckCompareHits.neighbourPairs(from, to, side);
   }
   protected get partLines$() {
      return this.deckCompareHits.partLines$;
   }
   get lines$() {
      return this.deckCompareHits.lines$;
   }
   protected get pairs$() {
      return this.deckCompareHits.pairs$;
   }
   private itemsOf(frame: CanvasElementModel): Side[] {
      return this.deckCompareHits.itemsOf(frame);
   }

   // ---- delegates to deck-compare-drag.ts ----
   private zoneAt(
      side: 'a' | 'b',
      h: Hit,
      clientX: number,
      clientY: number,
      opts: { level?: GridPart['kind']; cellOnly?: boolean }
   ): GridPart | null {
      return this.deckCompareDrag.zoneAt(side, h, clientX, clientY, opts);
   }
   protected get zones() {
      return this.deckCompareDrag.zones;
   }
   private beginDrag(event: PointerEvent, from: DragEnd, moving: string | null, active: boolean): void {
      return this.deckCompareDrag.beginDrag(event, from, moving, active);
   }
   protected unpairArmed(): void {
      return this.deckCompareDrag.unpairArmed();
   }
   protected resetArmed(): void {
      return this.deckCompareDrag.resetArmed();
   }
   private forceOps(aId: string, bId: string): Promise<void> {
      return this.deckCompareDrag.forceOps(aId, bId);
   }
   protected forcePart(aId: string, aPart: GridPart, bId: string, bPart: GridPart, tablesPaired: boolean): void {
      return this.deckCompareDrag.forcePart(aId, aPart, bId, bPart, tablesPaired);
   }
   protected removePartLine(l: PartLine): void {
      return this.deckCompareDrag.removePartLine(l);
   }
   protected onZoomWheel(e: WheelEvent): void {
      return this.deckCompareDrag.onZoomWheel(e);
   }
   protected startPan(e: PointerEvent): void {
      return this.deckCompareDrag.startPan(e);
   }
}
