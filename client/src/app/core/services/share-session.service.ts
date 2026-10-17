import { Injectable, signal } from '@angular/core';

/** A stable id for this browser tab, minted once per load. */
function mintClientId(): string {
  try {
    return globalThis.crypto?.randomUUID() ?? `c_${Math.random().toString(36).slice(2)}`;
  } catch {
    return `c_${Math.random().toString(36).slice(2)}`;
  }
}

const GUEST_ID_KEY = 'dbd.guestId';

/** A random id for this browser, persisted so its guest projects stay its own. */
function loadGuestId(): string {
  const fresh = mintClientId().replace(/[^A-Za-z0-9_-]/g, '');
  try {
    const stored = localStorage.getItem(GUEST_ID_KEY);
    if (stored && /^[A-Za-z0-9_-]{16,64}$/.test(stored)) {
      return stored;
    }
    localStorage.setItem(GUEST_ID_KEY, fresh);
  } catch {
    // Storage blocked: fall back to a per-load id.
  }
  return fresh;
}

/**
 * Holds the current anonymous share token (set only when the app is opened via a
 * /shared/:token link) and a per-tab client id. The share-token interceptor reads
 * the token to authorize API calls in shared mode; the client id rides on every
 * write so the realtime broadcast of that write can skip this originating tab
 * (it already applied the change optimistically).
 */
@Injectable({ providedIn: 'root' })
export class ShareSessionService {
  private readonly _token = signal<string | null>(null);
  readonly token = this._token.asReadonly();

  /** Stable id for this tab, used as X-Client-Id and for self-filtering broadcasts. */
  readonly clientId = mintClientId();

  /** Per-browser guest id (X-Guest-Id); owns projects made without an account. */
  readonly guestId = loadGuestId();

  setToken(token: string | null): void {
    this._token.set(token);
  }
}
