import { type CanvasElementModel } from '@devdesigner/shared';
import { FRAME_PRESETS } from '../../../../../shared/constants/frame-presets';
import { revealCard } from './slides-panel.state.helpers';
import { nextSlideSelection } from './slide-range-selection.helper';
import type { SlidesPanelState } from './slides-panel.state';

/** Slide card drag, reorder and row selection for the slides panel. */
export class SlideCardDrag {
   /** Where a Shift-click range starts: the last plainly clicked or Ctrl/Cmd-toggled slide. */
   private anchorId: string | null = null;

   constructor(private readonly host: SlidesPanelState) {}

   selectAll(): void {
      this.host.store.setSelection(
         [],
         [],
         this.host.frames$().map((f) => f.id)
      );
   }

   /** Up/Down arrows move to the previous/next slide. */
   stepSlide(delta: number, event: Event): void {
      const t = event.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) {
         return;
      }
      event.preventDefault();
      const list = this.host.shown$().filter((f) => f.id !== this.host.pendingCloneId);
      if (!list.length) {
         return;
      }
      const cur = list.findIndex((f) => f.id === this.host.activeId());
      const next = list[Math.min(list.length - 1, Math.max(0, cur < 0 ? 0 : cur + delta))];
      if (next && next.id !== this.host.activeId()) {
         this.anchorId = next.id;
         this.host.command.emit({ kind: 'focus', id: next.id });
         const cards = event.currentTarget as HTMLElement | null;
         const index = this.host.shown$().findIndex((f) => f.id === next.id);
         requestAnimationFrame(() => {
            revealCard(cards?.querySelectorAll('li.card, .fs')[index], cards);
         });
      }
   }

   /** Plain click shows that slide; Ctrl/Cmd-click toggles it; Shift-click selects the range from the anchor. */
   onRowClick(f: CanvasElementModel, event: Event): void {
      if (this.host.suppressClick || f.id === this.host.pendingCloneId) {
         return;
      }
      // A click or an Enter / Space press: both carry the modifier keys.
      const { ctrlKey, metaKey, shiftKey } = event as MouseEvent | KeyboardEvent;
      if (ctrlKey || metaKey || shiftKey) {
         const order = this.host
            .shown$()
            .filter((x) => x.id !== this.host.pendingCloneId)
            .map((x) => x.id);
         const selected = this.host.activeSlides$().map((x) => x.id);
         // Fall back to the shown slide when the anchor is gone (deleted, or selection changed elsewhere).
         const anchor =
            this.anchorId && order.includes(this.anchorId) && selected.includes(this.anchorId)
               ? this.anchorId
               : this.host.activeId();
         const next = nextSlideSelection(order, selected, anchor, f.id, shiftKey ? 'range' : 'toggle');
         this.anchorId = next.anchor;
         this.host.store.setSelection([], [], next.ids);
         return;
      }
      this.anchorId = f.id;
      this.host.command.emit({ kind: 'focus', id: f.id });
   }

   /** Resize every slide to a preset: all slides share one size. */
   setSize(presetId: string): void {
      const preset = FRAME_PRESETS.find((p) => p.id === presetId);
      const targets = [...this.host.frames$(), ...this.host.layouts$()];
      if (!preset || !targets.length) {
         return;
      }
      void this.host.store.batchHistory(async () => {
         for (const f of targets) {
            if (Math.round(f.width) !== preset.width || Math.round(f.height) !== preset.height) {
               await this.host.store.updateElement(f.id, { width: preset.width, height: preset.height });
            }
         }
      });
   }

   /** Transform for a card during a drag: the preview follows the pointer, the rest make room. */
   cardTransform(i: number): string | null {
      const from = this.host.draggingIndex$();
      const to = this.host.overIndex();
      if (from === null || to === null) {
         return null;
      }
      if (this.host.cloning$()) {
         // Alt-drag: the original stays; everything from the insertion point makes room.
         return i >= to ? `translateY(${this.host.dragStep()}px)` : null;
      }
      if (i === from) {
         return `translateY(${this.host.dragDy$()}px) scale(1.02)`;
      }
      const step = this.host.dragStep();
      if (from < to && i > from && i <= to) {
         return `translateY(${-step}px)`;
      }
      if (from > to && i >= to && i < from) {
         return `translateY(${step}px)`;
      }
      return null;
   }

   /**
    * Drag a card to reorder the slides (hold Alt to duplicate it there). Built on
    * pointer events like the rest of the canvas, so it works for mouse, pen and touch.
    */
   onCardDown(index: number, event: PointerEvent): void {
      if (event.button !== 0 || !this.host.canEdit$()) {
         return;
      }
      if ((event.target as HTMLElement).closest('button')) {
         return;
      }
      if (this.host.draggingIndex$() !== null || this.host.shown$()[index]?.id === this.host.pendingCloneId) {
         return;
      }
      const startX = event.clientX;
      const startY = event.clientY;
      // The deck panel's list and focus mode's slide rail drag the same way.
      const focus = this.host.part$() === 'focus-list';
      const root = this.host.host.nativeElement as HTMLElement;
      const scroller = root.querySelector<HTMLElement>(focus ? '.f-cards' : '.cards');
      const startScroll = scroller?.scrollTop ?? 0;
      // Slot geometry in scroll-content coordinates, captured before anything moves.
      const cards = Array.from(root.querySelectorAll<HTMLElement>(focus ? '.fs:not(.ghost)' : 'li.card:not(.ghost)'));
      const slots = cards.map((el) => ({ top: el.offsetTop, height: el.offsetHeight }));
      const me = slots[index];
      if (!me) {
         return;
      }
      const gap = slots.length > 1 ? Math.max(0, slots[1].top - slots[0].top - slots[0].height) : 0;
      const centers = slots.map((s) => s.top + s.height / 2);
      const srcFrame = this.host.shown$()[index];
      // Alt-dragging one of several selected slides copies all of them, in deck order.
      const selected = new Set(this.host.activeSlides$().map((f) => f.id));
      const copyIds =
         srcFrame && selected.has(srcFrame.id) && selected.size > 1
            ? this.host
                 .shown$()
                 .filter((f) => selected.has(f.id))
                 .map((f) => f.id)
            : srcFrame
              ? [srcFrame.id]
              : [];
      let started = false;
      let lastY = startY;
      let alt = event.altKey;
      let raf = 0;

      /** Insertion point (0..n) for a copy: how many slot centres lie above the dragged one. */
      const insertionFor = (dy: number): number => {
         const c = centers[index] + dy;
         return centers.filter((v) => v < c).length;
      };
      /** Slot the dragged card's centre currently falls into. */
      const targetFor = (dy: number): number => {
         const c = centers[index] + dy;
         let best = 0;
         let bestDist = Infinity;
         centers.forEach((v, i) => {
            const d = Math.abs(v - c);
            if (d < bestDist) {
               bestDist = d;
               best = i;
            }
         });
         return best;
      };
      const travel = (): number => lastY - startY + ((scroller?.scrollTop ?? 0) - startScroll);
      const setCloning = (on: boolean): void => {
         if (this.host.cloning$() === on) {
            return;
         }
         this.host.cloning$.set(on);
         this.host.cloneGhost$.set(
            on && srcFrame
               ? {
                    id: srcFrame.id,
                    top: me.top,
                    height: me.height,
                    fw: srcFrame.width,
                    fh: srcFrame.height,
                    count: copyIds.length,
                 }
               : null
         );
      };
      const update = (): void => {
         const dy = travel();
         setCloning(alt);
         this.host.dragDy$.set(dy);
         this.host.overIndex.set(alt ? insertionFor(dy) : targetFor(dy));
      };
      const onKey = (e: KeyboardEvent): void => {
         if (e.key === 'Alt' && started && !this.host.settling$()) {
            alt = e.type === 'keydown';
            update();
         }
      };
      const tick = (): void => {
         // Keep scrolling the list while the pointer rests near its top or bottom edge.
         if (scroller) {
            const r = scroller.getBoundingClientRect();
            if (lastY < r.top + 28) {
               scroller.scrollTop -= 10;
            } else if (lastY > r.bottom - 28) {
               scroller.scrollTop += 10;
            }
         }
         update();
         raf = requestAnimationFrame(tick);
      };

      const move = (e: PointerEvent): void => {
         lastY = e.clientY;
         alt = e.altKey;
         if (!started) {
            if (Math.hypot(e.clientX - startX, e.clientY - startY) < 5) {
               return;
            }
            started = true;
            this.host.dragStep.set(me.height + gap);
            this.host.settling$.set(false);
            this.host.draggingIndex$.set(index);
            raf = requestAnimationFrame(tick);
         }
         update();
      };
      const up = (e: PointerEvent): void => {
         window.removeEventListener('pointermove', move);
         window.removeEventListener('pointerup', up);
         window.removeEventListener('pointercancel', up);
         window.removeEventListener('keydown', onKey);
         window.removeEventListener('keyup', onKey);
         cancelAnimationFrame(raf);
         if (!started) {
            return;
         }
         // The click that follows a drag must not also select the slide.
         this.host.suppressClick = true;
         setTimeout(() => (this.host.suppressClick = false), 0);
         const clear = (): void => {
            this.host.settling$.set(false);
            this.host.cloning$.set(false);
            this.host.cloneGhost$.set(null);
            this.host.draggingIndex$.set(null);
            this.host.overIndex.set(null);
            this.host.dragDy$.set(0);
         };
         const dropped = e.type === 'pointerup';
         // Copy mode (Alt held at release): glide the copy into the gap, then create it.
         if (dropped && alt && srcFrame) {
            const n = slots.length;
            const to = insertionFor(travel());
            const landing = to < n ? slots[to].top : slots[n - 1].top + slots[n - 1].height + gap;
            this.host.overIndex.set(to);
            this.host.settling$.set(true);
            this.host.dragDy$.set(landing - me.top);
            setTimeout(() => {
               // Keep a stand-in in the gap until the real copy shows up.
               this.host.pendingClone.set({
                  srcId: srcFrame.id,
                  to,
                  known: new Set(this.host.frames$().map((f) => f.id)),
               });
               setTimeout(() => this.host.pendingClone.set(null), 5000);
               clear();
               this.host.command.emit({ kind: 'duplicate', id: srcFrame.id, ids: copyIds, toIndex: to });
            }, 180);
            return;
         }
         // Glide the preview into its slot (or back, if cancelled), then commit.
         setCloning(false);
         const to = dropped ? targetFor(travel()) : index;
         const landing = to > index ? slots[to].top + slots[to].height - me.height : slots[to].top;
         this.host.overIndex.set(to);
         this.host.settling$.set(true);
         this.host.dragDy$.set(landing - me.top);
         setTimeout(() => {
            clear();
            this.reorder(index, to, false);
         }, 180);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      window.addEventListener('keydown', onKey);
      window.addEventListener('keyup', onKey);
   }

   reorder(from: number, to: number, duplicate: boolean): void {
      if (duplicate) {
         // Alt-drag duplicates the slide (with its contents) into the drop position.
         const src = this.host.shown$()[from];
         if (src) {
            this.host.command.emit({ kind: 'duplicate', id: src.id, toIndex: to });
         }
         return;
      }
      if (from === to) {
         return;
      }
      const list = [...this.host.shown$()];
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      // Show the new order straight away; the writes below land one at a time.
      this.host.pendingOrder.set(list.map((f) => f.id));
      void this.host.store
         .batchHistory(async () => {
            for (let i = 0; i < list.length; i += 1) {
               const f = list[i];
               if (f.slide && f.slide.order !== i) {
                  await this.host.store.updateElement(f.id, { slide: { ...f.slide, order: i } });
               }
            }
         })
         .finally(() => this.host.pendingOrder.set(null));
   }
}
