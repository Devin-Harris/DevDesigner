import { computed } from '@angular/core';
import { type CanvasElementModel, LAYOUT_KINDS } from '@devdesigner/shared';
import type { SelectOption } from '../../../../../../../shared/ui/components/select/select.component';
import { isLayoutStandIn, masterStandIns, standInChanged } from '../../../../../helpers/layout-placeholders';
import type { SlidesPanelState } from './slides-panel.state';

/** Layout menus, options and stand-ins for the slides panel. */
export class SlideLayoutViews {
   constructor(private readonly host: SlidesPanelState) {}

   /** The New menu's layouts: standard kinds first in their usual order, then the rest. */
   readonly menuLayouts$ = computed(() => {
      const rank = (l: CanvasElementModel): number => {
         const k = l.slide?.layoutKind;
         return k ? LAYOUT_KINDS.indexOf(k) : LAYOUT_KINDS.length;
      };
      return this.host
         .layouts$()
         .filter((l) => !this.host.foreign(l))
         .sort((a, b) => rank(a) - rank(b));
   });

   /** Standard layout kinds this design doesn't have yet. */
   readonly missingKinds$ = computed(() => {
      const have = new Set(
         this.host
            .designLayouts$()
            .map((l) => l.slide?.layoutKind)
            .filter(Boolean)
      );
      return this.host.standardKinds.filter((k) => !have.has(k));
   });

   readonly layoutOptions$ = computed<SelectOption<string>[]>(() =>
      this.host.layouts$().map((l) => ({
         value: l.id,
         label: this.host.foreign(l) ? `⚠ ${this.host.layoutName(l)} (not in this design)` : this.host.layoutName(l),
      }))
   );

   /** Master items the shown slide or layout replaced with its own (double-click to make). */
   readonly standIns$ = computed(() => {
      this.host.store.elements();
      // The shown layout when editing one (a layout can change the master too), else the slide.
      const a = this.host.shownLayout$() ?? (this.host.activeSlides$().length <= 1 ? this.host.active$() : null);
      // A copy made by just clicking the item, still as the master has it, is not a change.
      return a && !a.slide?.master
         ? masterStandIns(this.host.store, a.id).filter(
              (e) => !isLayoutStandIn(this.host.store, e) && standInChanged(this.host.store, e)
           )
         : [];
   });

   readonly selectedStandIns$ = computed(() => {
      const ids = new Set(this.host.store.selectedElementIds());
      return this.standIns$().filter((e) => ids.has(e.id));
   });

   /** How many slides of this deck use each layout. */
   readonly layoutUsage$ = computed(() => {
      const out = new Map<string, number>();
      for (const f of this.host.frames$()) {
         const id = f.slide?.layoutId;
         if (id) out.set(id, (out.get(id) ?? 0) + 1);
      }
      return out;
   });
}
