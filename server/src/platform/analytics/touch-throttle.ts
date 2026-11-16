/**
 * "At most once per interval per key" gate (generalizes the old ApiTokenService
 * touch). Bounded: when it holds `maxKeys`, entries older than the interval are
 * dropped, and if that is not enough the whole map is cleared (worst case: one
 * extra write per key).
 */
export class TouchThrottle {
  private readonly last = new Map<string, number>();

  constructor(
    private readonly intervalMs: number,
    private readonly maxKeys = 50_000,
  ) {}

  /** True (and remembered) when `key` was not let through within the interval. */
  take(key: string, now = Date.now()): boolean {
    const prev = this.last.get(key);
    if (prev !== undefined && now - prev < this.intervalMs) return false;
    if (this.last.size >= this.maxKeys) this.prune(now);
    this.last.set(key, now);
    return true;
  }

  private prune(now: number): void {
    for (const [key, at] of this.last) {
      if (now - at >= this.intervalMs) this.last.delete(key);
    }
    if (this.last.size >= this.maxKeys) this.last.clear();
  }
}
