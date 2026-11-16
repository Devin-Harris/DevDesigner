import type { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { series } from '../testing/admin-fixtures';
import { DataTableComponent } from './data-table/data-table.component';
import { KpiTileComponent } from './kpi-tile/kpi-tile.component';
import { LineChartComponent } from './line-chart/line-chart.component';
import { StatBarComponent } from './stat-bar/stat-bar.component';

function render<T>(component: Type<T>, inputs: Record<string, unknown>) {
   const fixture = TestBed.createComponent(component);
   for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
   fixture.detectChanges();
   return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('KpiTileComponent', () => {
   it('colors a rise as good, or as bad when up is bad', () => {
      const good = render(KpiTileComponent, { label: 'Users', value: 12, previous: 10 });
      expect(good.el.querySelector('.kpi-delta')?.classList).toContain('is-good');
      expect(good.el.textContent).toContain('+20%');
      const bad = render(KpiTileComponent, { label: 'p95', value: 12, previous: 10, upIsBad: true, format: 'ms' });
      expect(bad.el.querySelector('.kpi-delta')?.classList).toContain('is-bad');
      expect(bad.el.querySelector('.kpi-value')?.textContent).toBe('12 ms');
   });

   it('shows the hint when there is nothing to compare', () => {
      const { el } = render(KpiTileComponent, { label: 'DB', value: null, hint: 'Analytics is off' });
      expect(el.querySelector('.kpi-value')?.textContent).toBe('–');
      expect(el.textContent).toContain('Analytics is off');
   });
});

describe('LineChartComponent', () => {
   const two = [
      { id: 'a', label: 'Users', slot: 1, points: series([1, 4, 2]) },
      { id: 'b', label: 'Guests', slot: 2, points: series([0, 1, 3]) },
   ];

   it('describes the data for screen readers and always offers a table', () => {
      const { el } = render(LineChartComponent, { label: 'Active people', series: two });
      expect(el.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain(
         'Users 7 in total, Guests 4 in total'
      );
      const rows = [...el.querySelectorAll('tbody tr')].map((tr) =>
         [...tr.children].map((cell) => cell.textContent?.trim()).join(' ')
      );
      expect(rows).toEqual(['2026-11-01 1 0', '2026-11-02 4 1', '2026-11-03 2 3']);
      expect(el.querySelectorAll('.chart-legend-item')).toHaveLength(2);
   });

   it('reads every series at the focused day with the arrow keys', () => {
      const { fixture, el } = render(LineChartComponent, { label: 'Active people', series: two });
      const plot = el.querySelector<HTMLElement>('.chart-plot')!;
      plot.dispatchEvent(new FocusEvent('focus'));
      plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
      fixture.detectChanges();
      expect(el.querySelector('.chart-tooltip-day')?.textContent).toBe('Nov 2');
      const rows = [...el.querySelectorAll('.chart-tooltip-row')].map((row) =>
         [...row.children].map((cell) => cell.textContent?.trim()).join(' ')
      );
      expect(rows).toEqual([' 4 Users', ' 1 Guests']);
   });

   it('has no legend for a single series and says when there is no activity', () => {
      const { el } = render(LineChartComponent, {
         label: 'Errors',
         series: [{ id: 'e', label: 'Errors', slot: 1, points: series([0, 0]) }],
      });
      expect(el.querySelector('.chart-legend')).toBeNull();
      expect(el.textContent).toContain('No activity in this period');
   });
});

describe('StatBarComponent', () => {
   it('folds parts beyond three into Other and labels shares', () => {
      const { el } = render(StatBarComponent, {
         label: 'Methods',
         segments: [
            { key: 'a', label: 'A', value: 50 },
            { key: 'b', label: 'B', value: 30 },
            { key: 'c', label: 'C', value: 15 },
            { key: 'd', label: 'D', value: 5 },
            { key: 'z', label: 'Z', value: 0 },
         ],
      });
      expect(el.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
         'Methods: A 50 · 50%, B 30 · 30%, Other 20 · 20%'
      );
   });
});

describe('DataTableComponent', () => {
   it('emits sort and page changes and activates clickable rows', () => {
      const { fixture, el } = render(DataTableComponent, {
         label: 'Users',
         columns: [
            { key: 'email', label: 'Email', sortable: true },
            { key: 'bytes', label: 'Media', format: 'bytes', align: 'end' },
         ],
         rows: [{ id: 'u1', email: 'ada@example.com', bytes: 2048 }],
         clickable: true,
         sort: 'email',
         dir: 'asc',
         page: 1,
         pageSize: 1,
         total: 3,
      });
      const sorts: string[] = [];
      const pages: number[] = [];
      const clicks: string[] = [];
      fixture.componentInstance.sortChange.subscribe((s) => sorts.push(s));
      fixture.componentInstance.pageChange.subscribe((p) => pages.push(p));
      fixture.componentInstance.rowClick.subscribe((id) => clicks.push(id));

      expect(el.querySelector('th[aria-sort]')?.getAttribute('aria-sort')).toBe('ascending');
      expect(el.querySelector('tbody td:last-child')?.textContent?.trim()).toBe('2.0 KB');
      expect(el.querySelector('.pager-range')?.textContent).toBe('1–1 of 3');
      el.querySelector<HTMLButtonElement>('.sort-button')!.click();
      el.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.click();
      el.querySelector<HTMLElement>('tbody tr')!.click();
      expect(sorts).toEqual(['email']);
      expect(pages).toEqual([2]);
      expect(clicks).toEqual(['u1']);
   });
});
