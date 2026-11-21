import { isSignal } from '@angular/core';

/**
 * One member of a signal store for a facade: signals as they are, methods bound to the
 * store (signal-store methods may call their siblings through `this`).
 */
export function storeMember<S extends object, K extends keyof S>(store: S, key: K): S[K] {
   const value = store[key];
   return (typeof value === 'function' && !isSignal(value) ? value.bind(store) : value) as S[K];
}
