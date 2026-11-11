import { BadRequestException } from '@nestjs/common';
import {
  ADMIN_MAX_RANGE_DAYS,
  ADMIN_RANGE_DAYS,
  type AdminRange,
  type AdminSeriesPoint,
} from '@devdesigner/shared';

export const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` (UTC) of an epoch-ms instant. */
export function utcDayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Epoch ms of a UTC day's midnight. */
export function dayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

/** Every day from `from` to `to`, inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let t = dayStartMs(from); t <= dayStartMs(to); t += DAY_MS) days.push(utcDayOf(t));
  return days;
}

/** A dense daily series: every day of the window, 0 where `values` has none. */
export function denseSeries(days: readonly string[], values: ReadonlyMap<string, number>): AdminSeriesPoint[] {
  return days.map((day) => ({ day, value: values.get(day) ?? 0 }));
}

/** SQLite datetime text as TypeORM stores it (UTC), so string comparison matches. */
export function sqlDatetime(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').replace('Z', '');
}

/** App-DB datetime text (or a Date) -> ISO 8601, or null. */
export function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  const normalized = text.includes('T') ? text : text.replace(' ', 'T');
  const parsed = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(normalized) ? normalized : `${normalized}Z`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/**
 * A closed UTC-day window plus the window of equal length just before it. `endMs`
 * is exclusive (midnight after `to`), so `ts >= startMs AND ts < endMs` covers it.
 */
export interface DayWindow {
  from: string;
  to: string;
  days: string[];
  startMs: number;
  endMs: number;
  prevStartMs: number;
  prevEndMs: number;
}

export function windowOf(from: string, to: string): DayWindow {
  const startMs = dayStartMs(from);
  const endMs = dayStartMs(to) + DAY_MS;
  const span = endMs - startMs;
  return { from, to, days: daysBetween(from, to), startMs, endMs, prevStartMs: startMs - span, prevEndMs: startMs };
}

/** The last N days ending today (UTC) for a preset range. */
export function rangeWindow(range: AdminRange, now = Date.now()): DayWindow {
  const to = utcDayOf(now);
  return windowOf(utcDayOf(dayStartMs(to) - (ADMIN_RANGE_DAYS[range] - 1) * DAY_MS), to);
}

/**
 * An explicit `from..to` window (defaults: the last `defaultDays` days). Rejects a
 * reversed or over-long window with 400, and never reaches past tomorrow.
 */
export function explicitWindow(
  from: string | undefined,
  to: string | undefined,
  defaultDays = 30,
  now = Date.now(),
): DayWindow {
  const end = to ?? utcDayOf(now);
  const start = from ?? utcDayOf(dayStartMs(end) - (defaultDays - 1) * DAY_MS);
  if (!Number.isFinite(dayStartMs(start)) || !Number.isFinite(dayStartMs(end))) {
    throw new BadRequestException('from/to must be valid YYYY-MM-DD days.');
  }
  const span = (dayStartMs(end) - dayStartMs(start)) / DAY_MS + 1;
  if (span < 1) throw new BadRequestException('from must not be after to.');
  if (span > ADMIN_MAX_RANGE_DAYS) {
    throw new BadRequestException(`A window may span at most ${ADMIN_MAX_RANGE_DAYS} days.`);
  }
  if (dayStartMs(end) > now + DAY_MS) throw new BadRequestException('to must not be in the future.');
  return windowOf(start, end);
}

/** Nearest-rank percentile of an ascending list (null when empty). */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

/** Monday (UTC) of the week containing `ms`. */
export function weekStartDay(ms: number): string {
  const date = new Date(ms);
  const offset = (date.getUTCDay() + 6) % 7;
  return utcDayOf(dayStartMs(utcDayOf(ms)) - offset * DAY_MS);
}
