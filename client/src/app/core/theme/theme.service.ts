import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { notifySignal } from '../../shared/helpers/signals';

const STORAGE_KEY = 'dd-theme';

export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * Light/dark theme state. The chosen mode (light, dark, or following the system)
 * flips a `dark` class on the document root (which swaps the Material color theme
 * and our --dd tokens) and is remembered in localStorage.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
   private readonly doc = inject(DOCUMENT);
   private readonly media = this.doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
   private readonly systemDark = signal<boolean>(this.media?.matches ?? false);

   readonly mode$ = signal<ThemeMode>(this.readInitial());
   readonly dark$ = computed(() => (this.mode$() === 'system' ? this.systemDark() : this.mode$() === 'dark'));
   /**
    * Fires after the root's `dark` class flips, so computeds that read theme tokens
    * through `getComputedStyle` re-read them (and only then).
    */
   readonly themeChanged$ = notifySignal();

   constructor() {
      this.media?.addEventListener?.('change', (e) => this.systemDark.set(e.matches));
      effect(() => {
         const mode = this.mode$();
         const isDark = this.dark$();
         this.doc.documentElement.classList.toggle('dark', isDark);
         this.themeChanged$.notify();
         try {
            this.doc.defaultView?.localStorage.setItem(STORAGE_KEY, mode);
         } catch {
            // ignore storage errors (private mode, etc.)
         }
      });
   }

   setMode(mode: ThemeMode): void {
      this.mode$.set(mode);
   }

   toggle(): void {
      this.mode$.set(this.dark$() ? 'light' : 'dark');
   }

   private readInitial(): ThemeMode {
      try {
         const saved = this.doc.defaultView?.localStorage.getItem(STORAGE_KEY);
         if (saved === 'light' || saved === 'dark' || saved === 'system') {
            return saved;
         }
      } catch {
         // ignore
      }
      return 'system';
   }
}
