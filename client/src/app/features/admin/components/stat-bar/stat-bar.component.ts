import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formatValue } from '../../helpers/admin-format.helpers';
import type { AdminValueFormat, StatSegment } from '../../models/admin.models';

/**
 * One whole split into parts (auth methods, share levels, project activity): a segmented
 * bar in the categorical slots, plus a legend that carries every name, amount and share.
 * Takes at most three parts; extra parts fold into "Other".
 */
@Component({
   selector: 'dd-admin-stat-bar',
   changeDetection: ChangeDetectionStrategy.OnPush,
   templateUrl: './stat-bar.component.html',
   styleUrl: './stat-bar.component.scss',
})
export class StatBarComponent {
   readonly segments$ = input.required<readonly StatSegment[]>({ alias: 'segments' });
   readonly label$ = input.required<string>({ alias: 'label' });
   readonly format$ = input<AdminValueFormat>('count', { alias: 'format' });

   protected readonly parts$ = computed(() => {
      const sorted = this.segments$().filter((s) => s.value > 0);
      const folded =
         sorted.length > 3
            ? [
                 ...sorted.slice(0, 2),
                 { key: 'other', label: 'Other', value: sorted.slice(2).reduce((a, s) => a + s.value, 0) },
              ]
            : sorted;
      const total = folded.reduce((a, s) => a + s.value, 0);
      return folded.map((s, i) => {
         const share = total > 0 ? (s.value / total) * 100 : 0;
         return {
            key: s.key,
            label: s.label,
            share,
            color: `var(--dd-chart-${i + 1})`,
            text: `${formatValue(s.value, this.format$())} · ${share < 1 && share > 0 ? '<1' : Math.round(share)}%`,
         };
      });
   });
   protected readonly ariaLabel$ = computed(
      () =>
         `${this.label$()}: ${
            this.parts$()
               .map((p) => `${p.label} ${p.text}`)
               .join(', ') || 'none'
         }`
   );
}
