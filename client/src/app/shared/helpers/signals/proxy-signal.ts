import { CreateComputedOptions, Signal, WritableSignal, computed, signal } from '@angular/core';

export type ProxySignal<T> = Signal<T> & {
   /** Register or replace the source signal */
   register(source: Signal<T>): void;
   /** Resets inner value to initial value and register signal to false */
   reset(): void;
   registered: Signal<boolean>;
};

export type WritableProxySignal<T> = WritableSignal<T> & {
   /** Register or replace the source signal */
   register(source: WritableSignal<T>): void;
   /** Resets inner value to initial value and register signal to false */
   reset(): void;
   registered: Signal<boolean>;
};

/**
 * Function that creates a writable signal, with a signal | null inner value.
 * Inner signals value is pulled out into a computed signal alongside a connect
 * function for changing the inner signal later
 *
 * Useful for when you want a reactive signal to be in sync with another signal without
 * syncing the values over an effect
 */
export function proxySignal<T>(initialValue: T, options?: CreateComputedOptions<T>): ProxySignal<T> {
   const inner$$ = signal<Signal<T> | null>(null);
   const registered$ = signal<boolean>(false);

   const value = computed(() => {
      const inner$ = inner$$();
      return inner$ ? inner$() : ((initialValue ?? null) as T);
   }, options);

   Object.assign(value, {
      register: (source: Signal<T>) => {
         inner$$.set(source);
         registered$.set(true);
      },
      reset: () => {
         inner$$.set(initialValue ? signal(initialValue) : null);
         registered$.set(false);
      },
      registered: registered$.asReadonly(),
   });

   return value as ProxySignal<T>;
}

/**
 * Function that creates a writable signal, with a writable signal | null inner value.
 * Inner signals value is pulled out into a computed signal alongside a connect
 * function for changing the inner signal later
 *
 * Useful for when you want a reactive signal to be in sync with another signal without
 * syncing the values over an effect
 *
 * Similar to the proxySignal, but allows writing to the pasted in signal
 */
export function writableProxySignal<T>(initialValue: T, options?: CreateComputedOptions<T>): WritableProxySignal<T> {
   const inner$$ = signal<WritableSignal<T> | null>(null);
   const registered$ = signal<boolean>(false);

   const value = computed(() => {
      const inner$ = inner$$();
      return inner$ ? inner$() : ((initialValue ?? null) as T);
   }, options);

   Object.assign(value, {
      register: (source: WritableSignal<T>) => {
         inner$$.set(source);
         registered$.set(true);
      },
      reset: () => {
         inner$$.set(initialValue ? signal(initialValue) : null);
         registered$.set(false);
      },
      set: (value: T) => {
         const inner$ = inner$$();
         if (inner$) {
            inner$.set(value);
         }
      },
      update: (updateFn: (value: T) => T) => {
         const inner$ = inner$$();
         if (inner$) {
            inner$.update((oldValue) => updateFn(oldValue));
         }
      },
      registered: registered$.asReadonly(),
   });

   return value as WritableProxySignal<T>;
}
