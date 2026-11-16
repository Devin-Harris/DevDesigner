/** A "nice" upper bound and evenly spaced ticks (0 .. max) for a value axis. */
export function niceScale(maxValue: number, tickCount = 4): { max: number; ticks: number[] } {
   if (!(maxValue > 0)) return { max: 1, ticks: [0, 1] };
   const rough = maxValue / tickCount;
   const magnitude = 10 ** Math.floor(Math.log10(rough));
   const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude;
   const max = Math.ceil(maxValue / step) * step;
   const ticks: number[] = [];
   for (let t = 0; t <= max + step / 2; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
   return { max, ticks };
}

/** SVG path through points (already in pixel space). */
export function linePath(points: ReadonlyArray<readonly [number, number]>): string {
   return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${round(x)},${round(y)}`).join('');
}

/** The closed area under a line down to `baseY`. */
export function areaPath(points: ReadonlyArray<readonly [number, number]>, baseY: number): string {
   if (points.length === 0) return '';
   const first = points[0];
   const last = points[points.length - 1];
   return `${linePath(points)}L${round(last[0])},${round(baseY)}L${round(first[0])},${round(baseY)}Z`;
}

/** Index of the data position nearest to `x` for `count` evenly spaced points across `width`. */
export function nearestIndex(x: number, width: number, count: number): number {
   if (count <= 1) return 0;
   return Math.max(0, Math.min(count - 1, Math.round((x / width) * (count - 1))));
}

/** Which x-axis labels to print so they never crowd: about `maxLabels`, always first and last. */
export function labelIndexes(count: number, maxLabels = 5): number[] {
   if (count <= maxLabels) return Array.from({ length: count }, (_, i) => i);
   const step = (count - 1) / (maxLabels - 1);
   return Array.from({ length: maxLabels }, (_, i) => Math.round(i * step));
}

const round = (n: number): number => Math.round(n * 10) / 10;
