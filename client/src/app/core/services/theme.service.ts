import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';

const STORAGE_KEY = 'dbd-theme';

/**
 * Light/dark theme state. Toggling flips a `dark` class on the document root
 * (which swaps the Material color theme and our --dbd tokens) and remembers the
 * choice in localStorage.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  readonly dark = signal<boolean>(this.readInitial());

  constructor() {
    effect(() => {
      const isDark = this.dark();
      this.doc.documentElement.classList.toggle('dark', isDark);
      try {
        this.doc.defaultView?.localStorage.setItem(STORAGE_KEY, isDark ? 'dark' : 'light');
      } catch {
        // ignore storage errors (private mode, etc.)
      }
    });
  }

  toggle(): void {
    this.dark.update((v) => !v);
  }

  private readInitial(): boolean {
    try {
      const saved = this.doc.defaultView?.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return saved === 'dark';
      }
    } catch {
      // ignore
    }
    return this.doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  }
}
