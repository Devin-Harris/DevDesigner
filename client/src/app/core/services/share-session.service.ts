import { Injectable, signal } from '@angular/core';

/** A stable id for this browser tab, minted once per load. */
function mintClientId(): string {
  try {
    return globalThis.crypto?.randomUUID() ?? `c_${Math.random().toString(36).slice(2)}`;
  } catch {
    return `c_${Math.random().toString(36).slice(2)}`;
  }
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

  setToken(token: string | null): void {
    this._token.set(token);
  }
}
