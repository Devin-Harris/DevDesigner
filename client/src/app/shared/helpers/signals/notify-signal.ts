import { Signal, signal } from '@angular/core';

export type NotifySignal = Signal<unknown> & {
   notify(): void;
};

/**
 * Creates a "notifier" signal, a read-only signal whose value is meaningless
 * and never meant to be read. Its only purpose is to act as a manual trigger in
 * the reactive graph.
 *
 * The internal signal uses an always-false equality function (`equal: () => false`),
 * so Angular treats every `set()` as a change even though the value (null) never
 * actually changes. Calling `notify()` performs one such no-op write, which marks
 * the signal dirty and re-runs any `computed()` or `effect()` that depends on it.
 *
 * Use this when you want to force a reactive context to re-fire on demand, for
 * example "re-run this effect now", without inventing a real value to push through
 * a signal (like an incrementing counter or a toggled boolean).
 *
 * @example
 * const refresh = signalNotifier();
 * effect(() => {
 *   refresh();            // establish the dependency
 *   reloadData();         // runs again every time notify() is called
 * });
 * // later:
 * refresh.notify();       // forces the effect to re-run
 *
 * @returns A read-only signal augmented with a `notify()` method.
 */
export function notifySignal() {
   const inner$ = signal(null, { equal: () => false });

   const readonlyInner$ = inner$.asReadonly();
   Object.assign(readonlyInner$, {
      notify: () => {
         inner$.set(null);
      },
   });

   return readonlyInner$ as NotifySignal;
}
