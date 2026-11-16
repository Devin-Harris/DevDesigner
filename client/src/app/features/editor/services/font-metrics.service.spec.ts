import { computed, Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FontMetricsService } from './font-metrics.service';

describe('FontMetricsService', () => {
   let fonts: EventTarget;
   let original: PropertyDescriptor | undefined;

   beforeEach(() => {
      fonts = new EventTarget();
      original = Object.getOwnPropertyDescriptor(document, 'fonts');
      Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
   });

   afterEach(() => {
      if (original) Object.defineProperty(document, 'fonts', original);
      else delete (document as unknown as Record<string, unknown>)['fonts'];
   });

   it('re-runs readers of fontsLoaded$ and bumps the generation when fonts finish loading', () => {
      const service = TestBed.inject(FontMetricsService);
      let runs = 0;
      const derived$ = computed(() => {
         service.fontsLoaded$();
         return ++runs;
      });
      expect(derived$()).toBe(1);
      expect(service.generation).toBe(0);
      fonts.dispatchEvent(new Event('loadingdone'));
      expect(derived$()).toBe(2);
      expect(service.generation).toBe(1);
   });

   it('stops listening when its injector is destroyed', () => {
      const injector = Injector.create({ providers: [FontMetricsService], parent: TestBed.inject(Injector) });
      const service = injector.get(FontMetricsService);
      (injector as unknown as { destroy(): void }).destroy();
      fonts.dispatchEvent(new Event('loadingdone'));
      expect(service.generation).toBe(0);
   });
});
