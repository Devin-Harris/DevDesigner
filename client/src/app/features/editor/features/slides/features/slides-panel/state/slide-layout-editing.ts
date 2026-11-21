import { effect, untracked } from '@angular/core';
import {
   type CanvasElementModel,
   type LayoutKind,
   type PlaceholderConfig,
   type PlaceholderRole,
} from '@devdesigner/shared';
import {
   resetSlideToLayout,
   resetToMaster,
   switchLayout,
   syncLayoutCopies,
} from '../../../../../helpers/layout-placeholders';
import { addStandardLayouts } from '../../../helpers/standard-layouts';
import type { SlidesPanelState } from './slides-panel.state';

/** Layout tab gestures and placeholder edits for the slides panel. */
export class SlideLayoutEditing {
   constructor(private readonly host: SlidesPanelState) {}

   /** Keep the shown layout's card in view (e.g. one just added). */
   readonly followLayout = effect(() => {
      if (this.host.part$() !== 'design-layouts') return;
      this.host.active_$();
      this.host.designLayouts$();
      setTimeout(
         () =>
            (this.host.host.nativeElement as HTMLElement)
               .querySelector('.f-cards .ly.on')
               ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
         60
      );
   });

   onLayoutDown(index: number, event: PointerEvent): void {
      if (event.button !== 0 || !this.host.canEdit$()) return;
      if ((event.target as HTMLElement).closest('.ly-del')) return;
      const scroller = (event.currentTarget as HTMLElement).parentElement as HTMLElement;
      const sx = event.clientX;
      const sy = event.clientY;
      let started = false;
      let lastY = sy;
      let alt = event.altKey;
      let raf = 0;
      /** The gap (0..n) the pointer is over: how many card centres lie above it. */
      const gapAt = (y: number): number => {
         let i = 0;
         for (const c of Array.from(scroller.querySelectorAll<HTMLElement>(':scope > .lyw'))) {
            const r = c.getBoundingClientRect();
            if (y > r.top + r.height / 2) i++;
         }
         return i;
      };
      const update = (): void => this.host.lyDrag$.set({ from: index, to: gapAt(lastY), alt });
      const tick = (): void => {
         const r = scroller.getBoundingClientRect();
         if (lastY < r.top + 28) scroller.scrollTop -= 8;
         else if (lastY > r.bottom - 28) scroller.scrollTop += 8;
         update();
         raf = requestAnimationFrame(tick);
      };
      const move = (e: PointerEvent): void => {
         lastY = e.clientY;
         alt = e.altKey;
         if (!started) {
            if (Math.hypot(e.clientX - sx, e.clientY - sy) < 5) return;
            started = true;
            raf = requestAnimationFrame(tick);
         }
         update();
      };
      const onKey = (e: KeyboardEvent): void => {
         if (e.key === 'Alt' && started) {
            alt = e.type === 'keydown';
            e.preventDefault();
            update();
         }
      };
      const up = (e: PointerEvent): void => {
         window.removeEventListener('pointermove', move);
         window.removeEventListener('pointerup', up);
         window.removeEventListener('pointercancel', up);
         window.removeEventListener('keydown', onKey);
         window.removeEventListener('keyup', onKey);
         cancelAnimationFrame(raf);
         const d = this.host.lyDrag$();
         this.host.lyDrag$.set(null);
         if (!started || !d || e.type !== 'pointerup') return;
         this.host.lySuppress = true;
         setTimeout(() => (this.host.lySuppress = false), 0);
         const cards = this.host.designLayouts$();
         const src = cards[index];
         if (!src) return;
         if (d.alt) {
            // Position in the deck's full layout list (other designs' layouts included).
            const all = this.host.layouts$();
            const toIndex = d.to < cards.length ? all.indexOf(cards[d.to]) : all.indexOf(cards[cards.length - 1]) + 1;
            this.host.command.emit({ kind: 'duplicate', id: src.id, toIndex });
            return;
         }
         const to = d.to > index ? d.to - 1 : d.to;
         if (to === index) return;
         const next = [...cards];
         next.splice(index, 1);
         next.splice(to, 0, src);
         // Reuse the cards' own order slots, so other designs' layouts keep their places.
         const slots = cards.map((c) => c.slide?.order ?? 0).sort((a, b) => a - b);
         void this.host.store.batchHistory(async () => {
            for (let i = 0; i < next.length; i++) {
               const f = next[i];
               if (f.slide && f.slide.order !== slots[i]) {
                  await this.host.store.updateElement(f.id, { slide: { ...f.slide, order: slots[i] } });
               }
            }
         });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      window.addEventListener('keydown', onKey);
      window.addEventListener('keyup', onKey);
   }

   /** Add standard layouts to this presentation and show the first one. */
   async addStandard(kinds: readonly LayoutKind[]): Promise<void> {
      const anchor = this.host.active$();
      if (!anchor || !this.host.canEdit$()) return;
      const ids = await addStandardLayouts(this.host.store, anchor, kinds);
      if (ids[0]) this.host.command.emit({ kind: 'focus', id: ids[0] });
   }

   readonly layoutTab = effect(() => {
      if (this.host.shownLayoutId()) {
         untracked(() => {
            this.host.tab$.set('design');
            this.host.designTab$.set('layouts');
         });
      }
   });

   /** Leave the layout: show the first slide using it, else the first slide. */
   backToSlide(): void {
      const l = this.host.shownLayout$();
      const slide =
         this.host.frames$().find((f) => f.id === this.host.lastSlide$()) ??
         this.host.frames$().find((f) => f.slide?.layoutId === l?.id) ??
         this.host.frames$()[0];
      if (slide) this.host.command.emit({ kind: 'focus', id: slide.id });
   }

   renameLayout(l: CanvasElementModel, input: HTMLInputElement): void {
      const name = input.value.trim().slice(0, 120);
      if (!l.slide || !name || name === this.host.layoutName(l)) {
         input.value = this.host.layoutName(l);
         return;
      }
      void this.host.store.updateElement(l.id, { slide: { ...l.slide, layoutName: name } });
   }

   setLayout(id: string): void {
      const targets = this.host.activeSlides$().length
         ? this.host.activeSlides$()
         : this.host.active$()
           ? [this.host.active$()!]
           : [];
      const layout = this.host.layouts$().find((l) => l.id === id) ?? null;
      void this.host.store.batchHistory(async () => {
         for (const f of targets) {
            if (f.slide && (f.slide.layoutId ?? '') !== id) {
               await switchLayout(this.host.store, f, layout);
            }
         }
      });
   }

   resetSlide(selectedOnly: boolean): void {
      const slide = this.host.driftSlide();
      if (!slide) return;
      const only = selectedOnly ? new Set(this.host.selectedDrifted$().map((c) => c.id)) : undefined;
      void this.host.store.batchHistory(() => resetSlideToLayout(this.host.store, slide, only));
   }

   resetMaster(selectedOnly: boolean): void {
      const items = selectedOnly ? this.host.slideLayoutViews.selectedStandIns$() : this.host.slideLayoutViews.standIns$();
      void this.host.store.batchHistory(() => resetToMaster(this.host.store, items));
   }

   /** Change the selected layout text boxes' placeholders, then bring slides in line. */
   editPlaceholders(fn: (e: CanvasElementModel) => PlaceholderConfig | null): void {
      const items = this.host.layoutTextSelection$();
      const layout = this.host.shownLayout$();
      if (!layout) return;
      void this.host.store.batchHistory(async () => {
         for (const e of items) await this.host.store.updateElement(e.id, { placeholder: fn(e) });
         await syncLayoutCopies(this.host.store, layout);
      });
   }

   setPlaceholder(on: boolean): void {
      this.editPlaceholders((e) => (on ? (e.placeholder ?? {}) : null));
   }

   setRole(role: string): void {
      this.editPlaceholders((e) => {
         const { role: _old, ...rest } = e.placeholder ?? {};
         return role ? { ...rest, role: role as PlaceholderRole } : rest;
      });
   }
}
