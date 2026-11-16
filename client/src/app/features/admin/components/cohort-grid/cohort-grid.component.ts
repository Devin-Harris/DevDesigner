import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { AdminCohort } from '@devdesigner/shared';
import { formatDay } from '../../helpers/admin-format.helpers';

/**
 * Retention heat grid: one row per weekly signup cohort, one column per week since
 * signup. Cell shade (one hue, light to dark) is the share of the cohort active that
 * week; the percentage is printed in every cell, so the table is its own data view.
 */
@Component({
   selector: 'dd-admin-cohort-grid',
   changeDetection: ChangeDetectionStrategy.OnPush,
   templateUrl: './cohort-grid.component.html',
   styleUrl: './cohort-grid.component.scss',
})
export class CohortGridComponent {
   readonly cohorts$ = input.required<readonly AdminCohort[]>({ alias: 'cohorts' });

   protected readonly weeks$ = computed(() =>
      Array.from({ length: Math.max(0, ...this.cohorts$().map((c) => c.active.length)) }, (_, i) => i)
   );
   protected readonly rows$ = computed(() =>
      this.cohorts$().map((cohort) => ({
         week: cohort.week,
         label: formatDay(cohort.week),
         size: cohort.size,
         cells: this.weeks$().map((i) => {
            if (i >= cohort.active.length) return { index: i, text: '', shade: null, title: '' };
            const share = cohort.size > 0 ? (cohort.active[i] / cohort.size) * 100 : 0;
            return {
               index: i,
               text: cohort.size > 0 ? `${Math.round(share)}%` : '–',
               // 8%..72% of the series hue over the surface: a visible floor, never a saturated block.
               shade:
                  cohort.size > 0
                     ? `color-mix(in srgb, var(--dd-chart-1) ${Math.round(8 + share * 0.64)}%, var(--dd-surface))`
                     : null,
               title: `${cohort.active[i]} of ${cohort.size} active in week ${i}`,
            };
         }),
      }))
   );
}
