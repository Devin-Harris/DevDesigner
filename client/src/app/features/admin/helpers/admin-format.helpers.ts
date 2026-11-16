import type { AdminValueFormat } from '../models/admin.models';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('en');
const dateFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const dayFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const dateTimeFormat = new Intl.DateTimeFormat('en', {
   month: 'short',
   day: 'numeric',
   hour: '2-digit',
   minute: '2-digit',
   timeZone: 'UTC',
   hour12: false,
});

/** 1,284 / 12.9K / 4.2M: in full under 10,000, compact above. */
export function formatCount(value: number): string {
   return Math.abs(value) < 10_000 ? full.format(Math.round(value * 10) / 10) : compact.format(value);
}

export function formatBytes(bytes: number): string {
   const units = ['B', 'KB', 'MB', 'GB', 'TB'];
   let value = bytes;
   let unit = 0;
   while (Math.abs(value) >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
   }
   return `${unit === 0 ? Math.round(value) : value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function formatMs(ms: number): string {
   if (ms < 1000) return `${Math.round(ms)} ms`;
   if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
   const minutes = ms / 60_000;
   return minutes < 60 ? `${minutes.toFixed(1)} min` : `${(minutes / 60).toFixed(1)} h`;
}

/** A value as shown in tiles, tables and tooltips; null/undefined render as an en dash. */
export function formatValue(value: unknown, format: AdminValueFormat = 'count'): string {
   if (value === null || value === undefined || value === '') return '–';
   switch (format) {
      case 'count':
         return typeof value === 'number' ? formatCount(value) : String(value);
      case 'percent':
         return `${Number(value).toFixed(Number(value) < 10 ? 2 : 1)}%`;
      case 'ms':
         return formatMs(Number(value));
      case 'bytes':
         return formatBytes(Number(value));
      case 'date':
         return dateFormat.format(new Date(dateInput(value)));
      case 'datetime':
         return dateTimeFormat.format(new Date(dateInput(value)));
      case 'text':
         return String(value);
   }
}

/** Short axis/tooltip label for a `YYYY-MM-DD` day. */
export function formatDay(day: string): string {
   return dayFormat.format(new Date(`${day}T00:00:00Z`));
}

/** Percent change from `previous` to `value`; null when not comparable. */
export function deltaPercent(value: number | null, previous: number | null): number | null {
   if (value === null || previous === null) return null;
   if (previous === 0) return value === 0 ? 0 : null;
   return Math.round(((value - previous) / previous) * 1000) / 10;
}

/** Signed delta label: "+12.5%", "−3%", "0%". */
export function formatDelta(delta: number): string {
   if (delta === 0) return '0%';
   return `${delta > 0 ? '+' : '−'}${Math.abs(delta)}%`;
}

/** `ownerKind` / method / bucket keys as readable labels. */
export function humanize(key: string): string {
   const text = key.replace(/[_.:]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
   return text.charAt(0).toUpperCase() + text.slice(1);
}

function dateInput(value: unknown): string | number {
   return typeof value === 'number' ? value : String(value);
}
