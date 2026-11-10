import { LruCache } from './lru';

describe('LruCache', () => {
   it('evicts the least recently used entry past its size', () => {
      const cache = new LruCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.get('a');
      cache.set('c', 3);
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('a')).toBe(1);
      expect(cache.get('c')).toBe(3);
      expect(cache.size).toBe(2);
   });

   it('getOrSet makes a value once', () => {
      const cache = new LruCache<string, number[]>(4);
      const make = jest.fn(() => [1]);
      const first = cache.getOrSet('k', make);
      expect(cache.getOrSet('k', make)).toBe(first);
      expect(make).toHaveBeenCalledTimes(1);
      cache.clear();
      cache.getOrSet('k', make);
      expect(make).toHaveBeenCalledTimes(2);
   });
});
