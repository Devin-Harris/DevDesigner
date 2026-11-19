import { Injectable, computed, signal } from '@angular/core';

/** Mirrors UpdateStatus in desktop/src/updater.ts. */
export type UpdateStatus =
   | { state: 'idle' }
   | { state: 'checking' }
   | { state: 'downloading'; version: string; percent: number }
   | { state: 'ready'; version: string };

interface UpdatesBridge {
   get(): Promise<UpdateStatus | null>;
   onStatus(listener: (status: UpdateStatus) => void): void;
   install(): void;
}

/**
 * The desktop app's auto-update state, pushed from the main process (which checks on
 * launch and every few hours). Drives the title bar's update button and the Settings
 * "Check now" spinner. Always idle on the web.
 */
@Injectable({ providedIn: 'root' })
export class UpdateService {
   private readonly bridge = (globalThis as { devdesigner?: { updates?: UpdatesBridge } }).devdesigner?.updates;
   readonly status = signal<UpdateStatus>({ state: 'idle' });
   readonly checking = computed(() => this.status().state === 'checking');

   constructor() {
      if (!this.bridge) return;
      this.bridge.onStatus((s) => this.status.set(s));
      void this.bridge.get().then((s) => s && this.status.set(s));
   }

   install(): void {
      this.bridge?.install();
   }
}
