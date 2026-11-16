/** A small least-recently-used cache: `get` refreshes an entry, `set` evicts the oldest past `max`. */
export class LruCache<K, V> {
   private readonly entries = new Map<K, V>();

   constructor(private readonly max: number) {}

   get size(): number {
      return this.entries.size;
   }

   get(key: K): V | undefined {
      const value = this.entries.get(key);
      if (value !== undefined) {
         this.entries.delete(key);
         this.entries.set(key, value);
      }
      return value;
   }

   set(key: K, value: V): void {
      this.entries.delete(key);
      this.entries.set(key, value);
      if (this.entries.size > this.max) {
         this.entries.delete(this.entries.keys().next().value as K);
      }
   }

   /** The cached value for `key`, made (and cached) by `make` on a miss. */
   getOrSet(key: K, make: () => V): V {
      const hit = this.get(key);
      if (hit !== undefined) return hit;
      const value = make();
      this.set(key, value);
      return value;
   }

   clear(): void {
      this.entries.clear();
   }
}
