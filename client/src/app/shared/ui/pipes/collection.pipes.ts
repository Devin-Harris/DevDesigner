import { Pipe, type PipeTransform } from '@angular/core';

/**
 * Template helpers for collections held in signals (the collections are replaced, never
 * mutated, so pure pipes re-run exactly when they change). They keep method calls out of
 * templates (`template/no-call-expression`).
 */

/** `items | has: x`: membership in a Set, Map (by key) or array. */
@Pipe({ name: 'has' })
export class HasPipe implements PipeTransform {
   transform<K>(items: ReadonlyMap<K, unknown> | null | undefined, item: K): boolean;
   transform<T>(items: ReadonlySet<T> | readonly T[] | null | undefined, item: T): boolean;
   transform(items: ReadonlySet<unknown> | ReadonlyMap<unknown, unknown> | readonly unknown[] | null | undefined, item: unknown): boolean {
      if (!items) return false;
      return Array.isArray(items) ? items.includes(item) : (items as ReadonlySet<unknown>).has(item);
   }
}

/** `map | at: key`: a Map lookup (undefined when missing). */
@Pipe({ name: 'at' })
export class AtPipe implements PipeTransform {
   transform<K, V>(map: ReadonlyMap<K, V> | null | undefined, key: K): V | undefined {
      return map?.get(key);
   }
}

/** `list | join: ', '`. */
@Pipe({ name: 'join' })
export class JoinPipe implements PipeTransform {
   transform(list: readonly unknown[] | null | undefined, separator = ','): string {
      return list?.join(separator) ?? '';
   }
}

/**
 * `fn | call: a : b`: apply a **pure** function (one that reads only its arguments).
 * A pure pipe re-runs only when `fn` or an argument changes, so never pass a method that
 * reads component state: give that a `computed` instead.
 */
@Pipe({ name: 'call' })
export class CallPipe implements PipeTransform {
   transform<A extends unknown[], R>(fn: (...args: A) => R, ...args: A): R {
      return fn(...args);
   }
}
