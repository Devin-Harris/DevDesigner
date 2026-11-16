import { computed, signal } from '@angular/core';
import { sameItems, sameMap, sameSet } from './equality';

describe('equality helpers', () => {
   const a = { id: 'a' };
   const b = { id: 'b' };

   it('sameItems compares arrays item by item, by reference', () => {
      expect(sameItems([a, b], [a, b])).toBe(true);
      expect(sameItems([a, b], [b, a])).toBe(false);
      expect(sameItems([a], [a, b])).toBe(false);
      expect(sameItems([{ id: 'a' }], [{ id: 'a' }])).toBe(false);
   });

   it('sameSet ignores order', () => {
      expect(sameSet(new Set(['x', 'y']), new Set(['y', 'x']))).toBe(true);
      expect(sameSet(new Set(['x']), new Set(['y']))).toBe(false);
      expect(sameSet(new Set(['x']), new Set(['x', 'y']))).toBe(false);
   });

   it('sameMap compares keys and values (custom value equality optional)', () => {
      expect(sameMap(new Map([['k', a]]), new Map([['k', a]]))).toBe(true);
      expect(sameMap(new Map([['k', a]]), new Map([['k', b]]))).toBe(false);
      expect(sameMap(new Map([['k', [a]]]), new Map([['k', [a]]]), sameItems)).toBe(true);
   });

   it('keeps a computed from notifying when a derived Set is rebuilt with the same contents', () => {
      const source$ = signal(['x', 'y']);
      const ids$ = computed(() => new Set(source$()), { equal: sameSet });
      let downstream = 0;
      const reader$ = computed(() => {
         ids$();
         return ++downstream;
      });
      reader$();
      source$.set(['y', 'x']);
      reader$();
      expect(downstream).toBe(1);
      source$.set(['z']);
      reader$();
      expect(downstream).toBe(2);
   });
});
