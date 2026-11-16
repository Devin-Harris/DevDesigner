import { deltaPercent, formatBytes, formatCount, formatDelta, formatValue, humanize } from './admin-format.helpers';
import { rangeDays, requestKey } from './admin-request.helpers';
import { areaPath, labelIndexes, linePath, nearestIndex, niceScale } from './chart.helpers';
import { initialAdminState } from '../state/admin/features/admin-state.feature';
import type { AdminRequestParams } from '../models/admin.models';

describe('admin format helpers', () => {
   it.each([
      [0, '0'],
      [1284, '1,284'],
      [12_900, '12.9K'],
      [4_200_000, '4.2M'],
   ])('formatCount(%p) = %p', (value, expected) => {
      expect(formatCount(value)).toBe(expected);
   });

   it.each([
      [512, '512 B'],
      [2048, '2.0 KB'],
      [5 * 1024 * 1024, '5.0 MB'],
      [300 * 1024 * 1024, '300 MB'],
   ])('formatBytes(%p) = %p', (value, expected) => {
      expect(formatBytes(value)).toBe(expected);
   });

   it('formats by kind and shows a dash for missing values', () => {
      expect(formatValue(null)).toBe('–');
      expect(formatValue(1.234, 'percent')).toBe('1.23%');
      expect(formatValue(1500, 'ms')).toBe('1.5 s');
      expect(formatValue('2026-11-07T10:00:00.000Z', 'date')).toBe('Nov 7, 2026');
      expect(formatValue(404, 'text')).toBe('404');
   });

   it('computes signed deltas only when comparable', () => {
      expect(deltaPercent(12, 10)).toBe(20);
      expect(deltaPercent(5, 0)).toBeNull();
      expect(deltaPercent(0, 0)).toBe(0);
      expect(deltaPercent(null, 3)).toBeNull();
      expect(formatDelta(-3)).toBe('−3%');
      expect(formatDelta(12.5)).toBe('+12.5%');
   });

   it('humanizes keys', () => {
      expect(humanize('active_7d')).toBe('Active 7d');
      expect(humanize('element.created')).toBe('Element created');
   });
});

describe('admin request helpers', () => {
   const params: AdminRequestParams = { ...initialAdminState };

   it('keys each resource only by the params it depends on', () => {
      expect(requestKey('overview', params)).toBe('overview?range=30d');
      expect(requestKey('storage', { ...params, range: '7d' })).toBe('storage');
      expect(requestKey('users', params)).toBe('users?q=&sort=createdAt&dir=desc&page=1');
      expect(requestKey('events', { ...params, events: { name: 'api.request', cursors: [40, 12] } })).toBe(
         'events?name=api.request&cursor=12'
      );
   });

   it('turns a preset range into inclusive UTC days', () => {
      expect(rangeDays('7d', Date.UTC(2026, 10, 10, 15))).toEqual({ from: '2026-11-04', to: '2026-11-10' });
   });
});

describe('chart helpers', () => {
   it.each([
      [0, 1, [0, 1]],
      [7, 8, [0, 2, 4, 6, 8]],
      [130, 150, [0, 50, 100, 150]],
      [0.9, 1, [0, 0.25, 0.5, 0.75, 1]],
   ])('niceScale(%p) tops out at %p', (value, max, ticks) => {
      expect(niceScale(value)).toEqual({ max, ticks });
   });

   it('builds line and area paths', () => {
      const points = [
         [0, 10],
         [50, 0],
      ] as const;
      expect(linePath(points)).toBe('M0,10L50,0');
      expect(areaPath(points, 100)).toBe('M0,10L50,0L50,100L0,100Z');
      expect(areaPath([], 100)).toBe('');
   });

   it('snaps to the nearest data position and spreads axis labels', () => {
      expect(nearestIndex(49, 100, 3)).toBe(1);
      expect(nearestIndex(-5, 100, 3)).toBe(0);
      expect(nearestIndex(500, 100, 3)).toBe(2);
      expect(labelIndexes(4)).toEqual([0, 1, 2, 3]);
      expect(labelIndexes(30, 4)).toEqual([0, 10, 19, 29]);
   });
});
