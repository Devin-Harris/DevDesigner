import { computed, effect } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { notifySignal } from './notify-signal';

describe('notifySignal', () => {
   it('re-runs a computed that reads it on every notify', () => {
      const notifier$ = notifySignal();
      let outside = 1;
      const derived$ = computed(() => {
         notifier$();
         return outside;
      });

      expect(derived$()).toBe(1);
      outside = 2;
      expect(derived$()).toBe(1); // nothing in the graph changed yet
      notifier$.notify();
      expect(derived$()).toBe(2);
   });

   it('re-runs an effect on every notify, even though the value never changes', () => {
      const notifier$ = notifySignal();
      let runs = 0;
      TestBed.runInInjectionContext(() =>
         effect(() => {
            notifier$();
            runs++;
         })
      );
      TestBed.tick();
      notifier$.notify();
      TestBed.tick();
      notifier$.notify();
      TestBed.tick();
      expect(runs).toBe(3);
   });

   it('is read-only (no set/update exposed)', () => {
      const notifier$ = notifySignal() as unknown as Record<string, unknown>;
      expect(notifier$['set']).toBeUndefined();
      expect(notifier$['update']).toBeUndefined();
   });
});
