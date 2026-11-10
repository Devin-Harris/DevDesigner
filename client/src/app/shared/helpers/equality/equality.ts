/**
 * Structural equality for `computed({ equal })` on derived collections: a fresh Set /
 * array / Map with the same contents counts as unchanged, so downstream computeds and
 * bindings don't re-run. Items are compared by reference.
 */
export function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
   if (a === b) return true;
   if (a.length !== b.length) return false;
   for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
   }
   return true;
}

export function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
   if (a === b) return true;
   if (a.size !== b.size) return false;
   for (const v of a) {
      if (!b.has(v)) return false;
   }
   return true;
}

/** Same keys, and values equal by `same` (reference by default). */
export function sameMap<K, V>(
   a: ReadonlyMap<K, V>,
   b: ReadonlyMap<K, V>,
   same: (x: V, y: V) => boolean = Object.is
): boolean {
   if (a === b) return true;
   if (a.size !== b.size) return false;
   for (const [k, v] of a) {
      if (!b.has(k) || !same(v, b.get(k) as V)) return false;
   }
   return true;
}
