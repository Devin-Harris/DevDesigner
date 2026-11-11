import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { deltaPercent, formatDelta, formatValue } from '../../helpers/admin-format.helpers';
import { linePath } from '../../helpers/chart.helpers';
import type { AdminValueFormat } from '../../models/admin.models';

const SPARK_W = 96;
const SPARK_H = 28;

/** A stat tile: label, value, signed delta vs the previous window and an optional sparkline. */
@Component({
   selector: 'dd-admin-kpi-tile',
   changeDetection: ChangeDetectionStrategy.OnPush,
   templateUrl: './kpi-tile.component.html',
   styleUrl: './kpi-tile.component.scss',
})
export class KpiTileComponent {
   readonly label$ = input.required<string>({ alias: 'label' });
   readonly value$ = input<number | null>(null, { alias: 'value' });
   readonly previous$ = input<number | null>(null, { alias: 'previous' });
   readonly format$ = input<AdminValueFormat>('count', { alias: 'format' });
   /** A rise is bad (latency, error rate): flips the delta's tone. */
   readonly upIsBad$ = input(false, { alias: 'upIsBad' });
   readonly trend$ = input<readonly number[]>([], { alias: 'trend' });
   readonly hint$ = input<string>('', { alias: 'hint' });

   protected readonly sparkWidth = SPARK_W;
   protected readonly sparkHeight = SPARK_H;
   protected readonly display$ = computed(() => formatValue(this.value$(), this.format$()));
   protected readonly delta$ = computed(() => deltaPercent(this.value$(), this.previous$()));
   protected readonly deltaLabel$ = computed(() => {
      const delta = this.delta$();
      return delta === null ? '' : formatDelta(delta);
   });
   protected readonly deltaTone$ = computed(() => {
      const delta = this.delta$();
      if (!delta) return 'flat';
      return delta > 0 !== this.upIsBad$() ? 'good' : 'bad';
   });
   protected readonly spark$ = computed(() => {
      const values = this.trend$();
      if (values.length < 2) return null;
      const max = Math.max(...values, 1);
      const points = values.map(
         (v, i) => [(i / (values.length - 1)) * SPARK_W, SPARK_H - 2 - (v / max) * (SPARK_H - 4)] as const
      );
      const last = points[points.length - 1];
      return { path: linePath(points), endX: last[0], endY: last[1] };
   });
}
