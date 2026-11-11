import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { formatDay, formatValue } from '../../helpers/admin-format.helpers';
import { areaPath, labelIndexes, linePath, nearestIndex, niceScale } from '../../helpers/chart.helpers';
import type { AdminValueFormat, ChartSeries } from '../../models/admin.models';
import { AdminFormatPipe } from '../../pipes/admin-format.pipe';

/** Plot coordinates: the SVG stretches to its box, so geometry is drawn in a 0..1000 x 0..100 frame. */
const W = 1000;
const H = 100;

/**
 * Hand-rolled SVG line chart (one value axis, up to three series in fixed color slots).
 * Text lives in HTML around the plot so it stays crisp at any width. Hover or arrow keys
 * move a crosshair that snaps to the nearest day and reads every series; the same data is
 * always available as a table.
 */
@Component({
   selector: 'dd-admin-line-chart',
   changeDetection: ChangeDetectionStrategy.OnPush,
   imports: [AdminFormatPipe],
   templateUrl: './line-chart.component.html',
   styleUrl: './line-chart.component.scss',
})
export class LineChartComponent {
   readonly series$ = input.required<readonly ChartSeries[]>({ alias: 'series' });
   /** Accessible name of the chart (what is plotted). */
   readonly label$ = input.required<string>({ alias: 'label' });
   readonly format$ = input<AdminValueFormat>('count', { alias: 'format' });
   /** Area wash under a single series. */
   readonly area$ = input(true, { alias: 'area' });

   protected readonly hover$ = signal<number | null>(null);

   protected readonly days$ = computed(() => this.series$()[0]?.points.map((p) => p.day) ?? []);
   protected readonly scale$ = computed(() =>
      niceScale(Math.max(0, ...this.series$().flatMap((s) => s.points.map((p) => p.value))))
   );
   protected readonly yTicks$ = computed(() => {
      const { max, ticks } = this.scale$();
      return ticks.map((t) => ({ value: t, top: 100 - (t / max) * 100, label: formatValue(t, this.format$()) }));
   });
   protected readonly xLabels$ = computed(() => {
      const days = this.days$();
      return labelIndexes(days.length).map((i) => ({
         day: days[i],
         left: days.length > 1 ? (i / (days.length - 1)) * 100 : 50,
         label: formatDay(days[i]),
      }));
   });
   protected readonly paths$ = computed(() => {
      const { max } = this.scale$();
      const single = this.series$().length === 1 && this.area$();
      return this.series$().map((s) => {
         const n = s.points.length;
         const pts = s.points.map((p, i) => [n > 1 ? (i / (n - 1)) * W : W / 2, H - (p.value / max) * H] as const);
         return {
            id: s.id,
            color: `var(--dd-chart-${s.slot})`,
            line: linePath(pts),
            area: single ? areaPath(pts, H) : null,
         };
      });
   });
   protected readonly legend$ = computed(() =>
      this.series$().map((s) => ({ id: s.id, label: s.label, color: `var(--dd-chart-${s.slot})` }))
   );
   protected readonly readout$ = computed(() => {
      const index = this.hover$();
      const days = this.days$();
      if (index === null || index >= days.length) return null;
      const { max } = this.scale$();
      const left = days.length > 1 ? (index / (days.length - 1)) * 100 : 50;
      return {
         left,
         alignEnd: left > 60,
         day: formatDay(days[index]),
         rows: this.series$().map((s) => {
            const value = s.points[index]?.value ?? 0;
            return {
               id: s.id,
               color: `var(--dd-chart-${s.slot})`,
               label: s.label,
               value,
               top: 100 - (value / max) * 100,
            };
         }),
      };
   });
   protected readonly table$ = computed(() =>
      this.days$().map((day, i) => ({ day, values: this.series$().map((s) => s.points[i]?.value ?? 0) }))
   );
   protected readonly summary$ = computed(() => {
      const days = this.days$();
      if (days.length === 0) return `${this.label$()}: no data.`;
      const totals = this.series$()
         .map(
            (s) =>
               `${s.label} ${formatValue(
                  s.points.reduce((a, p) => a + p.value, 0),
                  this.format$()
               )} in total`
         )
         .join(', ');
      return `${this.label$()}, ${formatDay(days[0])} to ${formatDay(days[days.length - 1])}: ${totals}. Use arrow keys to read each day.`;
   });
   protected readonly empty$ = computed(() => this.series$().every((s) => s.points.every((p) => p.value === 0)));

   protected onPointerMove(event: PointerEvent): void {
      const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
      this.hover$.set(nearestIndex(event.clientX - box.left, box.width, this.days$().length));
   }

   protected onKey(event: KeyboardEvent): void {
      const count = this.days$().length;
      if (count === 0) return;
      const current = this.hover$() ?? count - 1;
      const moves: Record<string, number> = {
         ArrowLeft: current - 1,
         ArrowRight: current + 1,
         Home: 0,
         End: count - 1,
      };
      const next = moves[event.key];
      if (next === undefined) return;
      event.preventDefault();
      this.hover$.set(Math.max(0, Math.min(count - 1, next)));
   }

   protected focusLast(): void {
      this.hover$.set(this.days$().length > 0 ? this.days$().length - 1 : null);
   }

   protected clear(): void {
      this.hover$.set(null);
   }
}
