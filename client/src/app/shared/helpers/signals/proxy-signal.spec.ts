import { computed, signal } from '@angular/core';
import { proxySignal, writableProxySignal } from './proxy-signal';

describe('proxySignal', () => {
   it('reads the initial value until a source is registered', () => {
      const proxy$ = proxySignal(false);
      expect(proxy$()).toBe(false);
      expect(proxy$.registered()).toBe(false);
   });

   it('follows the registered source reactively', () => {
      const source$ = signal(1);
      const proxy$ = proxySignal(0);
      const doubled$ = computed(() => proxy$() * 2);

      proxy$.register(source$);
      expect(doubled$()).toBe(2);
      source$.set(5);
      expect(doubled$()).toBe(10);
      expect(proxy$.registered()).toBe(true);
   });

   it('switches to a newly registered source', () => {
      const proxy$ = proxySignal('none');
      proxy$.register(signal('first'));
      proxy$.register(signal('second'));
      expect(proxy$()).toBe('second');
   });

   it('reset returns to the initial value and unregisters', () => {
      const source$ = signal(7);
      const proxy$ = proxySignal(3);
      proxy$.register(source$);
      proxy$.reset();
      source$.set(8);
      expect(proxy$()).toBe(3);
      expect(proxy$.registered()).toBe(false);
   });

   it('falls back to a falsy initial value after reset', () => {
      const proxy$ = proxySignal<number | null>(0);
      proxy$.register(signal(4));
      proxy$.reset();
      expect(proxy$()).toBe(0);
   });

   it('passes computed options through (custom equality)', () => {
      const source$ = signal({ id: 1, name: 'a' });
      const proxy$ = proxySignal({ id: 0, name: '' }, { equal: (a, b) => a.id === b.id });
      proxy$.register(source$);
      const first = proxy$();
      source$.set({ id: 1, name: 'renamed' });
      expect(proxy$()).toBe(first);
   });
});

describe('writableProxySignal', () => {
   it('set and update are no-ops before a source is registered', () => {
      const proxy$ = writableProxySignal(1);
      proxy$.set(5);
      proxy$.update((v) => v + 10);
      expect(proxy$()).toBe(1);
   });

   it('writes through to the registered source', () => {
      const source$ = signal(1);
      const proxy$ = writableProxySignal(0);
      proxy$.register(source$);

      proxy$.set(5);
      expect(source$()).toBe(5);
      proxy$.update((v) => v * 3);
      expect(source$()).toBe(15);
      expect(proxy$()).toBe(15);
   });

   it('stops writing to a source after reset', () => {
      const source$ = signal(1);
      const proxy$ = writableProxySignal(9);
      proxy$.register(source$);
      proxy$.reset();
      proxy$.set(2);
      expect(source$()).toBe(1);
      expect(proxy$.registered()).toBe(false);
   });
});
