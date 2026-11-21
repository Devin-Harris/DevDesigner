import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { UserPreferences } from '@devdesigner/shared';
import { ApiClientService } from '../http/api-client.service';
import { AuthService } from './auth.service';

type PrefKey = keyof UserPreferences;

/** localStorage keys the toggles used before they were saved to the account (still the offline fallback). */
const STORAGE_KEYS: Record<PrefKey, string> = {
   gridSnap: 'dd-grid-snap',
   smartGuides: 'dd-smart-guides',
   minimap: 'devdesigner.minimap',
   minimapCollapsed: 'dd-minimap-collapsed',
};

const DEFAULTS: Required<UserPreferences> = {
   gridSnap: false,
   smartGuides: false,
   minimap: true,
   minimapCollapsed: false,
};

function readStored(key: PrefKey): boolean {
   try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEYS[key]);
      return raw == null ? DEFAULTS[key] : raw === '1';
   } catch {
      return DEFAULTS[key];
   }
}

function writeStored(key: PrefKey, on: boolean): void {
   try {
      globalThis.localStorage?.setItem(STORAGE_KEYS[key], on ? '1' : '0');
   } catch {
      // storage unavailable
   }
}

/**
 * Editor view toggles (grid snap, smart guides, minimap) saved to the signed-in
 * account so clearing browser storage does not lose them. localStorage stays as
 * the instant/offline copy; the account's values win once /auth/me loads.
 */
@Injectable({ providedIn: 'root' })
export class UserPrefsService {
   private readonly api = inject(ApiClientService);
   private readonly auth = inject(AuthService);

   private readonly prefs = signal<Required<UserPreferences>>({
      gridSnap: readStored('gridSnap'),
      smartGuides: readStored('smartGuides'),
      minimap: readStored('minimap'),
      minimapCollapsed: readStored('minimapCollapsed'),
   });
   readonly prefs$ = this.prefs.asReadonly();

   private pending: UserPreferences = {};
   private flushTimer: ReturnType<typeof setTimeout> | undefined;

   constructor() {
      // Adopt the account's saved values when a user signs in / hydrates.
      effect(() => {
         const saved = this.auth.currentUser$()?.preferences;
         if (!saved) return;
         untracked(() => {
            const next = { ...this.prefs() };
            for (const key of Object.keys(STORAGE_KEYS) as PrefKey[]) {
               const v = saved[key];
               if (typeof v === 'boolean') {
                  next[key] = v;
                  writeStored(key, v);
               }
            }
            this.prefs.set(next);
         });
      });
   }

   get(key: PrefKey): boolean {
      return this.prefs()[key];
   }

   set(key: PrefKey, on: boolean): void {
      if (this.prefs()[key] === on) return;
      this.prefs.update((p) => ({ ...p, [key]: on }));
      writeStored(key, on);
      if (!this.auth.isAuthenticated()) return;
      this.pending[key] = on;
      clearTimeout(this.flushTimer);
      this.flushTimer = setTimeout(() => void this.flush(), 500);
   }

   private async flush(): Promise<void> {
      const patch = this.pending;
      this.pending = {};
      try {
         await firstValueFrom(this.api.patch<UserPreferences>('/auth/me/preferences', patch));
      } catch {
         // Offline / token session: the local copy still holds it.
      }
   }
}
