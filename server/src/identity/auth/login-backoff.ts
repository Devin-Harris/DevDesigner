/**
 * Per-email login backoff (security H-3 / L-4). After FREE_FAILURES wrong
 * passwords in a row for one email, that email is locked for a delay that doubles
 * with each further failure (capped). It is tracked for unknown emails too, so the
 * lock itself does not reveal whether an account exists. A success clears it.
 * In memory: production runs one replica, and a restart only resets the delays.
 */
const FREE_FAILURES = 5;
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 15 * 60_000;
/** Failures older than this are forgotten. */
const FORGET_AFTER_MS = 60 * 60_000;
const MAX_TRACKED = 10_000;

interface Entry {
  failures: number;
  lockedUntil: number;
  lastFailure: number;
}

export class LoginBackoff {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Milliseconds until `email` may try again (0 = allowed now). */
  retryAfterMs(email: string): number {
    const entry = this.entries.get(email);
    if (!entry) return 0;
    const now = this.now();
    if (now - entry.lastFailure > FORGET_AFTER_MS) {
      this.entries.delete(email);
      return 0;
    }
    return Math.max(0, entry.lockedUntil - now);
  }

  recordFailure(email: string): void {
    const now = this.now();
    const previous = this.entries.get(email);
    const failures = previous && now - previous.lastFailure <= FORGET_AFTER_MS ? previous.failures + 1 : 1;
    const over = failures - FREE_FAILURES;
    const lockedUntil = over > 0 ? now + Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (over - 1)) : 0;
    this.entries.delete(email);
    this.entries.set(email, { failures, lockedUntil, lastFailure: now });
    this.evict(now);
  }

  recordSuccess(email: string): void {
    this.entries.delete(email);
  }

  /** Keep memory bounded: drop stale entries, then the oldest ones. */
  private evict(now: number): void {
    if (this.entries.size <= MAX_TRACKED) return;
    for (const [email, entry] of this.entries) {
      if (now - entry.lastFailure > FORGET_AFTER_MS) this.entries.delete(email);
    }
    // Map iteration is insertion order and failures re-insert, so the first keys are the oldest.
    for (const email of this.entries.keys()) {
      if (this.entries.size <= MAX_TRACKED) break;
      this.entries.delete(email);
    }
  }
}
